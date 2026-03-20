const express = require("express");
const puppeteer2 = require("puppeteer");
const fs = require("fs");

const cors = require("cors");

const axios = require("axios");

const puppeteer_ = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer_.use(StealthPlugin());

// const { createClient } = require("@supabase/supabase-js");
try {
  const { supabase } = require("./supabaseClient");
  console.log("✅ Supabase cargado");
} catch (err) {
  console.error("❌ Error real:", err);
}

const client = axios.create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "es-419,es;q=0.9",
    Referer: "https://todosalta.com/categoria/2/locales",
  },
});

const app = express();
app.use(cors());

let clients = [];
let scrapingCancelado = false;

// "https://prensa.municipalidadsalta.gob.ar/categoria/obras-publicas/"
// "https://prensa.municipalidadsalta.gob.ar/categoria/arreglo-de-calles/"

const BASE_URLS = [
  "https://prensa.municipalidadsalta.gob.ar/categoria/obras-publicas/",
];
const delay2 = (ms) => new Promise((res) => setTimeout(res, ms));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function convertirFechaTS(texto) {
  if (!texto) return null;

  texto = texto.toLowerCase().trim();

  const meses = {
    enero: 0,
    febrero: 1,
    marzo: 2,
    abril: 3,
    mayo: 4,
    junio: 5,
    julio: 6,
    agosto: 7,
    septiembre: 8,
    octubre: 9,
    noviembre: 10,
    diciembre: 11,
  };

  const dias = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6,
  };

  const hoy = new Date();

  // -------------------------
  // 1. FORMATO: 03 de marzo de 2026
  // -------------------------
  const fechaCompleta = texto.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/);

  if (fechaCompleta) {
    const dia = parseInt(fechaCompleta[1]);
    const mes = meses[fechaCompleta[2]];
    const anio = parseInt(fechaCompleta[3]);

    const fecha = new Date(anio, mes, dia);
    return fecha.toLocaleDateString("sv-SE");
  }

  // -------------------------
  // 2. FORMATO: Hace X horas
  // -------------------------
  const haceHoras = texto.match(/hace\s+(\d+)\s+hora/);

  if (haceHoras) {
    const horas = parseInt(haceHoras[1]);
    const fecha = new Date();
    fecha.setHours(fecha.getHours() - horas);
    return fecha.toLocaleDateString("sv-SE");
  }

  // -------------------------
  // 3. FORMATO: Hace X día(s)
  // -------------------------
  const haceDias = texto.match(/hace\s+(\d+)\s+d[ií]a/);

  if (haceDias) {
    const diasRestar = parseInt(haceDias[1]);
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - diasRestar);
    return fecha.toLocaleDateString("sv-SE");
  }

  // -------------------------
  // 4. FORMATO: Jueves / El jueves
  // -------------------------
  const diaTexto = texto.replace("el ", "");

  if (dias[diaTexto] !== undefined) {
    const objetivo = dias[diaTexto];

    const fecha = new Date();
    const diff = (fecha.getDay() - objetivo + 7) % 7;

    fecha.setDate(fecha.getDate() - diff);

    return fecha.toLocaleDateString("sv-SE");
  }

  return null;
}

function convertirFecha(texto) {
  const meses = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12",
  };
  const match = texto.match(/(\w+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!match) return null;
  const [_, mesStr, dia, anio] = match;
  const mes = meses[mesStr.toLowerCase()] || "01";
  return `${anio}-${mes}-${String(dia).padStart(2, "0")}`;
}

async function extraerDatosDesdeNoticia(page, linkN) {
  try {
    await page.goto(linkN, { waitUntil: "domcontentloaded" });
    await delay2(1000);

    const data = await page.evaluate((linkN) => {
      const getTextContent = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : "";
      };

      const titulo = getTextContent(".elementor-widget-container h1");

      // Subtítulo: div que solo tiene texto plano (sin tags hijos)
      const subtituloDiv = Array.from(
        document.querySelectorAll(".elementor-widget-container"),
      ).find(
        (div) => !div.querySelector("*") && div.textContent.trim().length > 0,
      );
      const subtitulo = subtituloDiv?.textContent.trim() || "";

      // Fecha: dentro de <time>
      const timeEl = document.querySelector("time");
      let fecha = "";
      if (timeEl) {
        const meses = {
          enero: "01",
          febrero: "02",
          marzo: "03",
          abril: "04",
          mayo: "05",
          junio: "06",
          julio: "07",
          agosto: "08",
          septiembre: "09",
          octubre: "10",
          noviembre: "11",
          diciembre: "12",
        };
        const partes = timeEl.textContent.trim().split(" ");
        if (partes.length === 3) {
          const dia = partes[1].replace(",", "").padStart(2, "0");
          const mes = meses[partes[0].toLowerCase()] || "";
          const anio = partes[2];
          if (mes) fecha = `${anio}-${mes}-${dia}`;
        }
      }

      // Categorías desde ambos lugares
      const categorias = new Set();
      document
        .querySelectorAll(".elementor-post-info__terms-list a")
        .forEach((a) => {
          const texto = a.textContent.trim();
          if (texto) categorias.add(texto);
        });

      // Contenido: párrafos dentro del div .elementor-widget-container
      let contenido = "";
      const contenedorContenido = Array.from(
        document.querySelectorAll(".elementor-widget-container"),
      ).find((div) => div.querySelector("p"));
      if (contenedorContenido) {
        const parrafos = contenedorContenido.querySelectorAll("p");
        contenido = Array.from(parrafos)
          .map((p) => p.textContent.trim())
          .join("\n\n");
      }

      return {
        titulo,
        subtitulo,
        fecha,
        categorias: Array.from(categorias),
        contenido,
        link: linkN,
        fuente: "Municipalidad de Salta",
      };
    }, linkN);

    return data;
  } catch (error) {
    console.error(`Error en ${link}:`, error.message);
    return null;
  }
}

