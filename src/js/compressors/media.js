// FASE 2 — audio y vídeo con ffmpeg.wasm.
//
// Core de UN SOLO HILO (@ffmpeg/core, no -mt) a propósito: el multihilo exige
// los headers COOP/COEP en todo el sitio, lo que rompe embeds y scripts de
// terceros. No vale ese riesgo acá.
//
// El motor pesa ~31 MB de .wasm, así que se carga sólo cuando llega el primer
// archivo de audio o vídeo, nunca al abrir la página. La instancia se reutiliza
// entre archivos: cargarla de nuevo por cada uno sería volver a bajar todo.
//
// Límite real y duro: ffmpeg.wasm es wasm32, tope de 4 GB de espacio de
// direcciones, y el archivo entero tiene que entrar en su sistema de archivos
// en memoria antes de tocarlo — entrada, frames decodificados y salida, todo
// en RAM a la vez. Por eso hay un tope explícito en vez de dejar que la
// pestaña se muera sin explicación.

import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { extensionOf, formatBytes, withExtension } from '../utils/format.js';

const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'];

// Arriba de esto la pestaña se queda sin memoria antes de terminar.
const HARD_LIMIT = 1024 * 1024 * 1024; // 1 GB
// Arriba de esto funciona, pero lento y con riesgo según la máquina.
const WARN_LIMIT = 300 * 1024 * 1024; // 300 MB

export const PRESETS = {
  equilibrado: { crf: 23, audioBitrate: '192k', maxHeight: null },
  agresivo: { crf: 28, audioBitrate: '128k', maxHeight: 720 },
};

let enginePromise = null;

async function getEngine(report) {
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    report({ percent: null, stage: 'Descargando el motor de vídeo (~31 MB, una sola vez)…' });
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({ coreURL, wasmURL });
    return ffmpeg;
  })();

  try {
    return await enginePromise;
  } catch (err) {
    // Si la carga falla, no dejar cacheada una promesa rota: el próximo
    // archivo debe poder reintentar.
    enginePromise = null;
    throw err;
  }
}

// No hay ffprobe en @ffmpeg/core, pero "ffmpeg -i entrada" sin salida imprime
// las pistas y termina con código != 0. Se leen sus logs y se descarta ese
// error, que es el comportamiento esperado.
async function tienePistaDeVideo(ffmpeg, input) {
  let encontrada = false;

  const onLog = ({ message }) => {
    // "(attached pic)" es la carátula de un mp3, no una pista de vídeo real.
    if (/Stream #\d+:\d+.*: Video:/.test(message) && !message.includes('attached pic')) {
      encontrada = true;
    }
  };

  ffmpeg.on('log', onLog);
  try {
    await ffmpeg.exec(['-hide_banner', '-i', input]);
  } catch {
    // Esperado: sin archivo de salida, ffmpeg sale con error tras listar pistas.
  } finally {
    ffmpeg.off('log', onLog);
  }

  return encontrada;
}

function buildArgs({ input, output, isVideo, preset }) {
  if (!isVideo) {
    return ['-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', preset.audioBitrate, output];
  }

  const args = ['-i', input, '-c:v', 'libx264', '-crf', String(preset.crf), '-preset', 'veryfast'];

  if (preset.maxHeight) {
    // -2 mantiene la proporción y fuerza un alto par, que libx264 exige.
    args.push('-vf', `scale=-2:'min(${preset.maxHeight},ih)'`);
  }

  args.push('-c:a', 'aac', '-b:a', preset.audioBitrate, '-movflags', '+faststart', output);
  return args;
}

export async function compressMedia(file, onProgress = () => {}, presetName = 'agresivo') {
  if (file.size > HARD_LIMIT) {
    return {
      skipped: `${formatBytes(file.size)} es demasiado para comprimir dentro del navegador. ffmpeg.wasm necesita el archivo entero en memoria y el límite real ronda 1 GB; más que eso cierra la pestaña. Para un archivo así hace falta una herramienta de escritorio (HandBrake, ffmpeg).`,
    };
  }

  const preset = PRESETS[presetName] ?? PRESETS.agresivo;
  const ext = extensionOf(file.name);
  const isVideo = VIDEO_EXTS.includes(ext);

  const input = `entrada.${ext || 'bin'}`;
  const output = isVideo ? 'salida.mp4' : 'salida.mp3';

  const ffmpeg = await getEngine(onProgress);
  const { fetchFile } = await import('@ffmpeg/util');

  let saliendoEnVideo = isVideo;
  let salida = output;

  const onFfmpegProgress = ({ progress }) => {
    // ffmpeg.wasm a veces reporta fuera de rango al terminar.
    const percent = Math.min(100, Math.max(0, progress * 100));
    onProgress({ percent, stage: saliendoEnVideo ? 'Recodificando vídeo…' : 'Recodificando audio…' });
  };

  try {
    onProgress({ percent: null, stage: `Cargando ${formatBytes(file.size)} en memoria…` });
    await ffmpeg.writeFile(input, await fetchFile(file));

    // Un .webm o .mkv puede traer sólo audio (una nota de voz). Sin comprobarlo
    // ffmpeg igual produce un .mp4 —mete el audio y no se queja—, y la nota
    // terminaría diciendo "H.264" sobre algo que no tiene un solo fotograma.
    if (isVideo) {
      onProgress({ percent: null, stage: 'Analizando pistas…' });
      saliendoEnVideo = await tienePistaDeVideo(ffmpeg, input);
      if (!saliendoEnVideo) salida = 'salida.mp3';
    }

    ffmpeg.on('progress', onFfmpegProgress);
    await ffmpeg.exec(buildArgs({ input, output: salida, isVideo: saliendoEnVideo, preset }));

    const data = await ffmpeg.readFile(salida);
    const blob = new Blob([data.buffer ?? data], { type: saliendoEnVideo ? 'video/mp4' : 'audio/mpeg' });

    const partes = [
      saliendoEnVideo
        ? `Recodificado a H.264 (CRF ${preset.crf}) con audio AAC a ${preset.audioBitrate}.`
        : `Recodificado a MP3 a ${preset.audioBitrate}.`,
      preset.maxHeight && saliendoEnVideo ? `Resolución limitada a ${preset.maxHeight}p.` : '',
      'Con pérdida: recodificar siempre decide calidad contra tamaño.',
      file.size > WARN_LIMIT
        ? `Aviso: ${formatBytes(file.size)} está cerca del límite de lo que aguanta un navegador.`
        : '',
    ];

    return {
      blob,
      filename: withExtension(file.name, saliendoEnVideo ? 'mp4' : 'mp3', '-comprimido'),
      note: partes.filter(Boolean).join(' '),
    };
  } finally {
    ffmpeg.off('progress', onFfmpegProgress);
    // Liberar el sistema de archivos en memoria: si no, cada archivo se suma
    // al anterior y el segundo o el tercero se queda sin RAM.
    await ffmpeg.deleteFile(input).catch(() => {});
    await ffmpeg.deleteFile(output).catch(() => {});
    await ffmpeg.deleteFile('salida.mp3').catch(() => {});
  }
}
