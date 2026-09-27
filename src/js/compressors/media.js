// FASE 2 — compresión de audio y vídeo con ffmpeg.wasm.
// El motor, la cola de trabajos y el límite de tamaño viven en
// engine/ffmpeg.js, compartidos con la pestaña Convertir.

import { withMediaFile, run, readBlob, probe, HARD_LIMIT, WARN_LIMIT, tooLargeReason } from '../engine/ffmpeg.js';
import { extensionOf, formatBytes, withExtension } from '../utils/format.js';

const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'];

export const PRESETS = {
  equilibrado: { crf: 23, audioBitrate: '192k', maxHeight: null },
  agresivo: { crf: 28, audioBitrate: '128k', maxHeight: 720 },
};

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
  if (file.size > HARD_LIMIT) return { skipped: tooLargeReason(file, 'comprimir') };

  const preset = PRESETS[presetName] ?? PRESETS.agresivo;
  const isVideoExt = VIDEO_EXTS.includes(extensionOf(file.name));

  return withMediaFile(file, onProgress, async ({ ffmpeg, input, name }) => {
    // Un .webm o .mkv puede traer sólo audio (una nota de voz). Sin comprobarlo
    // ffmpeg igual produce un .mp4 —mete el audio y no se queja—, y la nota
    // terminaría diciendo "H.264" sobre algo que no tiene un solo fotograma.
    let isVideo = isVideoExt;
    if (isVideo) {
      onProgress({ percent: null, stage: 'Analizando pistas…' });
      isVideo = (await probe(ffmpeg, input)).video;
    }

    const output = name(isVideo ? 'mp4' : 'mp3');
    const code = await run(
      ffmpeg,
      buildArgs({ input, output, isVideo, preset }),
      onProgress,
      isVideo ? 'Recodificando vídeo…' : 'Recodificando audio…',
    );
    if (code !== 0) throw new Error('ffmpeg no pudo recodificar el archivo');

    const blob = await readBlob(ffmpeg, output, isVideo ? 'video/mp4' : 'audio/mpeg');

    const partes = [
      isVideo
        ? `Recodificado a H.264 (CRF ${preset.crf}) con audio AAC a ${preset.audioBitrate}.`
        : `Recodificado a MP3 a ${preset.audioBitrate}.`,
      preset.maxHeight && isVideo ? `Resolución limitada a ${preset.maxHeight}p.` : '',
      'Con pérdida: recodificar siempre decide calidad contra tamaño.',
      file.size > WARN_LIMIT
        ? `Aviso: ${formatBytes(file.size)} está cerca del límite de lo que aguanta un navegador.`
        : '',
    ];

    return {
      blob,
      filename: withExtension(file.name, isVideo ? 'mp4' : 'mp3', '-comprimido'),
      note: partes.filter(Boolean).join(' '),
    };
  });
}