async function scrapearSeccion(url, numPag) {
  const browser = await puppeteer2.launch({ headless: true });
  const page = await browser.newPage();
  const resultados = [];
  let link = url + "page/" + numPag + "/";

  await page.goto(link, { waitUntil: "domcontentloaded" });
  await delay2(1000);

  const links = await page.$$eval("h3.elementor-post__title a", (as) =>
    as.map((a) => a.href),
  );

  for (const link of links) {
    try {
      const datos = await extraerDatosDesdeNoticia(page, link);
      if (datos) resultados.push(datos);
    } catch (err) {
      console.error(`Error en ${link}:`, err.message);
    }
  }
  console.log("➡️ Siguiente página:", link);

  await browser.close();
  return resultados;
}

function esHoy(fechaFormateada) {
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, "0");
  const dd = String(hoy.getDate()).padStart(2, "0");
  const fechaHoy = `${yyyy}-${mm}-${dd}`;
  return fechaFormateada === fechaHoy;
}

function formatearFechaQuePasa(fechaTexto) {
  const meses = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };

  const [dia, mesAbrev, anio] = fechaTexto.split(" ");
  const mes = meses[mesAbrev];
  const diaFormateado = dia.padStart(2, "0");

  return `${anio}-${mes}-${diaFormateado}`;
}

