import os
import json
import re
import unicodedata
import numpy as np
import pandas as pd
import nltk
nltk.download("stopwords")
from nltk.corpus import stopwords

from flask import Flask, request, jsonify
from flask_cors import CORS

from dotenv import load_dotenv
from postgrest import SyncPostgrestClient

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from collections import Counter

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

client = SyncPostgrestClient(
    f"{SUPABASE_URL}/rest/v1",
    headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
)

app = Flask(__name__)
CORS(app)

vectorizer = None
perfiles = None
barrios_info = None
# indice_calles = None
indice_geo = None

stopwords_extra = {
    "de","del","la","las","el","los","y","o","en","a","al","por","para",
    "con","sin","sobre","entre","hasta","desde","contra","segun",
    "si","no","ya","muy","mas","menos"
}

@app.post("/predecir")
def endpoint_predecir():
    texto = request.json["texto"]
    barrio, prob = predecir_barrio(
    texto,
    vectorizer,
    perfiles,
    barrios_info
    )

    return jsonify({
        "barrio": barrio,
        "probabilidades": prob
    })

@app.post("/reentrenar")
def endpoint_reentrenar():

    global vectorizer, perfiles, barrios_info

    df = cargar_dataset()

    vectorizer, perfiles = entrenar_modelo(df)

    barrios_info = cargar_barrios()

    return {"status":"modelo reentrenado"}

@app.post("/procesar_noticias")
def procesar_noticias():

    noticias = client.from_("noticias") \
        .select("id_noticia,titulo_noticia,subtitulo_noticia,contenido_noticia") \
        .eq("barrios","SIN PREDICCION") \
        .execute()
    
    procesadas = 0

    for n in noticias.data:

        texto = (
            (n["titulo_noticia"] or "") + " " +
            (n["subtitulo_noticia"] or "") + " " +
            (n["contenido_noticia"] or "")
        )

        barrio, _ = predecir_barrio(
            texto,
            vectorizer,
            perfiles,
            barrios_info
        )

        # convertir lista → string limpio
        if isinstance(barrio, list):
            if len(barrio) == 1:
                barrio_str = barrio[0]
            else:
                barrio_str = ", ".join(barrio)
        else:
            barrio_str = barrio

        # opcional: mayúsculas
        if barrio_str:
            barrio_str = barrio_str.upper()

        client.from_("noticias") \
            .update({"barrios": barrio_str}) \
            .eq("id_noticia", n["id_noticia"]) \
            .execute()
        
        procesadas += 1

    return {"status":"ok", "procesadas": procesadas}

def construir_indice_geo(barrios_info):

    indice = {}

    for barrio, data in barrios_info.items():

        # nombre del barrio
        if barrio not in indice:
            indice[barrio] = {"tipo": "barrio", "barrios": []}

        indice[barrio]["barrios"].append(barrio)

        # calles
        for calle in data["calles"]:
            if not calle:
                continue

            if calle not in indice:
                indice[calle] = {"tipo": "calle", "barrios": []}

            indice[calle]["barrios"].append(barrio)

        # puntos de interés
        for punto in data["puntos"]:
            if not punto:
                continue

            if punto not in indice:
                indice[punto] = {"tipo": "punto", "barrios": []}

            indice[punto]["barrios"].append(barrio)

    return indice

def limpiar_texto(texto):

    texto = texto.lower()

    texto = texto.replace("av ", "avenida ")
    texto = texto.replace("av.", "avenida ")
    texto = texto.replace("avda ", "avenida ")
    texto = texto.replace("avda.", "avenida ")
    texto = texto.replace("pje ", "pasaje ")
    texto = texto.replace("pje.", "pasaje ")

    # eliminar si contiene numeros
    texto = re.sub(r"\d+", " ", texto)

    # eliminar palabras muy cortas
    if len(texto) < 3:
        return ""

    texto = unicodedata.normalize("NFKD", texto)
    texto = texto.encode("ascii","ignore").decode("utf-8")

    texto = re.sub(r"[^\w\s]", " ", texto)
    texto = re.sub(r"\s+", " ", texto)

    # eliminar preposiciones y palabras irrelevantes
    if texto in stopwords_extra:
        return ""

    return texto.strip()

def cargar_dataset():

    noticias = client.from_("noticias") \
        .select("id_noticia,titulo_noticia,subtitulo_noticia,contenido_noticia,barrios") \
        .neq("barrios","SIN PREDICCION") \
        .execute()

    df = pd.DataFrame(noticias.data)

    df["texto"] = (
        df["titulo_noticia"].fillna("") +
        " " +
        df["subtitulo_noticia"].fillna("") +
        " " +
        df["contenido_noticia"].fillna("")
    )

    df["texto"] = df["texto"].apply(limpiar_texto)

    return df

def cargar_barrios():

    data = client.from_("barrios") \
        .select("*") \
        .execute()

    df = pd.DataFrame(data.data)

    barrios = {}

    for _, row in df.iterrows():

        nombre = limpiar_texto(row["nombre_barrio"])

        barrios[nombre] = {
            "calles": [],
            "puntos": []
        }

        # CALLLES
        if row["lista_calles"]:
            try:
                calles = json.loads(row["lista_calles"])
                calles = [limpiar_texto(c) for c in calles]
                calles = [c for c in calles if c]
                barrios[nombre]["calles"] = calles
            except:
                pass

        # PUNTOS
        if row["puntosInteres"]:
            try:
                puntos = json.loads(row["puntosInteres"])
                puntos = [limpiar_texto(p) for p in puntos]
                puntos = [p for p in puntos if p]
                barrios[nombre]["puntos"] = puntos
            except:
                pass

    return barrios

