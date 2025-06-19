const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");

const app = express();
app.use(cors());

let clients = [];
let scrapingCancelado = false;

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

async function scrapeQuePasaSalta({ onProgress, cancelar } = {}) {
  let contador = 0;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  const noticias = [];

  const url = "https://www.quepasasalta.com.ar/seccion/salta/";

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });

    // Click en "Ver más" hasta 3 veces
    for (let i = 0; i < 3; i++) {
      try {
        const verMas = await page.$("div.moreitems");
        if (!verMas) break;
        await verMas.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        console.warn("⚠️ No se pudo hacer click en 'Ver más':", err.message);
        break;
      }
    }

    const links = await page.evaluate(() => {
      const sections = Array.from(
        document.querySelectorAll(
          "section.piece.news.standard.news.fixed-height"
        )
      );

      const articleLinks = sections.flatMap((section) => {
        return Array.from(section.querySelectorAll("article a"))
          .map((a) => a.href)
          .filter((href) => href.includes("/salta/"));
      });

      return [...new Set(articleLinks)];
    });

    console.log("🔗 Links encontrados:", links.length);

    const yaProcesados = new Set();
    console.log(links.length);
    for (const link of links) {
      const linkLimpio = link.replace("/#comentarios", "");

      if (cancelar?.()) break;
      if (yaProcesados.has(linkLimpio)) continue;
      yaProcesados.add(linkLimpio);

      const noticiaPage = await browser.newPage();
      try {
        await noticiaPage.goto(linkLimpio, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        const data = await noticiaPage.evaluate(() => {
          const getText = (selector) =>
            document.querySelector(selector)?.textContent?.trim() || "";

          const titulo = getText("h1");
          const subtitulo = getText("h2");
          const fecha =
            document.querySelector("div.kt time")?.textContent?.trim() || "";

          const categorias = Array.from(
            document.querySelectorAll("section.tag-section ul.tag-list li")
          ).map((li) => li.textContent.trim());

          const contenido = Array.from(
            document.querySelectorAll("#vsmcontent p")
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

        noticias.push({ ...data, fuente: "Qué Pasa Salta", link: linkLimpio });
        contador++;
        console.log(contador);
      } catch (err) {
        console.warn("❌ Error en link:", linkLimpio, err.message);
      } finally {
        await noticiaPage.close();
      }
    }
  } catch (err) {
    console.error("❌ Error general:", err.message);
  } finally {
    await browser.close();
  }

  const noticiasFormateadas = noticias
    .map((noticia) => {
      return {
        titulo_noticia: noticia.titulo,
        subtitulo_noticia: noticia.subtitulo,
        fecha_noticia: formatearFechaQuePasa(noticia.fecha),
        categoria_noticia: noticia.categorias,
        contenido_noticia: noticia.contenido,
        link_noticia: noticia.link,
        pieImagen_noticia: noticia.pieImagen,
        fuente_noticia: noticia.fuente,
      };
    })
    .filter((noticia) => esHoy(noticia.fecha_noticia));
  console.log("Cantidad de filtradas: " + noticiasFormateadas.length);
  return noticiasFormateadas;
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});

async function scrapeElTribuno() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
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
      await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });

      const nuevosLinks = await page.evaluate(() => {
        const getLinks = (selector) =>
          Array.from(document.querySelectorAll(selector))
            .map((a) => a.href || a.getAttribute("href"))
            .filter(Boolean)
            .map((href) =>
              href.startsWith("http")
                ? href
                : `https://www.eltribuno.com${href}`
            )
            .filter(
              (href) => href.includes("/salta/") && !href.includes("/ttag/")
            );

        const articleLinks = getLinks("div.seccion_box-linea.mobile article a");
        const sabanaLinks = getLinks(
          "section.bloque.bloque-sabana.container div a"
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
        waitUntil: "networkidle2",
        timeout: 15000,
      });

      const data = await noticiaPage.evaluate(() => {
        const titulo = document.querySelector("h1")?.innerText || "";
        let fecha =
          document.querySelector(".articulo__fecha.mobile")?.innerText || "";
        const subtitulo =
          document.querySelector(".articulo__intro")?.innerText || "";
        const categorias = Array.from(document.querySelectorAll(".tags__item"))
          .map((el) => el.innerText.trim())
          .join(", ");
        const mostrarNotaDiv = document.querySelector(
          '[amp-access="mostrarNota"]'
        );
        const contenido = mostrarNotaDiv
          ? Array.from(mostrarNotaDiv.querySelectorAll("p"))
              .filter((p) => !p.closest(".container-spot")) // Excluye los que estén dentro de publicidad
              .map((p) => p.innerText.trim())
              .join("\n")
          : "";
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
        titulo: data.titulo,
        fechaFormateada: formatearFecha(data.fecha),
        categorias: data.categorias,
        contenido: data.contenido,
        pieImagen: data.pieImagen,
        link,
        fuente: "El Tribuno",
      });
      console.log(contador++);
    } catch (err) {
      console.error(`❌ Error procesando ${link}:`, err.message);
    } finally {
      if (noticiaPage) await noticiaPage.close();
    }
  }

  await browser.close();
  return noticias.filter((n) => esHoy(n.fechaFormateada));
}

