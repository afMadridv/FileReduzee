// Qué se puede convertir a qué. Única fuente de verdad: la usan la interfaz
// (opciones de cada fila, tabla de formatos) y el enrutador de conversiones.
//
// Regla: sólo entra una conversión que funciona de verdad en el navegador y
// da un archivo útil. Las que conservan menos de lo que su nombre promete
// (PDF → DOCX sólo trae texto) lo dicen en la etiqueta, no en letra chica.

import { extensionOf } from '../utils/format.js';

const DOC_TARGETS = ['pdf', 'docx', 'md', 'html', 'txt'];
const IMAGE_TARGETS = ['png', 'jpg', 'webp', 'avif', 'bmp', 'ico', 'pdf'];
const SHEET_TARGETS = ['xlsx', 'csv', 'json', 'ods', 'html', 'md'];
const VIDEO_TARGETS = ['mp4', 'webm', 'mov', 'mkv', 'gif', 'mp3', 'wav', 'm4a'];
const AUDIO_TARGETS = ['mp3', 'wav', 'ogg', 'opus', 'm4a', 'flac'];

// Extensión de origen -> familia y destinos. El orden de los destinos es el
// del menú; el primero es el preseleccionado cuando no hay default explícito.
const SOURCES = {
  // Documentos: pasan por HTML como formato intermedio.
  docx: { family: 'document', targets: DOC_TARGETS, default: 'pdf' },
  md: { family: 'document', targets: DOC_TARGETS, default: 'pdf' },
  markdown: { family: 'document', targets: DOC_TARGETS, default: 'pdf' },
  html: { family: 'document', targets: DOC_TARGETS, default: 'pdf' },
  htm: { family: 'document', targets: DOC_TARGETS, default: 'pdf' },
  txt: { family: 'document', targets: ['pdf', 'docx', 'html'], default: 'pdf' },
  pdf: { family: 'pdf', targets: ['docx', 'txt', 'md', 'html', 'png', 'jpg'], default: 'docx' },
  pptx: { family: 'document', targets: ['docx', 'txt', 'md', 'html'], default: 'docx' },

  // Imágenes: decodificadas por el navegador, recodificadas por canvas.
  png: { family: 'image', targets: IMAGE_TARGETS, default: 'jpg' },
  jpg: { family: 'image', targets: IMAGE_TARGETS, default: 'png' },
  jpeg: { family: 'image', targets: IMAGE_TARGETS, default: 'png' },
  webp: { family: 'image', targets: IMAGE_TARGETS, default: 'png' },
  avif: { family: 'image', targets: IMAGE_TARGETS, default: 'jpg' },
  bmp: { family: 'image', targets: IMAGE_TARGETS, default: 'png' },
  ico: { family: 'image', targets: IMAGE_TARGETS, default: 'png' },
  svg: { family: 'image', targets: IMAGE_TARGETS, default: 'png' },
  // Un GIF animado va mucho mejor como vídeo; como imagen queda el 1er cuadro.
  gif: { family: 'image', targets: ['mp4', 'webm', ...IMAGE_TARGETS], default: 'mp4' },

  // Hojas de cálculo y datos tabulares.
  xlsx: { family: 'sheet', targets: SHEET_TARGETS, default: 'csv' },
  xls: { family: 'sheet', targets: SHEET_TARGETS, default: 'xlsx' },
  ods: { family: 'sheet', targets: SHEET_TARGETS, default: 'xlsx' },
  csv: { family: 'sheet', targets: SHEET_TARGETS, default: 'xlsx' },
  tsv: { family: 'sheet', targets: SHEET_TARGETS, default: 'xlsx' },
  json: { family: 'sheet', targets: ['xlsx', 'csv', 'ods', 'html', 'md'], default: 'csv' },

  // Vídeo y audio: ffmpeg.wasm.
  mp4: { family: 'video', targets: VIDEO_TARGETS, default: 'mp3' },
  mov: { family: 'video', targets: VIDEO_TARGETS, default: 'mp4' },
  webm: { family: 'video', targets: VIDEO_TARGETS, default: 'mp4' },
  mkv: { family: 'video', targets: VIDEO_TARGETS, default: 'mp4' },
  avi: { family: 'video', targets: VIDEO_TARGETS, default: 'mp4' },
  m4v: { family: 'video', targets: VIDEO_TARGETS, default: 'mp4' },
  mp3: { family: 'audio', targets: AUDIO_TARGETS, default: 'wav' },
  wav: { family: 'audio', targets: AUDIO_TARGETS, default: 'mp3' },
  m4a: { family: 'audio', targets: AUDIO_TARGETS, default: 'mp3' },
  aac: { family: 'audio', targets: AUDIO_TARGETS, default: 'mp3' },
  ogg: { family: 'audio', targets: AUDIO_TARGETS, default: 'mp3' },
  oga: { family: 'audio', targets: AUDIO_TARGETS, default: 'mp3' },
  opus: { family: 'audio', targets: AUDIO_TARGETS, default: 'mp3' },
  flac: { family: 'audio', targets: AUDIO_TARGETS, default: 'mp3' },
  weba: { family: 'audio', targets: AUDIO_TARGETS, default: 'mp3' },
};

