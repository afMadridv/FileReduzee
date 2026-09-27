# FileReduzee

Comprime y convierte archivos enteramente en el navegador — nada se sube a
un servidor.

Dos pestañas: **Comprimir** (fases 1 y 2 de FASES.txt) y **Convertir**.
Enlace directo a la segunda: `#convertir`.

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
| PNG / JPG / WEBP | Se prueba WebP al 80% y el formato original al 80%; gana el más chico | No — con pérdida, aunque la resolución no se toca |
| PDF | `pdf-lib`: limpia metadata, reescribe objetos | Sí — contenido visible intacto |
| ZIP / DOCX / cualquier otro | `pako` (gzip) | Sí, pero el ahorro suele ser mínimo — ya vienen comprimidos |
| RAR | No soportado | Crear `.rar` exige la herramienta con licencia de WinRAR; no existe códec libre |
| MP4 / MOV / WEBM / MKV | `ffmpeg.wasm`: H.264 CRF 23 o 28, audio AAC | No — con pérdida |
| MP3 / WAV / M4A / OGG | `ffmpeg.wasm`: MP3 a 128k o 192k | No — con pérdida |

### Límite de tamaño en audio y vídeo

`ffmpeg.wasm` es wasm32: tope de 4 GB de espacio de direcciones, y el archivo
entero tiene que entrar en su sistema de archivos en memoria antes de tocarlo
—entrada, frames decodificados y salida, todo en RAM a la vez—. Por eso hay
un tope explícito en **1 GB**: arriba de eso la app lo rechaza con una
explicación en vez de dejar que se muera la pestaña sin decir nada. Arriba de
300 MB funciona, pero lento y según la máquina.

Un archivo más grande que eso necesita una herramienta de escritorio
(HandBrake, ffmpeg). No es algo que se arregle con código: es el techo de
correr un transcodificador dentro del navegador.

El motor pesa ~31 MB de `.wasm` y se descarga sólo cuando llega el primer
archivo de audio o vídeo, nunca al abrir la página.

Dos reglas transversales:

- **Nunca se entrega algo más grande que el original.** Si toda
  recodificación engorda el archivo — pasa con lo que ya viene comprimido —
  se devuelve el original intacto y se dice así.
- **Las imágenes se recodifican con pérdida.** La resolución no se toca y a
  simple vista no se distingue, pero los píxeles no son idénticos. Para PNG
  realmente sin pérdida, a nivel de bytes, está la fase 3 (oxipng).

## Convertir — qué se puede y qué se pierde

Regla de entrada: sólo está la conversión que funciona de verdad dentro de
un navegador y da un archivo útil. Las que conservan menos de lo que su
nombre promete lo dicen en la propia opción del menú ("DOCX · sólo texto"),
no en letra chica.

| Desde | Hacia | Cómo | Qué se conserva |
|---|---|---|---|
| DOCX, MD, HTML, TXT | PDF, DOCX, MD, HTML, TXT | Todo pasa por HTML intermedio (mammoth, marked, turndown, pdfmake, docx) | Texto, títulos, listas, tablas, enlaces e imágenes. No la maquetación exacta de Word |
| PDF | DOCX, TXT, MD, HTML | pdf.js extrae el texto; títulos por tamaño de letra | **Sólo texto.** Un PDF escaneado no tiene texto: se avisa y se sugiere PNG/JPG |
| PDF | PNG, JPG | pdf.js dibuja cada página a ~144 ppp | Una imagen por página; varias van en un ZIP |
| PPTX | DOCX, TXT, MD, HTML | Se lee el XML de cada diapositiva | **Sólo texto** de las diapositivas, en orden |
| PNG, JPG, WEBP, AVIF, BMP, ICO, SVG, GIF | PNG, JPG, WEBP, AVIF\*, BMP, ICO, PDF | Canvas; BMP e ICO armados a mano; PDF con pdf-lib | JPG y BMP no tienen transparencia: se rellena con blanco. ICO trae 16 a 256 px |
| GIF animado | MP4, WEBM | ffmpeg.wasm | La animación. Como imagen, sólo el primer cuadro |
| XLSX, XLS, ODS, CSV, TSV, JSON | XLSX, ODS, CSV, JSON, HTML, MD | SheetJS 0.20.3 | Valores y fórmulas. Fechas en ISO (2026-01-15). Varias hojas a CSV: un ZIP |
| MP4, MOV, WEBM, MKV, AVI, M4V | MP4, WEBM, MOV, MKV, GIF, MP3, WAV, M4A | ffmpeg.wasm | Si los códecs ya sirven, se cambia sólo el contenedor: instantáneo y sin pérdida |
| MP3, WAV, M4A, AAC, OGG, OPUS, FLAC | MP3, WAV, OGG, OPUS, M4A, FLAC | ffmpeg.wasm | FLAC no recupera lo que un MP3 ya perdió |

