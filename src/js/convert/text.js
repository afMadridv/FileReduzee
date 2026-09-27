// Utilidades de texto compartidas por los conversores.

// Lee un archivo de texto respetando su codificación. Un .txt o .csv hecho en
// Windows suele venir en windows-1252: leído como UTF-8, cada tilde sale como
// "�". Se intenta UTF-8 estricto y, si falla, se cae a windows-1252.
export async function readText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function textBlob(text, mime, { bom = false } = {}) {
  return new Blob([bom ? '﻿' : '', text], { type: mime });
}
