import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // @ffmpeg/ffmpeg arranca su worker con
    //   new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    // y el pre-bundling de esbuild reescribe ese import.meta.url, con lo que el
    // worker deja de resolverse en dev. Excluirlo lo deja como módulo suelto y
    // la URL se resuelve bien.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    // Los conversores se cargan con import() recién al usarlos. Sin listarlos
    // acá, en dev Vite los descubre en ese momento y recarga la página a mitad
    // de una conversión. (En producción no pasa: todo sale empaquetado.)
    include: [
      'mammoth/mammoth.browser.min.js',
      'pdfjs-dist',
      'pdfmake/build/pdfmake',
      'pdfmake/build/vfs_fonts',
      'html-to-pdfmake',
      'docx',
      'marked',
      'turndown',
      'turndown-plugin-gfm',
      'xlsx',
      'fflate',
    ],
  },
});