async function scrapeExpreso() {
  const puppeteer = require("puppeteer");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  const noticias = [];
  const base = "https://elexpresodesalta.com.ar/categoria/3/salta";

  try {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });

    const maxPaginas = 8;

    for (let pagina = 1; pagina <= maxPaginas; pagina++) {
      const urlPagina = pagina === 1 ? base : `${base}?pagina=${pagina}`;
      console.log(`🔗 Página ${pagina}:`);

      try {
        await page.goto(urlPagina, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Intento de extracción de links
        const links = await page.evaluate(() => {
          return Array.from(
            document.querySelectorAll("article.post__noticia > a")
          )
            .map(
              (a) => "https://elexpresodesalta.com.ar" + a.getAttribute("href")
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
              titulo: data.titulo,
              fechaFormateada: formatearFecha(data.fechaTexto),
              categoria: data.categoria,
              contenido: data.contenido,
              link,
              fuente: "El Periodico Expreso",
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
    await browser.close();
  }

  return noticias.filter((n) => esHoy(n.fechaFormateada));
}

async function scrapeInformateSalta() {
  const puppeteer = require("puppeteer");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  const noticias = [];
  const base = "https://informatesalta.com.ar/categoria/53/cnn-salta";

  try {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });

    const maxPaginas = 8;

    for (let pagina = 1; pagina <= maxPaginas; pagina++) {
      const urlPagina = pagina === 1 ? base : `${base}?pagina=${pagina}`;
      console.log(`🔗 Página ${pagina}:`);

      try {
        await page.goto(urlPagina, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Intento de extracción de links
        const links = await page.evaluate(() => {
          return Array.from(
            document.querySelectorAll("article.post__noticia > a")
          )
            .map(
              (a) => "https://informatesalta.com.ar" + a.getAttribute("href")
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
              titulo: data.titulo,
              fechaFormateada: formatearFechaInformate(data.fechaTexto),
              categoria: data.categoria,
              contenido: data.contenido,
              link,
              fuente: "Informate Salta",
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
    console.error("❌ Error al scrapear InformateSalta:", err.message);
  } finally {
    await browser.close();
  }

  return noticias.filter((n) => esHoy(n.fechaFormateada));
}

function formatearFechaInformate(fechaStr) {
  const [dia, mes, anio] = fechaStr.split("/");
  if (!dia || !mes || !anio) return null;
  return `${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

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
      }))
  );

  console.log("[📎 TAB SELECTORS]", tabSelectors);

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
          el.textContent.includes(titleText)
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
          "Cobertura de puntos de interés general y turístico"
        ),
        barrios: getListBelowTitle("Cobertura de barrios"),
      };
    });

    contenidoPorPestania.push({
      pestania: text,
      ...contenido,
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
    }))
  );
};

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
        sendProgress(100);
        return res.status(200).json({ cancelado: true });
      }
      const corredor = corredorLinks[i];
      const resultado = await scrapeCorredor(corredor, browser);
      data.push(resultado);

      // Calculá progreso basado en la cantidad total
      const porcentaje = 30 + Math.round(((i + 1) / corredorLinks.length) * 60); // Hasta 90%
      sendProgress(porcentaje);
    }

    await browser.close();
    sendProgress(100); // Finalizado
    res.json(data);
  } catch (err) {
    console.error("[❌ ERROR EN SCRAPE]:", err.message);
    console.error("[🧠 Stack]:", err.stack);
    sendProgress(100); // Cerrá el ciclo aunque falle
    res.status(500).json({ error: "Error durante el scraping" });
  }
});
