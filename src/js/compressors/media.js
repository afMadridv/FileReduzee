// FASE 2 — deliberadamente no implementado todavía.
//
// El motor real para esto es @ffmpeg/ffmpeg (ffmpeg.wasm). Ese paquete lanza
// un Web Worker que debe compartir origen con la página bajo aislamiento
// cross-origin, así que no se podía importar de forma confiable desde un CDN
// suelto. Ese bloqueo ya no existe: la fase 1 trajo Vite. Lo que falta es la
// implementación, que es la fase 2 y se hace aparte para no mezclar una
// función nueva con la migración.
//
// Para agregarlo:
//   1. npm install @ffmpeg/ffmpeg @ffmpeg/util
//   2. Usar el core de un solo hilo (@ffmpeg/core, NO @ffmpeg/core-mt) para
//      evitar depender de los headers COOP/COEP, que rompen iframes y
//      scripts de terceros si no se manejan con cuidado.
//   3. Implementar compressMedia() abajo con el mismo contrato que ya usan
//      image.js y document.js: { blob, filename, note } o { skipped }.
//
// Referencia: https://ffmpegwasm.netlify.app/

export async function compressMedia(file) {
  return {
    skipped: `Audio/vídeo (${file.name}) llega en la fase 2 — todavía no está implementado.`,
  };
}
