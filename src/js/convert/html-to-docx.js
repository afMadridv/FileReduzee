// HTML (un documento ya parseado, fuera de la página) -> DOCX real.
//
// No se usa el truco de "altChunk" (meter HTML crudo dentro del .docx): Word
// lo abre, pero LibreOffice y Google Docs muestran una página en blanco. Acá
// se arma el documento con párrafos, listas, tablas e imágenes de verdad.

import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const HEADINGS = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6,
};

const INLINE = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DFN', 'DEL', 'EM', 'FONT', 'I', 'IMG',
  'INS', 'KBD', 'LABEL', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP',
  'TIME', 'U', 'VAR',
]);

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'HEAD', 'META', 'LINK', 'svg']);

// Ancho útil de una página A4 con márgenes normales, en píxeles (≈ 6.3").
const MAX_IMAGE_WIDTH = 600;

function isInline(node) {
  return node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && INLINE.has(node.tagName));
}

function dataUrlToImage(src) {
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(src || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const kind = m[1].toLowerCase();
  return { data: bytes, type: kind === 'jpeg' ? 'jpg' : kind };
}

class Builder {
  constructor() {
    this.listInstance = 0;
  }

  // --- Contenido en línea -> TextRun / ExternalHyperlink / ImageRun ---------

  runs(node, fmt = {}, out = []) {
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.textContent;
      if (!fmt.pre) text = text.replace(/\s+/g, ' ');
      if (!text) return out;

      if (fmt.pre) {
        // El salto final de un bloque de código no es una línea vacía más.
        text.replace(/\n$/, '').split('\n').forEach((line, i) => {
          out.push(new TextRun({ text: line, break: i > 0 ? 1 : 0, font: 'Consolas', size: 20 }));
        });
        return out;
      }

      const run = new TextRun({
        text,
        bold: fmt.bold,
        italics: fmt.italics,
        underline: fmt.underline ? {} : undefined,
        strike: fmt.strike,
        superScript: fmt.sup,
        subScript: fmt.sub,
        highlight: fmt.mark ? 'yellow' : undefined,
        font: fmt.code ? 'Consolas' : undefined,
        style: fmt.link ? 'Hyperlink' : undefined,
      });
      out.push(fmt.link ? new ExternalHyperlink({ link: fmt.link, children: [run] }) : run);
      return out;
    }

    if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has(node.tagName)) return out;

    const tag = node.tagName;
    if (tag === 'BR') {
      out.push(new TextRun({ text: '', break: 1 }));
      return out;
    }
    if (tag === 'IMG') {
      const img = this.image(node);
      if (img) out.push(img);
      return out;
    }

    const next = { ...fmt };
    if (tag === 'B' || tag === 'STRONG') next.bold = true;
    if (tag === 'I' || tag === 'EM' || tag === 'CITE' || tag === 'DFN' || tag === 'VAR') next.italics = true;
    if (tag === 'U' || tag === 'INS') next.underline = true;
    if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') next.strike = true;
    if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') next.code = true;
    if (tag === 'SUP') next.sup = true;
    if (tag === 'SUB') next.sub = true;
    if (tag === 'MARK') next.mark = true;
    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      // Sólo enlaces reales: nada de javascript: ni anclas internas rotas.
      if (/^(https?:|mailto:)/i.test(href)) next.link = href;
    }

    node.childNodes.forEach((c) => this.runs(c, next, out));
    return out;
  }

  image(el) {
    const img = dataUrlToImage(el.getAttribute('src'));
    if (!img) return null;
    let w = Number(el.getAttribute('width')) || Number(el.dataset.w) || 300;
    let h = Number(el.getAttribute('height')) || Number(el.dataset.h) || 200;
    if (w > MAX_IMAGE_WIDTH) {
      h = Math.round(h * (MAX_IMAGE_WIDTH / w));
      w = MAX_IMAGE_WIDTH;
    }
    return new ImageRun({ data: img.data, type: img.type, transformation: { width: w, height: h } });
  }

  paragraph(runs, opts = {}) {
    return new Paragraph({ children: runs, ...opts });
  }

  // --- Bloques ---------------------------------------------------------------

  blocks(node, ctx = {}) {
    const out = [];
    let inline = [];

    const flush = () => {
      if (inline.length === 0) return;
      const runs = [];
      inline.forEach((n) => this.runs(n, ctx.fmt ?? {}, runs));
      const hasContent = inline.some((n) => (n.textContent || '').trim() || n.nodeName === 'IMG' || n.querySelector?.('img'));
      if (hasContent) out.push(this.paragraph(runs, ctx.paragraph));
      inline = [];
    };

    node.childNodes.forEach((child) => {
      if (isInline(child)) {
        inline.push(child);
        return;
      }
      flush();
      if (child.nodeType === Node.ELEMENT_NODE && !SKIP.has(child.tagName)) {
        out.push(...this.block(child, ctx));
      }
    });
    flush();
    return out;
  }

  block(el, ctx) {
    const tag = el.tagName;

    if (HEADINGS[tag]) {
      return [this.paragraph(this.runs(el), { heading: HEADINGS[tag] })];
    }

    if (tag === 'P') {
      return [this.paragraph(this.runs(el, ctx.fmt ?? {}), ctx.paragraph)];
    }

    if (tag === 'UL' || tag === 'OL') return this.list(el, ctx, 0);

    if (tag === 'PRE') {
      return [this.paragraph(this.runs(el, { pre: true }), {
        shading: { fill: 'F2F2F2' },
        spacing: { before: 120, after: 120 },
      })];
    }

    if (tag === 'BLOCKQUOTE') {
      return this.blocks(el, {
        ...ctx,
        fmt: { ...(ctx.fmt ?? {}), italics: true },
        paragraph: { ...(ctx.paragraph ?? {}), indent: { left: 720 } },
      });
    }

    if (tag === 'HR') return [new Paragraph({ thematicBreak: true, children: [] })];

    if (tag === 'TABLE') return [this.table(el)];

    if (tag === 'FIGCAPTION') {
      return [this.paragraph(this.runs(el, { italics: true }), { alignment: AlignmentType.CENTER })];
    }

    // div, section, article, main, header, footer, figure, li suelto, etc.
    return this.blocks(el, ctx);
  }

  list(el, ctx, level) {
    const ordered = el.tagName === 'OL';
    const instance = ordered ? ++this.listInstance : 0;
    const out = [];

    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;

      const nested = [];
      const own = [];
      li.childNodes.forEach((c) => {
        if (c.nodeType === Node.ELEMENT_NODE && (c.tagName === 'UL' || c.tagName === 'OL')) nested.push(c);
        else own.push(c);
      });

      const runs = [];
      own.forEach((c) => {
        // Un <p> dentro de <li> (Markdown "suelto") aporta su texto al ítem.
        if (c.nodeType === Node.ELEMENT_NODE && c.tagName === 'P') {
          if (runs.length) runs.push(new TextRun({ text: '', break: 1 }));
          this.runs(c, ctx.fmt ?? {}, runs);
        } else {
          this.runs(c, ctx.fmt ?? {}, runs);
        }
      });

      out.push(this.paragraph(runs, ordered
        ? { numbering: { reference: 'ordenada', level: Math.min(level, 8), instance } }
        : { bullet: { level: Math.min(level, 8) } }));

      nested.forEach((n) => out.push(...this.list(n, ctx, level + 1)));
    }
    return out;
  }

  table(el) {
    const rows = [...el.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr')];
    const tableRows = rows.map((tr) => {
      const cells = [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
      return new TableRow({
        // docx escribe <w:tblHeader/> si la propiedad existe, aunque valga
        // false: sólo se pasa cuando la fila de verdad es encabezado.
        ...(tr.parentElement?.tagName === 'THEAD' ? { tableHeader: true } : {}),
        children: cells.map((cell) => {
          const content = this.blocks(cell, cell.tagName === 'TH' ? { fmt: { bold: true } } : {});
          return new TableCell({
            columnSpan: Number(cell.getAttribute('colspan')) || 1,
            rowSpan: Number(cell.getAttribute('rowspan')) || 1,
            // Una celda de Word sin párrafo es un archivo corrupto.
            children: content.length ? content : [new Paragraph({ children: [] })],
          });
        }),
      });
    });

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: tableRows.length ? tableRows : [new TableRow({ children: [new TableCell({ children: [new Paragraph('')] })] })],
    });
  }
}