async function scrapeQuePasaSalta(browser, { onProgress, cancelar } = {}) {
  let contador = 0;
  const page = await browser.newPage();
  const noticias = [];

  const url = "https://www.quepasasalta.com.ar/seccion/salta/";

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    // Click en "Ver más" hasta 3 veces
    for (let i = 0; i < 3; i++) {
      try {
        const verMas = await page.$("div.moreitems");
        if (!verMas) break;
        await verMas.click();
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch (err) {
        console.warn("⚠️ No se pudo hacer click en 'Ver más':", err.message);
        break;
      }
    }

    const links = await page.evaluate(() => {
      const sections = Array.from(
        document.querySelectorAll(
          "section.piece.news.standard.news.fixed-height",
        ),
      );

      const articleLinks = sections.flatMap((section) => {
        return Array.from(section.querySelectorAll("article a"))
          .map((a) => a.href)
          .filter((href) => href.includes("/salta/"));
      });

      return [
        ...new Set(
          articleLinks.map((l) =>
            l.replace(/\/#comentarios$/, "").replace(/\/$/, ""),
          ),
        ),
      ];
    });

    console.log("🔗 Links encontrados:", links.length);

    const yaProcesados = new Set();

    // 👇 limite de paginas en paralelo
    const CONCURRENCIA = 4;

    const pool = [];

    for (let i = 0; i < CONCURRENCIA; i++) {
      pool.push(browser.newPage());
    }

    const cola = [
      ...new Set(
        links.map((l) => l.replace(/\/#comentarios$/, "").replace(/\/$/, "")),
      ),
    ];

    async function worker(p) {
      while (cola.length > 0) {
        const link = cola.shift();
        if (!link) break;
        const linkLimpio = link.replace("/#comentarios", "");

        if (cancelar?.()) break;
        console.log("Worker", p.target()._targetId, "->", linkLimpio);
        if (yaProcesados.has(linkLimpio)) continue;

        yaProcesados.add(linkLimpio);

        try {
          await p.goto("about:blank");
          await p.goto(linkLimpio, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });

          await p.waitForSelector("h1", { timeout: 5000 });

          const data = await p.evaluate(() => {
            const getText = (selector) =>
              document.querySelector(selector)?.textContent?.trim() || "";

            const titulo = getText("h1");
            const subtitulo = getText("h2");
            const fecha =
              document.querySelector("div.kt time")?.textContent?.trim() || "";

            const categorias = Array.from(
              document.querySelectorAll("section.tag-section ul.tag-list li"),
            ).map((li) => li.textContent.trim());

            const contenido = Array.from(
              document.querySelectorAll("#vsmcontent p"),
            )
              .map((p) => p.textContent?.trim() || "")
              .join("\n");

            const pieImagen =
              document.querySelector(".epigrafe")?.textContent?.trim() || "";

            return {
              titulo,
              subtitulo,
              fecha,
              categorias,
              contenido,
              pieImagen,
            };
          });

          noticias.push({
            ...data,
            fuente: "Qué Pasa Salta",
            link: linkLimpio,
          });

          contador++;
          console.log(contador);

          if (onProgress) onProgress(contador);
        } catch (err) {
          console.warn("❌ Error en link:", linkLimpio, err.message);
        }
      }

      await p.close();
    }

    const pages = await Promise.all(pool);
    await Promise.all(pages.map(worker));
  } catch (err) {
    console.error("❌ Error general:", err.message);
  }

  const noticiasFormateadas = noticias.map((noticia) => {
    return {
      titulo_noticia: noticia.titulo,
      subtitulo_noticia: noticia.subtitulo || "",
      fecha_noticia: formatearFechaQuePasa(noticia.fecha),
      contenido_noticia: noticia.contenido,
      link_noticia: noticia.link,
      fuente_noticia: noticia.fuente,
    };
  });

  console.log("Cantidad de filtradas: " + noticiasFormateadas.length);
  console.log("✔ QuéPasaSalta terminado");

  return noticiasFormateadas;
}

async function scrapeElTribuno(browser) {
  const page = await browser.newPage();
  const noticias = [];

  const links = [];

  // Paso 1: Recorrer páginas del 1 al 10
  for (let i = 1; i <= 3; i++) {
    const url =
      i === 1
        ? "https://www.eltribuno.com/seccion/salta"
        : `https://www.eltribuno.com/seccion/salta/${i}`;
    console.log(`🔎 Analizando: ${url}`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

      const nuevosLinks = await page.evaluate(() => {
        const getLinks = (selector) =>
          Array.from(document.querySelectorAll(selector))
            .map((a) => a.href || a.getAttribute("href"))
            .filter(Boolean)
            .map((href) =>
              href.startsWith("http")
                ? href
                : `https://www.eltribuno.com${href}`,
            )
            .filter(
              (href) => href.includes("/salta/") && !href.includes("/ttag/"),
            );

        const articleLinks = getLinks("div.seccion_box-linea.mobile article a");
        const sabanaLinks = getLinks(
          "section.bloque.bloque-sabana.container div a",
        );
        const gralesLinks = getLinks("article.nota--gral .nota__titulo-item a");

        return [...new Set([...articleLinks, ...sabanaLinks, ...gralesLinks])];
      });

      console.log(`[🔗 LINKS ENCONTRADOS PÁGINA ${i}]: ${nuevosLinks.length}`);
      links.push(...nuevosLinks);
    } catch (err) {
      console.error(`❌ Error cargando página ${url}:`, err.message);
    }
  }

  const uniqueLinks = [...new Set(links)]; // eliminar duplicados
  console.log(`[🔗 TOTAL LINKS ÚNICOS]: ${uniqueLinks.length}`);
  let contador = 0;

  // Paso 2: Scrappear cada noticia
  for (const link of uniqueLinks) {
    let noticiaPage;
    try {
      noticiaPage = await browser.newPage();
      await noticiaPage.goto(link, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });

      await noticiaPage.waitForSelector("article", { timeout: 10000 });

      const data = await noticiaPage.evaluate(() => {
        const titulo = document.querySelector("h1")?.innerText || "";
        let fecha =
          document.querySelector(".articulo__fecha.mobile")?.innerText || "";
        const subtitulo =
          document.querySelector(".articulo__intro")?.innerText || "";
        const categorias = Array.from(document.querySelectorAll(".tags__item"))
          .map((el) => el.innerText.trim())
          .join(", ");
        const contenedores = [
          document.querySelector('[amp-access="mostrarNota"]'),
          document.querySelector(".articulo__contenido"),
          document.querySelector("article"),
        ].filter(Boolean);

        let contenido = "";

        for (const cont of contenedores) {
          const ps = Array.from(cont.querySelectorAll("p"))
            .map((p) => p.innerText.trim())
            .filter((t) => t.length > 40);

          if (ps.length > 2) {
            contenido = ps.join("\n\n");
            break;
          }
        }
        const pieImagen =
          document.querySelector(".articulo__epigrafe")?.innerText || "";
        return {
          titulo,
          fecha,
          subtitulo,
          categorias,
          contenido,
          pieImagen,
        };
      });

      noticias.push({
        titulo_noticia: data.titulo,
        subtitulo_noticia: data.subtitulo || "",
        fecha_noticia: formatearFecha(data.fecha),
        contenido_noticia: data.contenido,
        link_noticia: link,
        fuente_noticia: "El Tribuno",
      });
      console.log(contador++);
    } catch (err) {
      console.error(`❌ Error procesando ${link}:`, err.message);
    } finally {
      if (noticiaPage) await noticiaPage.close();
    }
  }
  console.log("✔ ElTribuno terminado");

  return noticias;
}

async function scrapeExpreso(browser) {
  const puppeteer = require("puppeteer");
  const page = await browser.newPage();

  const noticias = [];
  const base = "https://elexpresodesalta.com.ar/categoria/3/salta";

  try {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 15000 });

    const maxPaginas = 8;

    for (let pagina = 1; pagina <= maxPaginas; pagina++) {
      const urlPagina = pagina === 1 ? base : `${base}?pagina=${pagina}`;
      console.log(`🔗 Página ${pagina}:`);

      try {
        await page.goto(urlPagina, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Intento de extracción de links
        const links = await page.evaluate(() => {
          return Array.from(
            document.querySelectorAll("article.post__noticia > a"),
          )
            .map(
              (a) => "https://elexpresodesalta.com.ar" + a.getAttribute("href"),
            )
            .filter((href) => href.includes("/contenido/"));
        });

        console.log(`📰 Encontradas ${links.length} noticias`);

        for (const link of links) {
          const noticiaPage = await browser.newPage();
          try {
            await noticiaPage.goto(link, {
              waitUntil: "domcontentloaded",
              timeout: 15000,
            });

            await noticiaPage.waitForSelector("h1", { timeout: 5000 });

            const data = await noticiaPage.evaluate(() => {
              const titulo =
                document.querySelector("h1")?.innerText.trim() || "";

              const fechaTexto =
                document
                  .querySelector(".fullpost__fecha .fecha")
                  ?.innerText.trim() || "";

              const categoria =
                document
                  .querySelector(".fullpost__categoria a")
                  ?.innerText.trim() || "";

              const contenido =
                document
                  .querySelector("section.extra1 div.fullpost__cuerpo")
                  ?.innerText.trim() || "";

              return { titulo, fechaTexto, categoria, contenido };
            });

            noticias.push({
              titulo_noticia: data.titulo,
              subtitulo_noticia: "",
              fecha_noticia: formatearFecha(data.fechaTexto),
              contenido_noticia: data.contenido,
              link_noticia: link,
              fuente_noticia: "El Expreso",
            });
          } catch (err) {
            console.error(`❌ Error en noticia ${link}: ${err.message}`);
          } finally {
            await noticiaPage.close();
          }
        }
      } catch (err) {
        console.error(`❌ Error en página ${pagina}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error("❌ Error al scrapear El Periodico Expreso:", err.message);
  } finally {
  }

  console.log("✔ ElExpreso terminado");

  return noticias;
}

async function scrapeTodoSalta(browser) {
  const noticias = [];
  const base = "https://todosalta.com";

  const page = await browser.newPage();

  await page.goto("https://todosalta.com/categoria/2/locales", {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });

  for (let pagina = 1; pagina <= 10; pagina++) {
    console.log("Pagina:", pagina);

    const links = await obtenerLinksPaginaTS(page, pagina);
    const uniqueLinks = [...new Set(links)];

    for (const linkRelativo of uniqueLinks) {
      const link = base + linkRelativo;

      let noticiaPage;

      try {
        noticiaPage = await browser.newPage();

        await noticiaPage.goto(link, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });

        await noticiaPage.waitForSelector("h1", { timeout: 5000 });

        const noticia = await noticiaPage.evaluate(() => {
          const titulo =
            document.querySelector("h1.fullpost__titulo")?.innerText.trim() ||
            "";

          const subtitulo =
            document.querySelector(".fullpost__copete div")?.innerText.trim() ||
            "";

          const cuerpo = Array.from(
            document.querySelectorAll(".fullpost__cuerpo p"),
          )
            .map((p) => p.innerText.trim())
            .join("\n\n");

          const fechaTexto =
            document
              .querySelector(".fullpost__fecha .fecha")
              ?.innerText.trim() || "";

          return { titulo, subtitulo, cuerpo, fechaTexto };
        });

        const fecha = convertirFechaTS(noticia.fechaTexto);

        noticias.push({
          titulo_noticia: noticia.titulo,
          subtitulo_noticia: noticia.subtitulo || "",
          fecha_noticia: fecha,
          contenido_noticia: noticia.cuerpo,
          link_noticia: link,
          fuente_noticia: "TodoSalta",
        });
      } catch (err) {
        console.log("Error en noticia:", link);
        console.log(err.message);
      } finally {
        if (noticiaPage) await noticiaPage.close();
      }
    }
  }
  await page.close();

  console.log("✔ TodoSalta terminado");

  return noticias;
}

async function obtenerLinksPaginaTS(page, pagina) {
  return await page.evaluate(async (pagina) => {
    const res = await fetch(
      `https://todosalta.com/default/listar_contenido?categoria=2&p=${pagina}`,
    );

    const html = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    return [
      ...doc.querySelectorAll("article.post.post__noticia h2.post__titulo a"),
    ].map((a) => a.getAttribute("href"));
  }, pagina);
}

app.post("/scraping/iniciar", async (req, res) => {
  const { data: running } = await supabase
    .from("scraping_jobs")
    .select("*")
    .eq("estado", "running")
    .maybeSingle();

  if (running) {
    return res.status(400).json({
      mensaje: "Ya hay un scraping en ejecución",
    });
  }

  const { data: job, error } = await supabase
    .from("scraping_jobs")
    .insert({
      estado: "running",
      progreso: 0,
      etapa: "Inicializando...",
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json(error);
  }

  ejecutarScraping(job.id);

  res.json(job);
});

app.get("/scraping/estado", async (req, res) => {
  const { data, error } = await supabase
    .from("scraping_jobs")
    .select("*")
    .order("fecha_inicio", { ascending: false })
    .limit(1)
    .single();

  if (error) return res.status(500).json(error);

  res.json(data);
});

async function ejecutarScraping(jobId) {
  let browser;

  try {
    browser = await puppeteer_.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (err) {
    console.log(err);
  }

  try {
    await actualizarJob(jobId, 5, "Obteniendo noticias de Portales: 1 / 4", 0);

    const qps = await scrapeQuePasaSalta(browser);

    await actualizarJob(
      jobId,
      20,
      "Obteniendo noticias de Portales: 2 / 4",
      qps.length,
    );

    const tribuno = await scrapeElTribuno(browser);

    await actualizarJob(
      jobId,
      40,
      "Obteniendo noticias de Portales: 3 / 4",
      tribuno.length,
    );

    const expreso = await scrapeExpreso(browser);

    await actualizarJob(
      jobId,
      60,
      "Obteniendo noticias de Portales: 4 / 4",
      expreso.length,
    );

    const todoSalta = await scrapeTodoSalta(browser);

    await actualizarJob(
      jobId,
      80,
      "Obteniendo barrios de las noticias",
      expreso.length,
    );

    const noticias = [...qps, ...tribuno, ...expreso, ...todoSalta];

    await guardarNoticias(noticias);

    let noticiasProcesadas = 0;
    // Prediccion
    try {
      const response = await axios.post(
        "http://localhost:5000/procesar_noticias",
      );

      noticiasProcesadas = response.data.procesadas;

      console.log("🧠 Minería ejecutada");
    } catch (err) {
      console.error("Error ejecutando minería:", err.message);
    }

    await supabase
      .from("scraping_jobs")
      .update({
        estado: "finished",
        progreso: 100,
        etapa: "Completado",
        total_noticias:
          qps.length + tribuno.length + expreso.length + todoSalta.length,
        procesadas: noticiasProcesadas,
        fecha_fin: new Date(),
      })
      .eq("id", jobId);
  } catch (err) {
    await supabase
      .from("scraping_jobs")
      .update({
        estado: "error",
        error: err.message,
        fecha_fin: new Date(),
      })
      .eq("id", jobId);
  } finally {
    if (browser) await browser.close();
  }
}

async function actualizarJob(jobId, progreso, etapa, total_noticias) {
  await supabase
    .from("scraping_jobs")
    .update({
      progreso,
      etapa,
      total_noticias,
    })
    .eq("id", jobId);
}

async function guardarNoticias(noticias) {
  const noticiasUnicas = Array.from(
    new Map(noticias.map((n) => [n.link_noticia, n])).values(),
  );

  const noticiasPreparadas = noticiasUnicas.map((n) => ({
    ...n,
    barrios: n.barrios ?? "SIN PREDICCION",
  }));

  const { data, error } = await supabase
    .from("noticias")
    .upsert(noticiasPreparadas, { onConflict: "link_noticia" });

  if (error) {
    console.error("Error insertando noticias:", error);
  }
}

// app.get("/scrape/noticias", async (req, res) => {
//   let browser;

//   try {
//     const browser = await puppeteer_.launch({
//       headless: "new",
//       args: ["--no-sandbox", "--disable-setuid-sandbox"],
//     });

//     const noticias = [];

//     console.log("Scraping QuePasaSalta...");
//     noticias.push(...(await scrapeQuePasaSalta(browser)));

//     // console.log("Scraping El Tribuno...");
//     // noticias.push(...(await scrapeElTribuno(browser)));

//     // console.log("Scraping Expreso...");
//     // noticias.push(...(await scrapeExpreso(browser)));

//     // console.log("Scraping Todo Salta...");
//     // noticias.push(...(await scrapeTodoSalta(browser)));

//     // const noticiasUnicas = noticias.filter(
//     //   (v, i, a) => a.findIndex((t) => t.link_noticia === v.link_noticia) === i,
//     // );

//     //console.log("Total noticias:", noticiasUnicas.length);

//     const noticiasUnicas = Array.from(
//       new Map(noticias.map((n) => [n.link_noticia, n])).values(),
//     );

//     const { data, error } = await supabase
//       .from("noticias")
//       .upsert(noticiasUnicas, { onConflict: "link_noticia" });

//     if (error) {
//       console.error("Error insertando noticias:", error);
//     }

//     res.json({
//       total: noticiasUnicas.length,
//       mensaje: "Noticias guardadas correctamente",
//     });
//   } catch (err) {
//     console.error("Error scraping:", err);
//     res.status(500).json({ error: "Error scraping noticias" });
//   } finally {
//     if (browser) await browser.close();
//   }
// });

app.get("/scrape/informate", async (req, res) => {
  try {
    const noticias = await scrapeInformateSalta();
    res.json(noticias);
  } catch (err) {
    console.error("❌ Error al scrapear  InformateSalta:", err);
    res.status(500).json({ error: "Error al scrapear InformateSalta" });
  }
});

app.get("/scrape/expreso", async (req, res) => {
  try {
    const noticias = await scrapeExpreso();
    res.json(noticias);
  } catch (err) {
    console.error("❌ Error al scrapear  Expreso:", err);
    res.status(500).json({ error: "Error al scrapear Expreso" });
  }
});

app.get("/scrape/edesa", async (req, res) => {
  try {
    const noticias = await extraerCortes();
    res.json(noticias);
  } catch (err) {
    console.error("❌ Error al scrapear  Edesa:", err);
    res.status(500).json({ error: "Error al scrapear Edesa" });
  }
});

app.get("/scrape/muni", async (req, res) => {
  try {
    let noticias = [];
    for (const url of BASE_URLS) {
      let numPag = 1;
      while (numPag <= 82) {
        const seccionNoticias = await scrapearSeccion(url, numPag);
        noticias = noticias.concat(seccionNoticias);
        numPag++;
      }
    }
    console.log(noticias);
    res.json(noticias);
  } catch (err) {
    console.error("❌ Error al scrapear El Tribuno:", err);
    res.status(500).json({ error: "Error al scrapear El Tribuno" });
  }
});

app.get("/scrape/eltribuno", async (req, res) => {
  try {
    const noticias = await scrapeElTribuno();
    res.json(noticias);
  } catch (err) {
    console.error("❌ Error al scrapear El Tribuno:", err);
    res.status(500).json({ error: "Error al scrapear El Tribuno" });
  }
});

app.get("/scrape/quepasa", async (req, res) => {
  try {
    const noticias = await scrapeQuePasaSalta();

    // const noticiasFormateadas = noticiasCrudas
    //   .map((noticia) => {
    //     const fechaFormateada = formatearFechaQuePasa(noticia.fecha);
    //     return {
    //       titulo_noticia: noticia.titulo,
    //       subtitulo_noticia: noticia.subtitulo,
    //       fecha_noticia: fechaFormateada,
    //       categoria_noticia: noticia.categorias,
    //       contenido_noticia: noticia.contenido,
    //       link_noticia: noticia.link,
    //       pieImagen_noticia: noticia.pieImagen,
    //       fuente_noticia: noticia.fuente,
    //     };
    //   })
    //   .filter((noticia) => esHoy(noticia.fecha_noticia));

    console.log("✅ Noticias del día:", noticias.length);

    // const { createClient } = require("@supabase/supabase-js");
    // const _supabase = createClient(
    //   "https://bcrjaheiscytzamzqfsd.supabase.co",
    //   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjcmphaGVpc2N5dHphbXpxZnNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE4MTQ5NjQsImV4cCI6MjA1NzM5MDk2NH0.QneglKe7vF6mXQiziSP8ZQ4ZrEIYa9vAe1UtdOxkS5s"
    // );

    // if (noticiasFormateadas.length === 0) {
    //   return res.json({ mensaje: "No hay noticias de hoy." });
    // }

    // const { data, error } = await _supabase
    //   .from("noticias")
    //   .insert(noticiasFormateadas)
    //   .select();

    // if (error) {
    //   console.error("❌ Error Supabase:", error.message);
    //   return res.status(500).json({ error: "Error guardando en Supabase" });
    // }

    res.json(noticias);
  } catch (err) {
    console.error("❌ Error al scrapear Qué Pasa:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error general en /scrape/quepasa" });
    }
  }
});

app.get("/scrape/saeta", async (req, res) => {
  try {
    const noticias = await scrapeSaeta();
    res.json(noticias);
  } catch (err) {
    console.error("❌ Error al scrapear SAETA:", err);
    res.status(500).json({ error: "Error al scrapear SAETA" });
  }
});

app.get("/scrape-progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  clients.push(res);

  req.on("close", () => {
    clients = clients.filter((client) => client !== res);
  });
});

