// PNG / JPG / WEBP vía browser-image-compression (canvas + web worker propio).
// Desde la fase 1 llega por npm, no por CDN: la URL del CDN se había corrompido
// y la librería no cargaba, así que esta ruta estaba rota en producción.
//
// Honestidad: calidad alta (92%) da pérdida perceptual mínima, pero no es
// lossless byte-a-byte. Para eso (oxipng, recompresión real sin tocar un
// solo píxel) está la fase 3 — ver FASES.txt.

import imageCompression from 'browser-image-compression';
import { withSuffix } from '../utils/format.js';

export async function compressImage(file) {
  const options = {
    maxSizeMB: 10,
    useWebWorker: true,
    initialQuality: 0.92,
  };

  const compressedFile = await imageCompression(file, options);

  return {
    blob: compressedFile,
    filename: withSuffix(file.name, '-comprimido'),
    note: 'Recodificado a calidad alta (92%). Pérdida perceptual mínima, no exacta a nivel de bytes.',
  };
}
