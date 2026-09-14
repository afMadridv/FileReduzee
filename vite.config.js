import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // @ffmpeg/ffmpeg arranca su worker con
    //   new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    // y el pre-bundling de esbuild reescribe ese import.meta.url, con lo que el
    // worker deja de resolverse en dev. Excluirlo lo deja como módulo suelto y
    // la URL se resuelve bien.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
