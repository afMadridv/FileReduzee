// Imágenes: el navegador decodifica, canvas recodifica.
// PNG, JPG, WebP y AVIF los escribe el propio navegador; BMP e ICO se arman a
// mano (son formatos simples); PDF con pdf-lib.

import { extensionOf } from '../utils/format.js';
import { MIME } from './registry.js';

// --- Decodificación ------------------------------------------------------------

function loadWithImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('el navegador no pudo decodificar la imagen'));
    };
    img.src = url;
  });
}

// Un SVG sin width/height no tiene tamaño propio; se deduce del viewBox. Se
// rasteriza al menos al doble y con el lado largo de al menos 1024 px: un
// ícono con viewBox de 24 saldría de 48 px, inservible. Tope de 4096 px.
async function decodeSvg(file) {
  const text = await file.text();
  const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  if (svg.nodeName !== 'svg') throw new Error('el archivo no es un SVG válido');

  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  let w = parseFloat(svg.getAttribute('width')) || vb[2] || 1024;
  let h = parseFloat(svg.getAttribute('height')) || vb[3] || w;

  const long = Math.max(w, h);
  const scale = Math.min(4096 / long, Math.max(2, 1024 / long));
  w = Math.round(w * scale);
  h = Math.round(h * scale);

  // Fijar el tamaño en el propio SVG para que el navegador lo dibuje a esa
  // resolución y no lo escale después como un mapa de bits.
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });

  const { img, url } = await loadWithImageElement(blob);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  return canvas;
}

export async function decodeToCanvas(file) {
  if (extensionOf(file.name) === 'svg') return decodeSvg(file);

  let source;
  let cleanup = () => {};
  try {
    source = await createImageBitmap(file);
    cleanup = () => source.close?.();
  } catch {
    // ICO y algunos BMP no pasan por createImageBitmap en todos los navegadores.
    const { img, url } = await loadWithImageElement(file);
    source = img;
    cleanup = () => URL.revokeObjectURL(url);
  }

  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth || source.width;
  canvas.height = source.naturalHeight || source.height;
  if (!canvas.width || !canvas.height) throw new Error('la imagen no tiene dimensiones');
  canvas.getContext('2d').drawImage(source, 0, 0);
  cleanup();
  return canvas;
}

function hasTransparency(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

// JPG y BMP no tienen canal alfa: sin aplanar sobre blanco, lo transparente
// sale negro.
function flattened(canvas) {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b && b.type === type ? resolve(b) : reject(new Error(`este navegador no sabe escribir ${type}`))), type, quality);
  });
}

// --- Codificadores manuales ----------------------------------------------------

// BMP de 24 bits, filas de abajo hacia arriba alineadas a 4 bytes: la variante
// que abre cualquier programa desde Windows 3.
function encodeBmp(canvas) {
  const { width: w, height: h } = canvas;
  const { data } = flattened(canvas).getContext('2d').getImageData(0, 0, w, h);
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + rowSize * h;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);

  dv.setUint16(0, 0x4d42, true); // "BM"
  dv.setUint32(2, size, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true); // BITMAPINFOHEADER
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, rowSize * h, true);
  dv.setUint32(38, 2835, true); // 72 ppp
  dv.setUint32(42, 2835, true);

  const out = new Uint8Array(buf);
  for (let y = 0; y < h; y++) {
    const row = 54 + (h - 1 - y) * rowSize;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = row + x * 3;
      out[d] = data[s + 2];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s];
    }
  }
  return new Blob([buf], { type: MIME.bmp });
}

