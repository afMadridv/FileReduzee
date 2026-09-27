// Hojas de cálculo y datos tabulares con SheetJS (versión oficial 0.20.3 de
// cdn.sheetjs.com, no la 0.18.5 de npm: esa tiene fallos de seguridad
// conocidos al leer archivos ajenos, que es justo lo que se hace acá).

import { escapeHtml, readText, textBlob } from './text.js';
import { MIME } from './registry.js';

async function loadXlsx() {
  return import('xlsx');
}

async function readWorkbook(XLSX, file, ext) {
  if (ext === 'json') {
    let data;
    try {
      data = JSON.parse(await readText(file));
    } catch {
      throw new Error('el archivo no es JSON válido');
    }
    return jsonToWorkbook(XLSX, data);
  }

  if (ext === 'csv' || ext === 'tsv') {
    // Leído como texto ya decodificado: si no, SheetJS interpreta los bytes y
    // un CSV de Excel en windows-1252 pierde las tildes.
    return XLSX.read(await readText(file), { type: 'string', cellDates: true, FS: ext === 'tsv' ? '\t' : undefined });
  }

  return XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
}

// Acepta lo que razonablemente es una tabla: lista de objetos, lista de
// listas, o un objeto cuyas claves son hojas con alguna de esas dos formas.
function jsonToWorkbook(XLSX, data) {
  const wb = XLSX.utils.book_new();
  const toSheet = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    if (rows.every((r) => Array.isArray(r))) return XLSX.utils.aoa_to_sheet(rows);
    if (rows.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
      // Objetos anidados no caben en una celda: se guardan como JSON.
      const flat = rows.map((r) => Object.fromEntries(Object.entries(r)
        .map(([k, v]) => [k, v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v])));
      return XLSX.utils.json_to_sheet(flat);
    }
    return null;
  };

  const single = toSheet(data);
  if (single) {
    XLSX.utils.book_append_sheet(wb, single, 'Datos');
    return wb;
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [name, rows] of Object.entries(data)) {
      const sheet = toSheet(rows);
      if (sheet) XLSX.utils.book_append_sheet(wb, sheet, name.slice(0, 31) || 'Hoja');
    }
    if (wb.SheetNames.length) return wb;
  }

  throw new Error('el JSON no tiene forma de tabla: se espera una lista de objetos, una lista de filas, o un objeto con una de esas por hoja');
}