app.listen(3000, () => {
  console.log("🚀 Servidor corriendo en http://localhost:3000");
});

// Formatea: "23 Mayo 2024 - 10:12" → "2024-05-23"
function formatearFechaSaeta(fechaTexto) {
  const meses = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12",
  };
  const partes = fechaTexto.toLowerCase().split(" ");
  if (partes.length >= 3) {
    const dia = partes[0].padStart(2, "0");
    const mes = meses[partes[1]] || "00";
    const anio = partes[2];
    return `${anio}-${mes}-${dia}`;
  }
  return "";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extraerCortes() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("https://www.edesa.com.ar/widgets/cortes.php", {
    waitUntil: "domcontentloaded",
  });

  // Esperar a que cargue el calendario visible
  await page.waitForSelector(".outages-calendar:not(.d-none)", {
    timeout: 60000,
  });
  await delay(1500); // darle tiempo a que aparezcan puntos verdes

  const cortes = [];

  // Seleccionar solo el calendario del mes actual (visible)
  const calendarioVisible = await page.$(".outages-calendar:not(.d-none)");

  // Obtener todos los días con evento en el mes actual
  const diasConEvento = await calendarioVisible.$$(".outages-event");

  for (const dia of diasConEvento) {
    try {
      await dia.click();
      await delay(1000);

      const tarjetas = await page.$$(".outage-card.card");

      //console.log(`🔍 Procesando ${tarjetas.length} cortes para el día...`);

      for (const tarjeta of tarjetas) {
        const titulo = await tarjeta.$eval(
          ".outage-card-bold",
          (el) => el.textContent?.trim() || "",
        );

        const fecha = await tarjeta.$eval(
          ".outage-card-header-button",
          (el) => {
            const text = el.textContent || "";
            const partes = text.split(/\d{2}\/\d{2}\/\d{4}/); // separa zona/fecha
            const match = text.match(/\d{2}\/\d{2}\/\d{4}.*$/);
            return match ? match[0].trim() : "";
          },
        );

        const duracion = await tarjeta.$eval(
          ".card-body div:nth-child(1)",
          (el) => el.textContent.replace("Duración", "").trim(),
        );

        const zona = await tarjeta.$eval(".card-body div:nth-child(2)", (el) =>
          el.textContent.replace("Zona", "").trim(),
        );

        const estado = await tarjeta.$eval(
          ".card-body div:nth-child(3)",
          (el) =>
            el.textContent.replace("Estado", "").replace(/\s+/g, " ").trim(),
        );

        const motivo = await tarjeta.$eval(
          ".card-body div:nth-child(4)",
          (el) => el.textContent.replace("Motivo", "").trim(),
        );

        // Verificar si ya existe un corte con ese título
        const existe = cortes.some((corte) => corte.titulo === titulo);

        if (!existe && titulo.toUpperCase().includes("SALTA")) {
          cortes.push({
            titulo,
            fecha,
            duracion,
            zona,
            estado,
            motivo,
          });
        }
      }
    } catch (e) {
      console.error("⚠️ Error al procesar día:", e.message);
    }
  }

  await browser.close();
  return cortes;
}