// ICO con varias resoluciones dentro, cada una como PNG (válido desde Vista).
// Un favicon de verdad trae 16, 32 y 48; se agregan las grandes si la imagen
// alcanza. Una imagen no cuadrada se centra sobre fondo transparente.
async function encodeIco(canvas) {
  const long = Math.max(canvas.width, canvas.height);
  const sizes = [16, 32, 48, 64, 128, 256].filter((s) => s <= 48 || s <= long);

  const images = [];
  for (const s of sizes) {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const k = s / long;
    const w = canvas.width * k;
    const h = canvas.height * k;
    ctx.drawImage(canvas, (s - w) / 2, (s - h) / 2, w, h);
    images.push({ s, bytes: new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer()) });
  }

  const headerSize = 6 + 16 * images.length;
  const total = headerSize + images.reduce((n, i) => n + i.bytes.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true); // tipo: icono
  dv.setUint16(4, images.length, true);

  let offset = headerSize;
  images.forEach((img, i) => {
    const e = 6 + i * 16;
    out[e] = img.s === 256 ? 0 : img.s; // 0 significa 256
    out[e + 1] = img.s === 256 ? 0 : img.s;
    dv.setUint16(e + 4, 1, true); // planos
    dv.setUint16(e + 6, 32, true); // bits por píxel
    dv.setUint32(e + 8, img.bytes.length, true);
    dv.setUint32(e + 12, offset, true);
    out.set(img.bytes, offset);
    offset += img.bytes.length;
  });

  return { blob: new Blob([out], { type: MIME.ico }), sizes };
}

// Una imagen por página A4, orientada según la imagen y ajustada con margen.
// No se agranda una imagen chica: se vería pixelada.
async function encodePdf(canvas) {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();

  const alpha = hasTransparency(canvas);
  const encoded = await (alpha
    ? toBlob(canvas, 'image/png')
    : toBlob(flattened(canvas), 'image/jpeg', 0.92));
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const image = alpha ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

  const landscape = canvas.width > canvas.height;
  const [pw, ph] = landscape ? [842, 595] : [595, 842];
  const margin = 28;
  // 1 px de pantalla ≈ 0.75 pt; ese es el tamaño "natural" en papel.
  const k = Math.min((pw - margin * 2) / canvas.width, (ph - margin * 2) / canvas.height, 0.75);
  const w = canvas.width * k;
  const h = canvas.height * k;

  const page = pdf.addPage([pw, ph]);
  page.drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });

  return new Blob([await pdf.save()], { type: MIME.pdf });
}

// --- Entrada pública -----------------------------------------------------------

export async function convertImage(file, target, onProgress) {
  onProgress({ percent: null, stage: 'Decodificando la imagen…' });
  const canvas = await decodeToCanvas(file);
  const notes = [];
  const alpha = ['jpg', 'bmp'].includes(target) && hasTransparency(canvas);

  onProgress({ percent: null, stage: `Escribiendo ${target.toUpperCase()}…` });
  let blob;

  switch (target) {
    case 'png':
      blob = await toBlob(canvas, 'image/png');
      notes.push('PNG sin pérdida respecto de la imagen decodificada.');
      break;
    case 'jpg':
      blob = await toBlob(flattened(canvas), 'image/jpeg', 0.92);
      notes.push('JPG al 92% de calidad.');
      break;
    case 'webp':
      blob = await toBlob(canvas, 'image/webp', 0.92);
      notes.push('WebP al 92% de calidad, conserva transparencia.');
      break;
    case 'avif':
      blob = await toBlob(canvas, 'image/avif', 0.8);
      notes.push('AVIF al 80% de calidad, conserva transparencia.');
      break;
    case 'bmp':
      blob = encodeBmp(canvas);
      notes.push('BMP de 24 bits sin compresión: pesa mucho a propósito, es el formato.');
      break;
    case 'ico': {
      const ico = await encodeIco(canvas);
      blob = ico.blob;
      notes.push(`Icono con ${ico.sizes.map((s) => `${s}×${s}`).join(', ')} px.`);
      break;
    }
    case 'pdf':
      blob = await encodePdf(canvas);
      notes.push('Una página A4 con la imagen ajustada, sin agrandarla.');
      break;
    default:
      throw new Error(`no hay conversión de imagen a ${target.toUpperCase()}`);
  }

  if (alpha) notes.push(`${target.toUpperCase()} no admite transparencia: se rellenó con blanco.`);
  if (extensionOf(file.name) === 'gif') notes.push('Se tomó el primer cuadro del GIF; para conservar la animación convertilo a MP4 o WEBM.');
  if (extensionOf(file.name) === 'svg') notes.push(`SVG rasterizado a ${canvas.width}×${canvas.height} px.`);

  canvas.width = canvas.height = 0;
  return { blob, notes };
}