// Fechas en ISO (2026-01-15), con hora sólo si la tiene. Sin esto SheetJS
// escribe "1/15/26" —formato de EE.UU., ambiguo en español— y en JSON la
// medianoche local pasada a UTC puede correr el día.
//
// Ojo: SheetJS guarda la fecha de una celda como medianoche UTC, pero
// sheet_to_json la devuelve pasada a hora local. Leer una con los getters de
// la otra corre el día en cualquier huso al oeste de Greenwich.
function isoDate(d, utc = false) {
  const p = (n) => String(n).padStart(2, '0');
  const [y, mo, da, h, mi, s] = utc
    ? [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    : [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
  const date = `${y}-${p(mo + 1)}-${p(da)}`;
  return h || mi || s ? `${date} ${p(h)}:${p(mi)}:${p(s)}` : date;
}

// Reescribe el texto visible de las celdas de fecha: CSV, HTML y Markdown
// salen de ese texto.
function isoDateCells(wb) {
  wb.SheetNames.forEach((name) => {
    const sheet = wb.Sheets[name];
    Object.keys(sheet).forEach((ref) => {
      const cell = sheet[ref];
      if (ref[0] !== '!' && cell && cell.t === 'd' && cell.v instanceof Date) {
        cell.w = isoDate(cell.v, true);
      }
    });
  });
}

function jsonRows(XLSX, sheet) {
  return XLSX.utils.sheet_to_json(sheet, { defval: null })
    .map((row) => Object.fromEntries(Object.entries(row)
      .map(([k, v]) => [k, v instanceof Date ? isoDate(v) : v])));
}

function rows(XLSX, sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
}

function markdownTable(matrix) {
  if (matrix.length === 0) return '*(hoja vacía)*\n';
  const width = Math.max(...matrix.map((r) => r.length));
  const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const pad = (r) => Array.from({ length: width }, (_, i) => cell(r[i]));
  const [head, ...body] = matrix;
  return [
    `| ${pad(head).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...body.map((r) => `| ${pad(r).join(' | ')} |`),
  ].join('\n') + '\n';
}

function htmlPage(XLSX, wb, title) {
  const sections = wb.SheetNames.map((name) => {
    const table = XLSX.utils.sheet_to_html(wb.Sheets[name], { header: '', footer: '' });
    return `<h2>${escapeHtml(name)}</h2>\n${table}`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 2rem; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1d1f27; }
  h2 { margin: 2rem 0 .75rem; font-size: 1.1rem; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #d0d3de; padding: .35em .6em; white-space: nowrap; }
  tr:first-child td { background: #f3f4f8; font-weight: 600; }
</style>
</head>
<body>
${sections}
</body>
</html>
`;
}

export async function convertSheet(file, ext, target, onProgress) {
  onProgress({ percent: null, stage: 'Leyendo la hoja…' });
  const XLSX = await loadXlsx();
  const wb = await readWorkbook(XLSX, file, ext);
  const sheets = wb.SheetNames;
  if (sheets.length === 0) throw new Error('el archivo no tiene hojas');

  const title = file.name.replace(/\.[^.]+$/, '');
  const multi = sheets.length > 1;

  // Un CSV no tiene nombre de hoja y SheetJS le pone "Sheet1". Mejor el
  // nombre del archivo (Excel limita a 31 caracteres y prohíbe algunos).
  if ((ext === 'csv' || ext === 'tsv') && sheets.length === 1) {
    const nice = title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Hoja1';
    wb.Sheets[nice] = wb.Sheets[sheets[0]];
    if (nice !== sheets[0]) delete wb.Sheets[sheets[0]];
    sheets[0] = nice;
  }

  if (target !== 'xlsx' && target !== 'ods') {
    isoDateCells(wb);
  } else if (ext === 'csv' || ext === 'tsv' || ext === 'json') {
    // Un CSV no trae formato de celda y SheetJS aplica "m/d/yy": esconde la
    // hora y muestra la fecha al estilo de EE.UU. Un XLSX conserva el suyo.
    wb.SheetNames.forEach((name) => {
      const sheet = wb.Sheets[name];
      Object.keys(sheet).forEach((ref) => {
        const cell = sheet[ref];
        if (ref[0] !== '!' && cell?.t === 'd' && cell.v instanceof Date) {
          const d = cell.v;
          cell.z = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds() ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd';
          delete cell.w;
        }
      });
    });
  }
  onProgress({ percent: null, stage: `Escribiendo ${target.toUpperCase()}…` });

  switch (target) {
    case 'xlsx':
    case 'ods': {
      const out = XLSX.write(wb, { bookType: target, type: 'array', compression: true });
      return {
        blob: new Blob([out], { type: MIME[target] }),
        notes: [`${sheets.length} hoja${multi ? 's' : ''}. Se conservan valores y fórmulas; formatos visuales complejos (gráficos, macros, formato condicional) no.`],
      };
    }

    case 'csv': {
      // BOM para que Excel abra el UTF-8 con las tildes bien.
      if (!multi) {
        return {
          blob: textBlob(XLSX.utils.sheet_to_csv(wb.Sheets[sheets[0]]), MIME.csv, { bom: true }),
          notes: ['CSV en UTF-8, separado por comas.'],
        };
      }
      // CSV no tiene hojas: una por archivo, dentro de un ZIP.
      const { zipSync, strToU8 } = await import('fflate');
      const files = {};
      sheets.forEach((name, i) => {
        const safe = name.replace(/[\\/:*?"<>|]/g, '_');
        files[`${String(i + 1).padStart(2, '0')}-${safe}.csv`] = strToU8(`﻿${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`);
      });
      return {
        blob: new Blob([zipSync(files)], { type: MIME.zip }),
        ext: 'zip',
        suffix: '-csv',
        notes: [`CSV no admite varias hojas: ${sheets.length} archivos CSV dentro de un ZIP.`],
      };
    }

    case 'json': {
      const data = multi
        ? Object.fromEntries(sheets.map((n) => [n, jsonRows(XLSX, wb.Sheets[n])]))
        : jsonRows(XLSX, wb.Sheets[sheets[0]]);
      return {
        blob: textBlob(`${JSON.stringify(data, null, 2)}\n`, MIME.json),
        notes: [multi
          ? 'Un objeto con una lista por hoja; la primera fila de cada hoja da los nombres de campo.'
          : 'Lista de objetos; la primera fila da los nombres de campo.'],
      };
    }

    case 'html':
      return {
        blob: textBlob(htmlPage(XLSX, wb, title), MIME.html),
        notes: ['Página con una tabla por hoja.'],
      };

    case 'md': {
      const md = sheets.map((name) => `${multi ? `## ${name}\n\n` : ''}${markdownTable(rows(XLSX, wb.Sheets[name]))}`).join('\n');
      return {
        blob: textBlob(md, MIME.md),
        notes: ['Tablas Markdown estilo GitHub; la primera fila hace de encabezado.'],
      };
    }

    default:
      throw new Error(`no hay conversión de hoja a ${target.toUpperCase()}`);
  }
}