function formatearFechaInformate(fechaStr) {
  const [dia, mes, anio] = fechaStr.split("/");
  if (!dia || !mes || !anio) return null;
  return `${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

function formatearFecha(fechaTexto) {
  const meses = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12",
  };

  const regex = /(\d{1,2}) de (\w+) de (\d{4})/i;
  const match = fechaTexto.match(regex);

  if (!match) return ""; // o podés lanzar un error

  const dia = match[1].padStart(2, "0");
  const mes = meses[match[2].toLowerCase()] || "01";
  const anio = match[3];

  return `${anio}-${mes}-${dia}`;
}

function sendProgress(progress) {
  clients.forEach((client) => {
    client.write(`data: ${JSON.stringify({ progress })}\n\n`);
  });
}

const scrapeCorredor = async (corredor, browser) => {
  const corredorPage = await browser.newPage();
  await corredorPage.goto(corredor.url, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const contenidoPorPestania = [];

  const tabSelectors = await corredorPage.$$eval(
    ".nav-tabs .nav-link",
    (tabs) =>
      tabs.map((tab) => ({
        text: tab.textContent.trim(),
        selector: tab.getAttribute("href"),
      })),
  );

  //console.log("[📎 TAB SELECTORS]", tabSelectors);

  for (const { text, selector } of tabSelectors) {
    const urlPestania = `https://saetasalta.com.ar/saetaw/${selector}`;

    await corredorPage.goto(urlPestania, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Esperá un poco para asegurar que el contenido se haya cargado completamente
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const contenido = await corredorPage.evaluate(() => {
      const getListBelowTitle = (titleText) => {
        const title = Array.from(document.querySelectorAll("h3")).find((el) =>
          el.textContent.includes(titleText),
        );
        if (!title) return null;

        const container = [];
        let el = title.nextElementSibling;

        while (el && el.tagName !== "H3") {
          container.push(el.textContent.trim());
          el = el.nextElementSibling;
        }

        return container.join("\n").trim();
      };

      return {
        puntosInteres: getListBelowTitle(
          "Cobertura de puntos de interés general y turístico",
        ),
        barrios: getListBelowTitle("Cobertura de barrios"),
      };
    });

    contenidoPorPestania.push({
      pestania: text.replace(/\s+/g, " ").trim(),
      url: urlPestania, // 👈 ACÁ agregamos el link real
      puntosInteres: contenido.puntosInteres,
      barrios: contenido.barrios,
    });
  }

  await corredorPage.close();

  return {
    corredor: corredor.nombre,
    url: corredor.url,
    pestañas: contenidoPorPestania,
  };
};

