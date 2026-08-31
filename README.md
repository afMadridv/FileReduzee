# FileReduzee

Comprime archivos enteramente en el navegador — nada se sube a un servidor.

Estado actual: **fase 1 terminada** (migración a Vite). El plan completo está
en **FASES.txt**.

## Por qué esta estructura

Objetivo #1 desde el diseño original: que el sitio nunca falle al
desplegarse. Eso definió cada decisión de arquitectura:

- **Cero servidor.** Todo el procesamiento ocurre en el navegador del
  usuario (Web Workers + WebAssembly). Sin backend no hay binarios nativos
  (ffmpeg, Ghostscript) que instalar ni que falten en producción — la causa
  más común de "funciona en mi máquina, falla en el servidor" para este
  tipo de herramienta.
- **Las librerías se instalan por npm y se importan,** no se traen de un
  CDN en tiempo de ejecución. La fase 0 las cargaba por CDN y una de las
  URLs estaba corrupta: `browser-image-compression` devolvía 400 y toda la
  ruta de imágenes fallaba en silencio con `imageCompression is not
  defined`. Con imports, un paquete que falta rompe el build, no la página
  del usuario.
- **Un empaquetador, pero mínimo.** Vite con plantilla vanilla: sin
  framework, sin configuración propia. Hace falta para las fases 2, 3 y 4
  (ffmpeg.wasm, oxipng y sus archivos `.wasm` no se pueden cargar de forma
  confiable sin él).

Versiones fijadas exactas a propósito (`pako` 2.1.0,
`browser-image-compression` 1.0.13, `pdf-lib` 1.4.0): son las verificadas
en la fase 0, y no se suben sin una razón concreta.

## Qué hace cada formato — honestamente

| Formato | Estrategia | ¿Sin pérdida real? |
|---|---|---|
| PNG / JPG / WEBP | `browser-image-compression`, calidad 92% | Pérdida perceptual mínima, no exacta a nivel de bytes |
| PDF | `pdf-lib`: limpia metadata, reescribe objetos | Sí — contenido visible intacto |
| ZIP / DOCX / cualquier otro | `pako` (gzip) | Sí, pero el ahorro suele ser mínimo — ya vienen comprimidos |
| RAR | No soportado | Crear `.rar` exige la herramienta con licencia de WinRAR; no existe códec libre |
| MP3 / MP4 | Fase 2 — ver FASES.txt | — |

Nota sobre PNG: hoy el ahorro puede ser cercano a cero, porque recodificar
un PNG por canvas no lo optimiza de verdad. Eso lo resuelve la fase 3
(oxipng), que sí es sin pérdida a nivel de bytes.

## Correr en local

```bash
npm install
npm run dev
```

Para probar exactamente lo que se despliega:

```bash
npm run build && npm run preview
```

En Windows, `npm run build` falla con `ENOTEMPTY` si `npm run preview` está
corriendo — el servidor mantiene bloqueada `dist/`. Detenerlo antes de
reconstruir.

## Desplegar

Destino: **Vercel**. Detecta Vite automáticamente (build `npm run build`,
salida `dist/`), así que no hace falta ningún archivo de configuración —
solo conectar el repo o subir la carpeta.

```bash
npx vercel --prod
```

## Estructura

```
index.html                       entrada de Vite
src/
  css/style.css
  js/
    main.js                orquesta: detecta tipo, enruta, actualiza UI
    compressors/
      image.js               PNG / JPG / WEBP
      document.js              PDF
      generic.js                 respaldo universal (gzip)
      media.js                     stub — fase 2, ver FASES.txt
    utils/
      format.js                    bytes legibles + disparo de descarga
FASES.txt                          plan completo para Claude Code
```

Diseño visual: fuera de alcance por ahora. Se hará por separado en Claude
Design. El HTML es semántico y el CSS está desacoplado de la lógica a
propósito, para que ese rediseño no tenga que tocar `src/js/`.