\* AVIF y WebP aparecen como destino sólo si el navegador sabe escribirlos.

Lo que **no** está, a propósito: PPTX → PDF (sin un motor de Office no hay
forma de dibujar diapositivas fielmente en el navegador), XLSX → PDF (una
hoja ancha sale cortada), HEIC (ningún navegador salvo Safari lo decodifica
y la librería que lo haría no se pudo verificar con un archivo real), y RAR.

Detalles que costaron:

- **SheetJS desde cdn.sheetjs.com, no desde npm.** El `xlsx` de npm está
  congelado en 0.18.5 con fallos de seguridad conocidos al leer archivos
  ajenos. Instalar con `NODE_OPTIONS=--dns-result-order=ipv4first` si npm
  da `ENETUNREACH` (ruta IPv6 rota).
- **libopus aborta el core de ffmpeg.wasm 0.12** con cualquier entrada; se
  usa el codificador Opus nativo de ffmpeg.
- **Si ffmpeg.wasm aborta, la instancia queda muerta** y todo lo que siga
  falla en silencio. Se descarta y el próximo trabajo carga una limpia.
- **pdf.js dibuja a ritmo de `requestAnimationFrame`** con el intent normal,
  y el navegador lo congela en pestañas de fondo. Se usa `intent: 'print'`.
- **HTML y Markdown de afuera no se ejecutan nunca:** se parsean con
  `DOMParser` fuera de la página, se quitan scripts, eventos `on*` y enlaces
  `javascript:`, y no se descarga ninguna imagen remota.

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
    main.js                pestaña Comprimir: detecta tipo, enruta, UI
    tabs.js                pestañas Comprimir / Convertir (+ #hash)
    compressors/
      image.js               PNG / JPG / WEBP
      document.js              PDF
      generic.js                 respaldo universal (gzip)
      media.js                     audio y vídeo
    convert/
      index.js               pestaña Convertir: cola, enrutador, UI
      registry.js              qué se convierte a qué (única fuente)
      documents.js               DOCX/MD/HTML/TXT/PDF/PPTX vía HTML
      html-to-docx.js              HTML -> DOCX real (no altChunk)
      pdf.js                       pdf.js: texto y render de páginas
      images.js                    canvas, BMP, ICO, imagen -> PDF
      sheets.js                    SheetJS
      media.js                     ffmpeg: remux o recodificación
      text.js                      lectura con detección de codificación
    engine/
      ffmpeg.js              motor compartido, cola exclusiva, recuperación
    utils/
      format.js                    bytes legibles + disparo de descarga
vite.config.js               exclusiones e inclusiones del pre-bundling
FASES.txt                          plan completo para Claude Code
```

## Diseño

El diseño se hizo por separado en Claude Design ("Nocturne", oscuro) y se
implementó acá. El canvas exporta estilos inline; en el repo viven como
clases en `src/css/style.css`, para que la lógica de `src/js/` no dependa
del CSS y el próximo rediseño no tenga que tocarla.

La maqueta usaba datos inventados (ratios fijos por extensión, progreso
simulado, tabla de ejemplo). Acá todo sale de los compresores reales. Tres
cosas que la maqueta no contemplaba y sí existen:

- **Errores y omitidos** — `.rar`, audio/vídeo y archivos corruptos. Fila
  en gris con el motivo, sin romper el resto de la cola.
- **Progreso real** — los compresores no emiten eventos de progreso, así
  que la barra es indeterminada mientras trabajan. Un porcentaje inventado
  sería mentir.
- **La nota por formato** ("sin pérdida" o no) va bajo el nombre en la
  tabla de salida. Es el núcleo honesto del proyecto; la maqueta la había
  dejado fuera.