const obtenerLinksCorredores = async (page) => {
  await page.goto("https://saetasalta.com.ar/saetaw/corredores", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  return await page.$$eval(".fact-item h2 a", (links) =>
    links.map((link) => ({
      nombre: link.textContent.trim(),
      url: link.href,
    })),
  );
};

function convertirFecha(fechaTexto) {
  const meses = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    septiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12",
  };

  const partes = fechaTexto.toLowerCase().split(" ");

  if (partes.length < 4) return null;

  const dia = partes[0].padStart(2, "0");
  const mes = meses[partes[2]];
  const anio = partes[4] || partes[3];

  return `${anio}-${mes}-${dia}`;
}

app.post("/cancelar", (req, res) => {
  scrapingCancelado = true;
  console.log("🚫 Scraping cancelado por el usuario");
  res.sendStatus(200);
});

app.get("/scrape", async (req, res) => {
  try {
    scrapingCancelado = false;
    sendProgress(5); // Arranca
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    if (scrapingCancelado) {
      await browser.close();
      sendProgress(100);
      return res.status(200).json({ cancelado: true });
    }

    sendProgress(15); // Navegador lanzado

    if (scrapingCancelado) {
      await browser.close();
      sendProgress(100);
      return res.status(200).json({ cancelado: true });
    }

    const page = await browser.newPage();
    const corredorLinks = await obtenerLinksCorredores(page);
    sendProgress(30); // Links de corredores obtenidos

    if (scrapingCancelado) {
      await browser.close();
      sendProgress(100);
      return res.status(200).json({ cancelado: true });
    }

    const data = [];

    for (let i = 0; i < corredorLinks.length; i++) {
      if (scrapingCancelado) {
        await browser.close();
        // sendProgress(100);
        return res.status(200).json({ cancelado: true });
      }
      const corredor = corredorLinks[i];
      // console.log(corredor);
      const resultado = await scrapeCorredor(corredor, browser);
      data.push(resultado);

      // Calculá progreso basado en la cantidad total
      const porcentaje = 30 + Math.round(((i + 1) / corredorLinks.length) * 60); // Hasta 90%
      sendProgress(porcentaje);
    }

    await browser.close();

    const resultadoPlano = [];

    for (const corredor of data) {
      for (const pestania of corredor.pestañas) {
        resultadoPlano.push({
          tab: `${corredor.corredor} ${pestania.pestania}`,
          puntosInteres: pestania.puntosInteres,
          barrios: pestania.barrios,
          url: pestania.url,
        });
      }
    }

    res.json(resultadoPlano);

    // sendProgress(100); // Finalizado
    // res.json(data);
  } catch (err) {
    console.error("[❌ ERROR EN SCRAPE]:", err.message);
    console.error("[🧠 Stack]:", err.stack);
    sendProgress(100); // Cerrá el ciclo aunque falle
    res.status(500).json({ error: "Error durante el scraping" });
  }
});
