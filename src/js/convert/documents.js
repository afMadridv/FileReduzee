// Documentos: DOCX, PDF, Markdown, HTML, TXT y PPTX.
//
// Todo pasa por un documento HTML intermedio, parseado con DOMParser y nunca
// insertado en la página: un DOMParser no ejecuta scripts ni descarga
// imágenes, así que un HTML o un Markdown hostil no puede hacer nada acá.
// Cada formato sabe leerse a HTML y cada destino sabe escribirse desde HTML;
// con 6 lectores y 5 escritores se cubre la matriz completa.

import { escapeHtml, readText, textBlob } from './text.js';
import { MIME } from './registry.js';

// --- Lectores: archivo -> { doc, title, note } -------------------------------

function parse(html, title = '') {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${html}</body></html>`,
    'text/html',
  );
  // Nada ejecutable ni remoto sobrevive al paso por acá.
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta[http-equiv],base,form,noscript,template')
    .forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((a) => {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
  });
  return doc;
}

function baseName(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

async function fromDocx(file) {
  const mod = await import('mammoth/mammoth.browser.min.js');
  const mammoth = mod.default ?? mod;
  const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return { doc: parse(res.value, baseName(file.name)) };
}

async function fromMarkdown(file) {
  const { marked } = await import('marked');
  const html = await marked.parse(await readText(file), { gfm: true });
  return { doc: parse(html, baseName(file.name)) };
}

async function fromHtml(file) {
  const src = new DOMParser().parseFromString(await readText(file), 'text/html');
  const title = src.title || baseName(file.name);
  return { doc: parse(src.body?.innerHTML ?? '', title) };
}

async function fromTxt(file) {
  const text = (await readText(file)).replace(/\r\n?/g, '\n');
  // Líneas en blanco separan párrafos; un salto simple se respeta como salto.
  const html = text.split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return { doc: parse(html, baseName(file.name)) };
}

async function fromPdf(file, onProgress) {
  const { extractBlocks } = await import('./pdf.js');
  const pages = await extractBlocks(file, onProgress);
  const html = pages.map((blocks) => blocks.map((b) => `<${b.type}>${escapeHtml(b.text)}</${b.type}>`).join('\n'))
    .join('\n<hr>\n');
  return {
    doc: parse(html, baseName(file.name)),
    note: 'Se extrajo el texto; los títulos se deducen por tamaño de letra. Imágenes, tablas y maquetación del PDF no se trasladan.',
  };
}

async function fromPptx(file) {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name),
  });
  const slides = Object.keys(files)
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  if (slides.length === 0) throw new Error('no se encontraron diapositivas: el archivo no parece un .pptx válido');

  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const html = slides.map((path, i) => {
    const xml = new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml');
    const paras = [...xml.getElementsByTagNameNS(A, 'p')]
      .map((p) => [...p.getElementsByTagNameNS(A, 't')].map((t) => t.textContent).join(''))
      .map((t) => t.trim())
      .filter(Boolean);
    const [first, ...rest] = paras;
    return `<h2>${escapeHtml(`Diapositiva ${i + 1}${first ? ` — ${first}` : ''}`)}</h2>\n`
      + rest.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  }).join('\n');

  return {
    doc: parse(html, baseName(file.name)),
    note: `Se extrajo el texto de ${slides.length} diapositiva${slides.length === 1 ? '' : 's'}. Diseño, imágenes y animaciones no se trasladan.`,
  };
}

const READERS = {
  docx: fromDocx,
  md: fromMarkdown,
  markdown: fromMarkdown,
  html: fromHtml,
  htm: fromHtml,
  txt: fromTxt,
  pdf: fromPdf,
  pptx: fromPptx,
};

// --- Imágenes embebidas ------------------------------------------------------

// PDF y DOCX sólo aceptan PNG o JPEG. Lo demás (GIF, WebP, SVG embebidos) se
// pasa a PNG. Lo que apunte afuera se descarta: no se sale a internet a buscar
// nada, esa es la promesa de la app.
async function normalizeImages(doc) {
  for (const img of [...doc.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('data:image/')) {
      img.remove();
      continue;
    }
    try {
      const blob = await (await fetch(src)).blob();
      const bitmap = await createImageBitmap(blob);
      let { width, height } = bitmap;

      if (!/^data:image\/(png|jpe?g);/i.test(src)) {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        c.getContext('2d').drawImage(bitmap, 0, 0);
        img.setAttribute('src', c.toDataURL('image/png'));
      }
      bitmap.close?.();

      const attrW = Number(img.getAttribute('width'));
      if (attrW > 0) {
        height = Math.round(height * (attrW / width));
        width = attrW;
      }
      img.setAttribute('width', String(width));
      img.setAttribute('height', String(height));
    } catch {
      // Formato que el navegador no decodifica (EMF/WMF de Word, por ejemplo).
      img.replaceWith(doc.createTextNode('[imagen no convertible]'));
    }
  }
}

// --- Escritores: doc -> Blob --------------------------------------------------

function toStandaloneHtml(doc) {
  const title = escapeHtml(doc.title || 'Documento');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { max-width: 46rem; margin: 2.5rem auto; padding: 0 1.25rem; font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1d1f27; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.6em 0 .5em; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d0d3de; padding: .45em .6em; text-align: left; vertical-align: top; }
  th { background: #f3f4f8; }
  pre { background: #f3f4f8; padding: 1em; overflow-x: auto; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: .92em; }
  blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #d0d3de; color: #4a4e5c; }
</style>
</head>
<body>
${doc.body.innerHTML}
</body>
</html>
`;
}