def predecir_por_modelo(texto, vectorizer, perfiles):

    texto_limpio = limpiar_texto(texto)

    vector = vectorizer.transform([texto_limpio])

    scores = {}

    for barrio, perfil in perfiles.items():
        sim = cosine_similarity(vector.toarray(), perfil)
        scores[barrio] = sim[0][0]

    valores = np.array(list(scores.values()))
    exp = np.exp(valores)
    prob = exp / exp.sum()

    probabilidades = dict(zip(scores.keys(), prob))

    barrio_predicho = max(probabilidades, key=probabilidades.get)
    confianza = probabilidades[barrio_predicho]

    return barrio_predicho, confianza, probabilidades

def entrenar_modelo(df):
    stopwords_es = stopwords.words("spanish") + list(stopwords_extra)

    vectorizer = TfidfVectorizer(
        stop_words=stopwords_es,
        max_features=7000,
        ngram_range=(1,3),
        min_df=4,
        max_df=0.85

    )

    X = vectorizer.fit_transform(df["texto"])

    perfiles = {}

    for barrio in df["barrios"].unique():

        subset = df[df["barrios"] == barrio]

        vectores = vectorizer.transform(subset["texto"])

        perfiles[barrio] = vectores.mean(axis=0).A

    return vectorizer, perfiles

def predecir_barrio(texto, vectorizer, perfiles, barrios_info):

    # 1️⃣ detectar geo
    barrio_geo = detectar_geo(texto, indice_geo)

    # 2️⃣ modelo ML
    barrio_ml, confianza_ml, probabilidades = predecir_por_modelo(
        texto, vectorizer, perfiles
    )

        # asegurar lista
    if barrio_geo and not isinstance(barrio_geo, list):
        barrios_geo = [barrio_geo]
    else:
        barrios_geo = barrio_geo

    # 3️⃣ combinación inteligente

   # 🔥 CASO 1: hay GEO
    if barrios_geo:

        # intersección con ML (filtrar por probabilidad)
        barrios_filtrados = [
            b for b in barrios_geo
            if probabilidades.get(b, 0) > 0.15
        ]

        # si la intersección no queda vacía → usarla
        if barrios_filtrados:
            return barrios_filtrados, {
                "metodo": "geo filtrado por ml"
            }

        # si ML no confirma → devolver geo igual
        return barrios_geo, {
            "metodo": "solo geo"
        }

    # 🔥 CASO 2: no hay GEO → usar ML
    if confianza_ml > 0.35:
        return [barrio_ml], {
            "metodo": "ml"
        }

    return ["SIN PREDICCION"], probabilidades

def predecir_noticias_nuevas(vectorizer, perfiles):

    noticias = client.from_("noticias") \
        .select("*") \
        .eq("barrios","SIN PREDICCION") \
        .execute()

    df = pd.DataFrame(noticias.data)

    for _, row in df.iterrows():

        texto = f"{row['titulo_noticia']} {row['subtitulo_noticia']} {row['contenido_noticia']}"

        barrio, prob = predecir_barrio(texto, vectorizer, perfiles, barrios_info)

        print(barrio, prob)

def detectar_geo(texto, indice_geo):

    texto = limpiar_texto(texto)

    barrios_detectados = []
    calles_detectadas = []
    puntos_detectados = []

    # palabras_calle = {"calle", "avenida", "av", "pasaje", "pje"}

    # contexto_calle = any(p in texto.split() for p in palabras_calle)

    for termino, info in sorted(indice_geo.items(), key=lambda x: len(x[0]), reverse=True):

        if not termino:
            continue

        if termino in texto:

            if info["tipo"] == "barrio":
                barrios_detectados.extend(info["barrios"])

            elif info["tipo"] == "calle":
                calles_detectadas.extend(info["barrios"])

            elif info["tipo"] == "punto":
                puntos_detectados.extend(info["barrios"])

    calles_detectadas = list(set(calles_detectadas))
    
    puntos_detectados = list(set(puntos_detectados))

    # PRIORIDAD 1 — barrio explícito
    if barrios_detectados:
        return list(set(barrios_detectados))

    # PRIORIDAD 2 — calles
    if calles_detectadas:
        return list(set(calles_detectadas))

    # PRIORIDAD 3 — puntos
    if puntos_detectados:
        return list(set(puntos_detectados))

    return None

def exportar_indice_geo(indice_geo):

    with open("indice_geo.txt", "w", encoding="utf-8") as f:

        for termino, info in indice_geo.items():

            tipo = info["tipo"]
            barrios = ", ".join(info["barrios"])

            f.write(f"{termino} | {tipo} | [{barrios}]\n")

if __name__ == "__main__":

    print("Iniciando servicio de minería...")

    df = cargar_dataset()

    vectorizer, perfiles = entrenar_modelo(df)

    barrios_info = cargar_barrios()

    indice_geo = construir_indice_geo(barrios_info)

    ##exportar_indice_geo(indice_geo)

    print("Modelo entrenado")

    print("A la espera de la predicción.")

    app.run(host="0.0.0.0", port=5000)
