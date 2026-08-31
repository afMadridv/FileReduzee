// Compresión SIN pérdida para cualquier archivo, vía gzip (pako).
// Los bytes se recuperan exactos al descomprimir con cualquier herramienta gzip.
//
// Honestidad: si el archivo ya viene comprimido (zip, docx, mp3, mp4, jpg...),
// el ahorro real suele ser mínimo o nulo — la entropía ya está cerca del
// límite. Esta es la ruta de respaldo cuando no hay una estrategia más
// específica para el tipo de archivo.

import pako from 'pako';

export async function compressGeneric(file) {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const compressed = pako.gzip(buffer, { level: 9 });
  const blob = new Blob([compressed], { type: 'application/gzip' });

  return {
    blob,
    filename: `${file.name}.gz`,
    note: 'Sin pérdida (gzip). Si el archivo ya estaba comprimido, el ahorro puede ser mínimo o nulo.',
  };
}