// Word guarda cada celda como uno o más párrafos. Para texto plano y Markdown
// una celda tiene que ser una sola línea: los párrafos internos se unen con
// un salto, que Markdown escribe como <br>.
function flattenCells(doc) {
  doc.querySelectorAll('td, th').forEach((cell) => {
    const paras = [...cell.querySelectorAll(':scope > p')];
    paras.forEach((p, i) => {
      const frag = doc.createDocumentFragment();
      if (i > 0) frag.append(doc.createElement('br'));
      frag.append(...p.childNodes);
      p.replaceWith(frag);
    });
  });
}

// Markdown (GFM) sólo tiene tablas con fila de encabezado. Word no marca
// encabezados, así que la primera fila pasa a serlo; si no, turndown deja la
// tabla como HTML crudo en medio del .md.
function ensureHeaderRows(doc) {
  doc.querySelectorAll('table').forEach((table) => {
    if (table.querySelector('thead, th')) return;
    const first = table.querySelector('tr');
    if (!first) return;
    first.querySelectorAll('td').forEach((td) => {
      const th = doc.createElement('th');
      th.append(...td.childNodes);
      td.replaceWith(th);
    });
    const thead = doc.createElement('thead');
    first.parentElement.insertBefore(thead, first);
    thead.append(first);
  });
}

// Texto plano respetando bloques: un párrafo por línea, ítems con viñeta,
// celdas separadas por tabulación.
function toPlainText(doc) {
  flattenCells(doc);
  const out = [];
  const BLOCK = /^(P|DIV|H[1-6]|LI|TR|BLOCKQUOTE|PRE|SECTION|ARTICLE|HEADER|FOOTER|TABLE|UL|OL|FIGURE|FIGCAPTION|HR)$/;

  const walk = (node, line) => {
    node.childNodes.forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) {
        line.text += c.parentElement?.closest('pre') ? c.textContent : c.textContent.replace(/\s+/g, ' ');
        return;
      }
      if (c.nodeType !== Node.ELEMENT_NODE) return;
      const tag = c.tagName;
      // Un salto dentro de una celda rompería la fila en dos.
      if (tag === 'BR') { line.text += c.closest('td,th') ? ' ' : '\n'; return; }
      if (tag === 'IMG') return;
      if (tag === 'TD' || tag === 'TH') {
        if (line.cells++ > 0) line.text += '\t';
        walk(c, line);
        return;
      }
      if (BLOCK.test(tag)) {
        flush(line);
        if (tag === 'HR') { out.push(''); return; }
        const child = { text: '', cells: 0 };
        if (tag === 'LI') {
          const ol = c.parentElement?.tagName === 'OL';
          const idx = [...c.parentElement.children].indexOf(c) + 1;
          child.text = ol ? `${idx}. ` : '• ';
        }
        walk(c, child);
        flush(child);
        if (/^(P|H[1-6]|BLOCKQUOTE|PRE|TABLE|UL|OL)$/.test(tag)) out.push('');
        return;
      }
      walk(c, line);
    });
  };

  const flush = (line) => {
    const t = line.text.replace(/[ \t]+\n/g, '\n').trimEnd();
    if (t.replace(/^[•\d.\s]+$/, '').trim()) out.push(t.replace(/^ +/, ''));
    line.text = '';
    line.cells = 0;
  };

  const root = { text: '', cells: 0 };
  walk(doc.body, root);
  flush(root);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