// En HTML los espacios y saltos del código fuente no se ven; en Word, un
// espacio al principio de un párrafo queda como sangría fantasma. Se colapsan
// y se recortan en los bordes de cada bloque, salvo dentro de <pre>.
function tidyWhitespace(root) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const t of texts) {
    if (!t.parentElement?.closest('pre')) t.textContent = t.textContent.replace(/\s+/g, ' ');
  }

  const edgeText = (el, last) => {
    const w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let found = null;
    while (w.nextNode()) {
      if (w.currentNode.parentElement?.closest('pre')) continue;
      if (!last) return w.currentNode;
      found = w.currentNode;
    }
    return found;
  };

  root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th,figcaption,blockquote').forEach((b) => {
    const first = edgeText(b, false);
    if (first) first.textContent = first.textContent.replace(/^\s+/, '');
    const last = edgeText(b, true);
    if (last) last.textContent = last.textContent.replace(/\s+$/, '');
  });
}

export async function htmlDocToDocx(doc, title = '') {
  tidyWhitespace(doc.body);
  const builder = new Builder();
  const children = builder.blocks(doc.body);

  const document = new Document({
    title,
    creator: 'FileReduzee',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
      },
    },
    numbering: {
      config: [{
        reference: 'ordenada',
        levels: Array.from({ length: 9 }, (_, i) => ({
          level: i,
          format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][i % 3],
          text: `%${i + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{ children: children.length ? children : [new Paragraph('')] }],
  });

  return Packer.toBlob(document);
}
