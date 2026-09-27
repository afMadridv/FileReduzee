// Motor ffmpeg.wasm compartido por las pestañas Comprimir y Convertir.
//
// Core de UN SOLO HILO (@ffmpeg/core, no -mt) a propósito: el multihilo exige
// los headers COOP/COEP en todo el sitio, lo que rompe embeds y scripts de
// terceros.
//
// El core pesa ~31 MB de .wasm: se carga sólo cuando llega el primer archivo
// de audio o vídeo y la instancia se reutiliza. Hay UNA sola para las dos
// pestañas, y los trabajos pasan de a uno (exclusive): dos a la vez mezclarían
// los eventos de progreso y competirían por la misma RAM.
//
// Límite duro: wasm32, 4 GB de espacio de direcciones, y el archivo entero
// tiene que entrar en el sistema de archivos en memoria de ffmpeg junto con
// los frames decodificados y la salida.

import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { extensionOf, formatBytes } from '../utils/format.js';

export const HARD_LIMIT = 1024 * 1024 * 1024; // 1 GB: arriba, la pestaña muere
export const WARN_LIMIT = 300 * 1024 * 1024; // 300 MB: anda, pero lento

export function tooLargeReason(file, verbo = 'procesar') {
  return `${formatBytes(file.size)} es demasiado para ${verbo} dentro del navegador. ffmpeg.wasm necesita el archivo entero en memoria y el límite real ronda 1 GB; más que eso cierra la pestaña. Para un archivo así hace falta una herramienta de escritorio (HandBrake, ffmpeg).`;
}

let enginePromise = null;

async function getEngine(report) {
  if (!enginePromise) {
    enginePromise = (async () => {
      report({ percent: null, stage: 'Descargando el motor de audio y vídeo (~31 MB, una sola vez)…' });
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })();
  }

  try {
    return await enginePromise;
  } catch (err) {
    // No dejar cacheada una carga rota: el próximo archivo debe poder reintentar.
    enginePromise = null;
    throw err;
  }
}

// Cuando ffmpeg.wasm aborta (no "ffmpeg salió con error", sino el core
// wasm cayéndose) la instancia queda muerta: todo exec posterior falla en
// silencio y probe() pasa a decir "sin pistas" de archivos que sí las tienen.
// Un archivo raro envenenaría la sesión entera. Se descarta y el próximo
// trabajo carga una limpia.
function discardEngine(ffmpeg) {
  try { ffmpeg.terminate(); } catch { /* ya estaba muerta */ }
  enginePromise = null;
}

class EngineCrash extends Error {}

async function safeExec(ffmpeg, args) {
  try {
    return await ffmpeg.exec(args);
  } catch {
    discardEngine(ffmpeg);
    throw new EngineCrash('ffmpeg se detuvo con este archivo; puede estar dañado o usar algo que el motor del navegador no soporta');
  }
}

let turno = Promise.resolve();

// Encola fn detrás del trabajo anterior, termine éste bien o mal.
function exclusive(fn) {
  const run = turno.then(fn, fn);
  turno = run.catch(() => {});
  return run;
}

let nextJob = 0;

// Carga el archivo en el sistema de archivos de ffmpeg, corre body y limpia
// todo lo creado. body recibe { ffmpeg, input, name(ext) } donde name() da un
// nombre de salida único y lo registra para borrarlo al final.
export function withMediaFile(file, onProgress, body) {
  return exclusive(async () => {
    const ffmpeg = await getEngine(onProgress);
    const { fetchFile } = await import('@ffmpeg/util');

    const job = nextJob++;
    const input = `in${job}.${extensionOf(file.name) || 'bin'}`;
    const created = [input];
    const name = (ext) => {
      const n = `out${job}_${created.length}.${ext}`;
      created.push(n);
      return n;
    };

    try {
      onProgress({ percent: null, stage: `Cargando ${formatBytes(file.size)} en memoria…` });
      await ffmpeg.writeFile(input, await fetchFile(file));
      return await body({ ffmpeg, input, name });
    } finally {
      // Sin esto cada archivo se suma al anterior y el tercero se queda sin RAM.
      for (const f of created) await ffmpeg.deleteFile(f).catch(() => {});
    }
  });
}

// Corre ffmpeg reportando progreso real. Devuelve el código de salida:
// ffmpeg.wasm no lanza excepción cuando ffmpeg falla, sólo devuelve != 0.
export async function run(ffmpeg, args, onProgress, stage) {
  const onFfmpegProgress = ({ progress }) => {
    // A veces reporta fuera de rango al terminar.
    onProgress({ percent: Math.min(100, Math.max(0, progress * 100)), stage });
  };
  ffmpeg.on('progress', onFfmpegProgress);
  try {
    return await safeExec(ffmpeg, args);
  } finally {
    ffmpeg.off('progress', onFfmpegProgress);
  }
}

export async function readBlob(ffmpeg, path, type) {
  const data = await ffmpeg.readFile(path);
  return new Blob([data.buffer ?? data], { type });
}

// No hay ffprobe en @ffmpeg/core, pero "ffmpeg -i entrada" sin salida imprime
// las pistas en el log antes de terminar con código != 0.
export async function probe(ffmpeg, input) {
  const info = { video: false, audio: false, videoCodec: null, audioCodec: null };
  const onLog = ({ message }) => {
    // "(attached pic)" es la carátula de un mp3, no una pista de vídeo real.
    const v = /Stream #\d+:\d+.*: Video: (\w+)/.exec(message);
    if (v && !message.includes('attached pic') && !info.video) {
      info.video = true;
      info.videoCodec = v[1];
    }
    const a = /Stream #\d+:\d+.*: Audio: (\w+)/.exec(message);
    if (a && !info.audio) {
      info.audio = true;
      info.audioCodec = a[1];
    }
  };
  ffmpeg.on('log', onLog);
  try {
    // Sin archivo de salida ffmpeg lista las pistas y devuelve código != 0:
    // esperado. Un aborto del core, en cambio, sí lanza y se propaga.
    await safeExec(ffmpeg, ['-hide_banner', '-i', input]);
  } finally {
    ffmpeg.off('log', onLog);
  }
  return info;
}