async function toMarkdown(doc) {
  flattenCells(doc);
  ensureHeaderRows(doc);
  const [{ default: TurndownService }, { gfm }] = await Promise.all([
    import('turndown'),
    import('turndown-plugin-gfm'),
  ]);
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  td.use(gfm);
  // Imágenes incrustadas como base64 hacen un .md ilegible de varios MB.
  td.addRule('imagenesIncrustadas', {
    filter: (n) => n.nodeName === 'IMG' && (n.getAttribute('src') || '').startsWith('data:'),
    replacement: (_c, n) => (n.getAttribute('alt') ? `*[imagen: ${n.getAttribute('alt')}]*` : '*[imagen]*'),
  });
  return `${td.turndown(doc.body.innerHTML).trim()}\n`;
}

async function toPdf(doc) {
  await normalizeImages(doc);
  // Sin esto cada celda arrastra el margen de sus párrafos y las filas salen
  // el doble de altas.
  flattenCells(doc);

  const [{ default: pdfMake }, vfsMod, { default: htmlToPdfmake }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
    import('html-to-pdfmake'),
  ]);
  pdfMake.addVirtualFileSystem(vfsMod.default ?? vfsMod);

  const content = htmlToPdfmake(doc.body.innerHTML, { window });

  // Ancho útil de A4 con 40 pt de margen: 515 pt. Una imagen más ancha se
  // saldría de la hoja.
  const fitImages = (node) => {
    if (Array.isArray(node)) { node.forEach(fitImages); return; }
    if (!node || typeof node !== 'object') return;
    if (node.image) {
      const w = Number(node.width) || 515;
      if (w > 515) { node.width = 515; delete node.height; }
    }
    ['stack', 'columns', 'ul', 'ol', 'text'].forEach((k) => node[k] && fitImages(node[k]));
    if (node.table?.body) node.table.body.forEach(fitImages);
  };
  fitImages(content);

  const definition = {
    info: { title: doc.title || 'Documento', creator: 'FileReduzee' },
    pageSize: 'A4',
    pageMargins: [40, 48, 40, 48],
    content,
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.3 },
    styles: {
      'html-h1': { fontSize: 22, bold: true, marginTop: 10, marginBottom: 6 },
      'html-h2': { fontSize: 17, bold: true, marginTop: 10, marginBottom: 5 },
      'html-h3': { fontSize: 14, bold: true, marginTop: 8, marginBottom: 4 },
      'html-h4': { fontSize: 12, bold: true, marginTop: 6, marginBottom: 3 },
      'html-p': { marginBottom: 6 },
      'html-pre': { fontSize: 9, background: '#f3f4f8', preserveLeadingSpaces: true },
      'html-code': { background: '#f3f4f8' },
      'html-blockquote': { italics: true, color: '#4a4e5c', marginLeft: 14 },
      'html-th': { bold: true, fillColor: '#f3f4f8' },
      'html-a': { color: '#3b5bdb', decoration: 'underline' },
    },
  };

  return pdfMake.createPdf(definition).getBlob();
}

async function toDocx(doc) {
  await normalizeImages(doc);
  const { htmlDocToDocx } = await import('./html-to-docx.js');
  return htmlDocToDocx(doc, doc.title);
}

const WRITERS = {
  html: async (doc) => textBlob(toStandaloneHtml(doc), MIME.html),
  txt: async (doc) => textBlob(toPlainText(doc), MIME.txt),
  md: async (doc) => textBlob(await toMarkdown(doc), MIME.md),
  pdf: toPdf,
  docx: toDocx,
};

const TARGET_NOTES = {
  pdf: 'Conserva texto, títulos, listas, tablas e imágenes. No reproduce la maquetación exacta del original (márgenes, columnas, encabezados y pies de página).',
  docx: 'Documento Word editable con títulos, listas, tablas, enlaces e imágenes.',
  md: 'Markdown con tablas estilo GitHub. Las imágenes incrustadas quedan como marcador: un .md no puede contenerlas.',
  html: 'Página HTML autónoma, con las imágenes incrustadas.',
  txt: 'Texto plano: se pierde todo el formato, se conserva el orden y la estructura por líneas.',
};

export async function convertDocument(file, ext, target, onProgress) {
  const read = READERS[ext];
  const write = WRITERS[target];
  if (!read || !write) throw new Error(`no hay conversión de ${ext.toUpperCase()} a ${target.toUpperCase()}`);

  onProgress({ percent: null, stage: 'Leyendo el documento…' });
  const { doc, note } = await read(file, onProgress);

  if (!doc.body.textContent.trim() && !doc.querySelector('img')) {
    throw new Error('el documento está vacío: no hay texto que convertir');
  }

  onProgress({ percent: null, stage: `Escribiendo ${target.toUpperCase()}…` });
  const blob = await write(doc);

  return {
    blob,
    // Si el origen ya perdió cosas al leerse (PDF, PPTX), esa es la nota que
    // importa; la del destino prometería tablas e imágenes que no vinieron.
    notes: [note ?? TARGET_NOTES[target]],
  };
}
