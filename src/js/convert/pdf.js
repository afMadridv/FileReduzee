// Lectura de PDF con pdf.js: texto estructurado y render de páginas.
// Se carga bajo demanda; pdf.js y su worker suman ~1.5 MB.

import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Abre el PDF, corre fn y libera el worker siempre, incluso si fn lanza. En
// pdf.js 6 destroy() vive en la tarea de carga, no en el documento.
async function withPdf(file, fn) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerURL;
  const data = new Uint8Array(await file.arrayBuffer());
  // isEvalSupported:false cierra la vía de ejecución de código desde fuentes
  // del PDF: el archivo viene de afuera y no es de fiar.
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  try {
    return await fn(await task.promise);
  } finally {
    await task.destroy();
  }
}

// Reconstruye líneas a partir de los fragmentos de texto de una página.
function pageLines(items) {
  const lines = [];
  let current = null;

  for (const it of items) {
    if (!('str' in it)) continue;
    const y = it.transform[5];
    const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 0;

    if (!current || Math.abs(current.y - y) > Math.max(2, size * 0.5)) {
      if (current && current.text.trim()) lines.push(current);
      current = { y, size, text: '' };
    }

    current.text += it.str;
    current.size = Math.max(current.size, size);

    if (it.hasEOL) {
      if (current.text.trim()) lines.push(current);
      current = null;
    }
  }
  if (current && current.text.trim()) lines.push(current);

  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }));
}

// Devuelve bloques { type: 'h1'|'h2'|'p', text } por página. Los títulos se
// deducen por tamaño de letra: es una aproximación, no la estructura original
// (un PDF no guarda "esto es un título", sólo dibuja letras más grandes).
export async function extractBlocks(file, onProgress = () => {}) {
  const pages = await withPdf(file, async (pdf) => {
    const out = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress({ percent: (n / pdf.numPages) * 100, stage: `Leyendo página ${n} de ${pdf.numPages}…` });
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      out.push(pageLines(content.items));
      page.cleanup();
    }
    return out;
  });

  // Tamaño de cuerpo = el más frecuente ponderado por cantidad de letras.
  const weight = new Map();
  for (const line of pages.flat()) {
    const k = Math.round(line.size);
    weight.set(k, (weight.get(k) ?? 0) + line.text.length);
  }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;

  const result = pages.map((lines) => {
    const blocks = [];
    let prev = null;

    for (const line of lines) {
      const ratio = line.size / body;
      const type = line.text.length < 140 && ratio >= 1.45 ? 'h1'
        : line.text.length < 140 && ratio >= 1.15 ? 'h2'
          : 'p';

      const gap = prev ? prev.y - line.y : 0;
      const sameParagraph = prev
        && type === 'p' && prev.type === 'p'
        && gap > 0 && gap < line.size * 1.9;

      if (sameParagraph) {
        const last = blocks[blocks.length - 1];
        // Palabra cortada con guion al final de línea: se vuelve a unir.
        last.text = /[a-záéíóúñ]-$/i.test(last.text) && /^[a-záéíóúñ]/.test(line.text)
          ? last.text.slice(0, -1) + line.text
          : `${last.text} ${line.text}`;
      } else {
        blocks.push({ type, text: line.text });
      }
      prev = { ...line, type };
    }
    return blocks;
  });

  const chars = result.flat().reduce((n, b) => n + b.text.length, 0);
  if (chars === 0) {
    throw new Error('este PDF no tiene texto seleccionable: es una imagen escaneada. Convertilo a PNG o JPG; sacar texto de una imagen requiere OCR.');
  }
  return result;
}

// Renderiza cada página a una imagen. Escala 2 ≈ 144 ppp: nítido en pantalla
// y legible impreso, sin generar archivos gigantes.
export async function renderPages(file, type, onProgress = () => {}) {
  return withPdf(file, (pdf) => renderAll(pdf, type, onProgress));
}

async function renderAll(pdf, type, onProgress) {
  const out = [];
  const MAX_SIDE = 4096;

  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress({ percent: ((n - 1) / pdf.numPages) * 100, stage: `Dibujando página ${n} de ${pdf.numPages}…` });
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, MAX_SIDE / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    // Fondo blanco explícito: sin él un JPG sale con fondo negro donde la
    // página no pinta nada. intent 'print': con el intent normal pdf.js
    // dibuja a ritmo de requestAnimationFrame, que el navegador congela en
    // pestañas de fondo; cambiar de pestaña a mitad de un PDF largo lo dejaba
    // colgado.
    await page.render({ canvas, viewport, background: 'white', intent: 'print' }).promise;

    const blob = await new Promise((r) => canvas.toBlob(r, type, 0.92));
    out.push(new Uint8Array(await blob.arrayBuffer()));

    canvas.width = canvas.height = 0;
    page.cleanup();
  }

  return out;
}
