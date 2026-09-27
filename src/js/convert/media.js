// Conversión de audio y vídeo con el motor ffmpeg.wasm compartido.

import { withMediaFile, run, readBlob, probe, HARD_LIMIT, tooLargeReason } from '../engine/ffmpeg.js';
import { MIME } from './registry.js';

const VIDEO_TARGETS = new Set(['mp4', 'webm', 'mov', 'mkv', 'gif']);

// Un GIF largo es un desastre: cientos de MB y la pestaña sin memoria.
const GIF_MAX_SECONDS = 30;

// Qué códecs puede llevar cada contenedor tal cual, sin recodificar.
const REMUX_OK = {
  mp4: { video: ['h264', 'hevc'], audio: ['aac', 'mp3'] },
  mov: { video: ['h264', 'hevc'], audio: ['aac', 'mp3'] },
  mkv: { video: null, audio: null }, // Matroska acepta cualquier cosa
  webm: { video: ['vp8', 'vp9', 'av1'], audio: ['vorbis', 'opus'] },
};

function canRemux(target, info) {
  const rule = REMUX_OK[target];
  if (!rule || !info.video) return false;
  const vOk = !rule.video || rule.video.includes(info.videoCodec);
  const aOk = !info.audio || !rule.audio || rule.audio.includes(info.audioCodec);
  return vOk && aOk;
}

function videoArgs(target, input, output, info) {
  const audio = info.audio;
  switch (target) {
    case 'mp4':
    case 'mov':
    case 'mkv':
      return ['-i', input,
        '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        // libx264 exige ancho y alto pares.
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        ...(audio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
        ...(target === 'mkv' ? [] : ['-movflags', '+faststart']),
        output];
    case 'webm':
      // VP8 en modo tiempo real: VP9 en wasm de un solo hilo tarda minutos
      // por cada segundo de vídeo.
      // yuv420p: un GIF se decodifica con canal alfa y libvpx se niega a
      // codificar transparencia en este modo.
      return ['-i', input,
        '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-crf', '10', '-b:v', '3M', '-deadline', 'realtime', '-cpu-used', '6',
        ...(audio ? ['-c:a', 'libvorbis', '-q:a', '5'] : ['-an']),
        output];
    case 'gif':
      // Paleta generada a partir del propio vídeo: sin ella un GIF de 256
      // colores sale lleno de bandas.
      return ['-t', String(GIF_MAX_SECONDS), '-i', input,
        '-vf', "fps=12,scale='min(640,iw)':-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5",
        '-loop', '0', output];
    default:
      return null;
  }
}

function audioArgs(target, input, output) {
  const base = ['-i', input, '-vn'];
  switch (target) {
    case 'mp3': return [...base, '-c:a', 'libmp3lame', '-q:a', '2', output];
    case 'wav': return [...base, '-c:a', 'pcm_s16le', output];
    case 'ogg': return [...base, '-c:a', 'libvorbis', '-q:a', '6', output];
    // libopus aborta el core de ffmpeg.wasm 0.12 con cualquier entrada
    // ("memory access out of bounds"); el codificador Opus nativo de ffmpeg
    // funciona. Opus sólo admite 48 kHz y submúltiplos.
    case 'opus': return [...base, '-c:a', 'opus', '-strict', '-2', '-b:a', '128k', '-ar', '48000', output];
    case 'm4a': return [...base, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output];
    case 'flac': return [...base, '-c:a', 'flac', output];
    default: return null;
  }
}

const AUDIO_NOTES = {
  mp3: 'MP3 de calidad alta (VBR ~190 kbps).',
  wav: 'WAV PCM 16 bits sin compresión: pesa mucho, es el formato.',
  ogg: 'Ogg Vorbis de calidad alta.',
  opus: 'Opus a 128 kbps, 48 kHz.',
  m4a: 'M4A (AAC) a 192 kbps.',
  flac: 'FLAC: compresión sin pérdida. Si el origen ya tenía pérdida (MP3, AAC), no la recupera.',
};

export async function convertMedia(file, target, onProgress) {
  if (file.size > HARD_LIMIT) return { skipped: tooLargeReason(file, 'convertir') };

  return withMediaFile(file, onProgress, async ({ ffmpeg, input, name }) => {
    onProgress({ percent: null, stage: 'Analizando pistas…' });
    const info = await probe(ffmpeg, input);
    const wantsVideo = VIDEO_TARGETS.has(target);

    if (wantsVideo && !info.video) {
      throw new Error('el archivo no tiene pista de vídeo; elegí un formato de audio (MP3, WAV, M4A)');
    }
    if (!wantsVideo && !info.audio) {
      throw new Error('el archivo no tiene pista de audio');
    }

    const output = name(target);
    const notes = [];

    // Primero el camino rápido: cambiar de contenedor sin tocar los datos.
    if (wantsVideo && canRemux(target, info)) {
      const code = await run(ffmpeg, ['-i', input, '-c', 'copy', ...(target === 'mkv' || target === 'webm' ? [] : ['-movflags', '+faststart']), output], onProgress, 'Cambiando de contenedor…');
      if (code === 0) {
        notes.push('Sin recodificar: se cambió el contenedor y se copiaron las pistas tal cual. Misma calidad, instantáneo.');
        return { blob: await readBlob(ffmpeg, output, MIME[target]), notes };
      }
      await ffmpeg.deleteFile(output).catch(() => {});
    }

    const args = wantsVideo ? videoArgs(target, input, output, info) : audioArgs(target, input, output);
    if (!args) throw new Error(`no hay conversión a ${target.toUpperCase()}`);

    const code = await run(ffmpeg, args, onProgress, wantsVideo ? 'Recodificando vídeo…' : 'Recodificando audio…');
    if (code !== 0) throw new Error(`ffmpeg no pudo convertir a ${target.toUpperCase()}`);

    if (target === 'gif') notes.push(`GIF a 12 cuadros por segundo, hasta 640 px de ancho y los primeros ${GIF_MAX_SECONDS} s.`);
    else if (target === 'webm') notes.push(`WebM con VP8${info.audio ? ' y Vorbis' : ''}.`);
    else if (wantsVideo) notes.push(`${target.toUpperCase()} con H.264 (CRF 20, calidad alta)${info.audio ? ' y AAC' : ''}.`);
    else notes.push(AUDIO_NOTES[target]);

    if (!wantsVideo && info.video) notes.push('Sólo se extrajo el audio.');

    return { blob: await readBlob(ffmpeg, output, MIME[target]), notes };
  });
}
