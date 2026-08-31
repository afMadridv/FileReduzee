# FileReduzee

Comprime archivos enteramente en el navegador — nada se sube a un servidor.

Estado actual: **fase 1 terminada** (migración a Vite) más el rediseño
"Nocturne" traído de Claude Design. El plan completo está en **FASES.txt**.

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
| MP3 / MP4 | Fase 2 — ver FASES.txt | — |

Dos reglas transversales:

- **Nunca se entrega algo más grande que el original.** Si toda
  recodificación engorda el archivo — pasa con lo que ya viene comprimido —
  se devuelve el original intacto y se dice así.
- **Las imágenes se recodifican con pérdida.** La resolución no se toca y a
  simple vista no se distingue, pero los píxeles no son idénticos. Para PNG
  realmente sin pérdida, a nivel de bytes, está la fase 3 (oxipng).

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
