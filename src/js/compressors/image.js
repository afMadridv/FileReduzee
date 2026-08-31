// PNG / JPG / WEBP. Desde la fase 1 la librería llega por npm, no por CDN:
// la URL del CDN se había corrompido y esta ruta estaba rota en producción.
//
// Estrategia: probar varias recodificaciones y quedarse con la más chica.
// WebP casi siempre gana por bastante frente a PNG y JPG a calidad
// equivalente, y conserva transparencia, así que sirve para los tres.
//
// Honestidad: esto es CON pérdida. Los píxeles no quedan idénticos. A 80% de
// calidad y sin tocar la resolución la diferencia no se ve a simple vista,
// pero no es lossless byte-a-byte. Para PNG realmente sin pérdida está la
// fase 3 (oxipng) — ver FASES.txt.

import imageCompression from 'browser-image-compression';
import { withExtension } from '../utils/format.js';

const QUALITY = 0.8;

// Recodifica por canvas al tipo pedido. Devuelve null si el navegador no
// sabe escribir ese formato (toBlob cae a PNG en silencio, de ahí el check
// del type).
async function reencode(file, type, quality) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  // Liberar el respaldo del canvas: una imagen grande son decenas de MB.
  canvas.width = 0;
  canvas.height = 0;

  return blob && blob.type === type ? blob : null;
}

export async function compressImage(file) {
  const candidates = [];

  const webp = await reencode(file, 'image/webp', QUALITY);
  if (webp) {
    candidates.push({
      blob: webp,
      ext: 'webp',
      note: `Recodificado a WebP al ${Math.round(QUALITY * 100)}% de calidad, misma resolución. Con pérdida: los píxeles no son idénticos al original, aunque a simple vista no se distingue.`,
    });
  }

  // Segundo candidato en el formato original, por si WebP no está disponible
  // o el original ya era más eficiente.
  try {
    const same = await imageCompression(file, {
      maxSizeMB: 10,
      useWebWorker: true,
      initialQuality: QUALITY,
    });
    candidates.push({
      blob: same,
      ext: null,
      note: `Recodificado en su formato original al ${Math.round(QUALITY * 100)}% de calidad. Con pérdida: los píxeles no son idénticos al original.`,
    });
  } catch {
    // Si esta vía falla, alcanza con el candidato WebP.
  }

  if (candidates.length === 0) {
    throw new Error('el navegador no pudo decodificar la imagen');
  }

  const best = candidates.reduce((a, b) => (b.blob.size < a.blob.size ? b : a));

  return {
    blob: best.blob,
    filename: best.ext ? withExtension(file.name, best.ext, '-comprimido') : withExtension(file.name, null, '-comprimido'),
    note: best.ext === 'webp'
      ? `${best.note} El formato cambió a .webp, que abren todos los navegadores actuales.`
      : best.note,
  };
}