// Etiquetas que dicen lo que realmente sale. Clave "origen>destino" para los
// casos especiales; si no hay, vale la del destino.
const SPECIAL_LABELS = {
  'pdf>docx': 'DOCX · sólo texto',
  'pdf>md': 'MD · sólo texto',
  'pdf>html': 'HTML · sólo texto',
  'pdf>txt': 'TXT',
  'pdf>png': 'PNG · una por página',
  'pdf>jpg': 'JPG · una por página',
  'pptx>docx': 'DOCX · texto de diapositivas',
  'pptx>txt': 'TXT · texto de diapositivas',
  'pptx>md': 'MD · texto de diapositivas',
  'pptx>html': 'HTML · texto de diapositivas',
  'gif>mp4': 'MP4 · animación',
  'gif>webm': 'WEBM · animación',
  'gif>png': 'PNG · primer cuadro',
  'gif>jpg': 'JPG · primer cuadro',
  'gif>webp': 'WEBP · primer cuadro',
  'gif>avif': 'AVIF · primer cuadro',
  'gif>bmp': 'BMP · primer cuadro',
  'gif>ico': 'ICO · primer cuadro',
  'gif>pdf': 'PDF · primer cuadro',
};

const TARGET_LABELS = {
  mp3: 'MP3 · audio',
  wav: 'WAV · audio',
  m4a: 'M4A · audio',
  gif: 'GIF · animado',
  ico: 'ICO · favicon',
};

export const FAMILY_NAMES = {
  document: 'Documentos',
  pdf: 'PDF',
  image: 'Imágenes',
  sheet: 'Hojas de cálculo y datos',
  video: 'Vídeo',
  audio: 'Audio',
};

function normalizeExt(ext) {
  return ext === 'jpeg' ? 'jpg' : ext === 'markdown' ? 'md' : ext === 'htm' ? 'html' : ext;
}

// El navegador decide si sabe escribir WebP o AVIF; se pregunta una vez.
const encodeSupport = {};
export function canEncodeImage(type) {
  if (!(type in encodeSupport)) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      encodeSupport[type] = c.toDataURL(type).startsWith(`data:${type}`);
    } catch {
      encodeSupport[type] = false;
    }
  }
  return encodeSupport[type];
}

function targetAvailable(target) {
  if (target === 'webp') return canEncodeImage('image/webp');
  if (target === 'avif') return canEncodeImage('image/avif');
  return true;
}

export function labelFor(sourceExt, target) {
  return SPECIAL_LABELS[`${normalizeExt(sourceExt)}>${target}`]
    ?? TARGET_LABELS[target]
    ?? target.toUpperCase();
}

// Devuelve { ext, family, targets: [{ value, label }], default } o null si el
// formato no se puede convertir.
export function describe(file) {
  const ext = extensionOf(file.name);
  const source = SOURCES[ext];
  if (!source) return null;

  const self = normalizeExt(ext);
  const targets = source.targets
    .filter((t) => t !== self && targetAvailable(t))
    .map((t) => ({ value: t, label: labelFor(ext, t) }));

  const def = targets.some((t) => t.value === source.default) ? source.default : targets[0]?.value;
  return { ext, family: source.family, targets, default: def };
}

// Para la tabla de formatos admitidos: agrupa por familia.
export function formatTable() {
  const groups = new Map();
  for (const [ext, src] of Object.entries(SOURCES)) {
    if (['jpeg', 'markdown', 'htm', 'oga', 'weba'].includes(ext)) continue;
    const key = src.family;
    if (!groups.has(key)) groups.set(key, { sources: [], targets: new Set() });
    const g = groups.get(key);
    g.sources.push(ext);
    src.targets.filter(targetAvailable).forEach((t) => g.targets.add(t));
  }
  return [...groups.entries()].map(([family, g]) => ({
    family: FAMILY_NAMES[family],
    sources: g.sources,
    targets: [...g.targets],
  }));
}

export const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv;charset=utf-8',
  json: 'application/json',
  zip: 'application/zip',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
};
