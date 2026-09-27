// Pestaña Convertir: cola de archivos, cada uno con su formato de destino.
// Esta capa es liviana a propósito; cada conversor (y su librería) se carga
// recién cuando hace falta.

import { describe, formatTable, labelFor } from './registry.js';
import { formatBytes, triggerDownload } from '../utils/format.js';

const $ = (id) => document.getElementById(id);

const dropzone = $('cvDropzone');
const fileInput = $('cvFileInput');
const queueList = $('cvQueueList');
const queueEmpty = $('cvQueueEmpty');
const queueCount = $('cvQueueCount');
const convertAllBtn = $('cvConvertAllBtn');
const clearBtn = $('cvClearBtn');
const outputBody = $('cvOutputBody');
const outputEmpty = $('cvOutputEmpty');
const downloadAllBtn = $('cvDownloadAllBtn');
const deleteAllBtn = $('cvDeleteAllBtn');
const lastFrom = $('cvLastFrom');
const lastTo = $('cvLastTo');
const lastBefore = $('cvLastBefore');
const lastAfter = $('cvLastAfter');
const formatsBody = $('cvFormatsBody');

// status: idle | pending | processing | done | failed | unsupported
const entries = [];
const outputs = [];
let nextId = 0;
let draining = false;

/* --- Entrada -------------------------------------------------------------- */

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', (e) => {
  addFiles(e.target.files);
  fileInput.value = '';
});
['dragover', 'dragleave', 'drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => e.preventDefault()));
dropzone.addEventListener('dragover', () => dropzone.classList.add('is-dragging'));
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
dropzone.addEventListener('drop', (e) => {
  dropzone.classList.remove('is-dragging');
  addFiles(e.dataTransfer.files);
});

function addFiles(list) {
  Array.from(list || []).forEach((file) => {
    const info = describe(file);
    entries.push({
      id: `c${nextId++}`,
      file,
      info,
      target: info?.default ?? null,
      status: info && info.targets.length ? 'idle' : 'unsupported',
      reason: info ? null : 'Este formato no se puede convertir acá.',
    });
  });
  render();
}

convertAllBtn.addEventListener('click', () => {
  entries.filter((e) => e.status === 'idle' || e.status === 'failed').forEach(enqueue);
});

clearBtn.addEventListener('click', () => {
  // Lo que ya está en el conversor termina; se quita lo demás de la vista.
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status !== 'processing') entries.splice(i, 1);
  }
  render();
});

downloadAllBtn.addEventListener('click', () => outputs.forEach((o) => triggerDownload(o.blob, o.filename)));
deleteAllBtn.addEventListener('click', () => {
  outputs.length = 0;
  render();
});

function enqueue(entry) {
  entry.status = 'pending';
  entry.reason = null;
  render();
  drain();
}

/* --- Conversión ----------------------------------------------------------- */

async function convert(entry, onProgress) {
  const { file, target } = entry;
  const { ext, family } = entry.info;

  if (family === 'video' || family === 'audio' || (ext === 'gif' && (target === 'mp4' || target === 'webm'))) {
    const { convertMedia } = await import('./media.js');
    return convertMedia(file, target, onProgress);
  }

  if (family === 'image') {
    const { convertImage } = await import('./images.js');
    return convertImage(file, target, onProgress);
  }

  if (family === 'sheet') {
    const { convertSheet } = await import('./sheets.js');
    return convertSheet(file, ext, target, onProgress);
  }

  if (family === 'pdf' && (target === 'png' || target === 'jpg')) {
    const { renderPages } = await import('./pdf.js');
    const pages = await renderPages(file, target === 'png' ? 'image/png' : 'image/jpeg', onProgress);
    if (pages.length === 1) {
      return { blob: new Blob([pages[0]], { type: target === 'png' ? 'image/png' : 'image/jpeg' }), notes: ['1 página a ~144 ppp.'] };
    }
    const { zipSync } = await import('fflate');
    const files = Object.fromEntries(pages.map((bytes, i) => [`pagina-${String(i + 1).padStart(3, '0')}.${target}`, bytes]));
    // Las imágenes ya están comprimidas: meterlas al ZIP sin recomprimir.
    return {
      blob: new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }),
      ext: 'zip',
      suffix: '-paginas',
      notes: [`${pages.length} páginas a ~144 ppp, una imagen por página dentro de un ZIP.`],
    };
  }

  const { convertDocument } = await import('./documents.js');
  return convertDocument(file, ext, target, onProgress);
}

// Las librerías fallan en inglés técnico ("can't find end of central
// directory", "Invalid PDF structure"). Los casos que un usuario de verdad se
// encuentra se traducen a qué pasó y qué hacer.
function friendly(err, ext) {
  const msg = err?.message || String(err ?? 'error desconocido');
  if (/password|encrypt/i.test(msg) || err?.name === 'PasswordException') {
    return 'el archivo está protegido con contraseña; quitásela antes de convertirlo.';
  }
  if (/central directory|zip file|corrupted zip|end of data|invalid zip/i.test(msg)) {
    return `el archivo está dañado o no es un .${ext} de verdad (quizás le cambiaron la extensión).`;
  }
  if (/invalid pdf|no pdf header|pdf structure/i.test(msg)) {
    return 'el PDF está dañado o no es un PDF.';
  }
  if (/decode|decodificar/i.test(msg) && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'ico', 'svg'].includes(ext)) {
    return 'la imagen está dañada o el navegador no sabe leer este formato.';
  }
  return msg.charAt(0).toLowerCase() + msg.slice(1);
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const entry = entries.find((e) => e.status === 'pending');
      if (!entry) break;

      entry.status = 'processing';
      entry.percent = null;
      entry.stage = null;
      render();

      try {
        const result = await convert(entry, ({ percent, stage }) => {
          entry.percent = percent;
          entry.stage = stage;
          updateProgress(entry);
        });

        if (result.skipped) {
          entry.status = 'failed';
          entry.reason = result.skipped;
        } else {
          const base = entry.file.name.replace(/\.[^.]+$/, '') || entry.file.name;
          const ext = result.ext ?? entry.target;
          outputs.push({
            id: `o${nextId++}`,
            source: entry.file,
            from: entry.info.ext,
            to: entry.target,
            label: labelFor(entry.info.ext, entry.target),
            blob: result.blob,
            filename: `${base}${result.suffix ?? ''}.${ext}`,
            note: result.notes.filter(Boolean).join(' '),
          });
          entry.status = 'done';
        }
      } catch (err) {
        entry.status = 'failed';
        entry.reason = `No se pudo convertir: ${friendly(err, entry.info.ext)}`;
        console.error(err);
      }
      render();
    }
  } finally {
    draining = false;
  }
}

/* --- Render ------------------------------------------------------------- */

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function render() {
  renderQueue();
  renderOutput();
  renderLast();
}

function renderQueue() {
  queueCount.textContent = `${entries.length} ${entries.length === 1 ? 'archivo' : 'archivos'}`;
  queueEmpty.hidden = entries.length > 0;
  convertAllBtn.disabled = !entries.some((e) => e.status === 'idle' || e.status === 'failed');

  // Conservar el foco del teclado si estaba en un control de una fila: el
  // render reconstruye la lista entera.
  const focused = document.activeElement?.closest?.('[data-entry]');
  const focusKey = focused ? `${focused.dataset.entry}:${document.activeElement.dataset.role}` : null;

  queueList.replaceChildren();

  entries.forEach((entry) => {
    const busy = entry.status === 'pending' || entry.status === 'processing';
    const row = el('li', `queue-row convert-row is-${entry.status}`);
    row.dataset.entry = entry.id;

    row.append(el('span', 'queue-ext', entry.info?.ext || '—'));

    const main = el('div', 'queue-main');
    main.append(el('span', 'queue-name', entry.file.name));
    const bar = el('div', 'queue-bar');
    const fill = el('span', 'queue-bar-fill');
    if (entry.status === 'processing' && typeof entry.percent === 'number') {
      row.classList.add('has-progress');
      fill.style.width = `${entry.percent}%`;
    }
    bar.append(fill);
    main.append(bar);

    const line = entry.status === 'processing' ? entry.stage
      : entry.status === 'pending' ? 'En cola…'
        : entry.status === 'done' ? `Listo: ${labelFor(entry.info.ext, entry.target)}`
          : entry.reason;
    if (line) main.append(el('span', 'queue-reason', line));
    row.append(main);

    // Selector de destino
    const pick = el('div', 'convert-pick');
    if (entry.info && entry.info.targets.length) {
      const label = el('label', 'convert-pick-label', 'a');
      const select = el('select', 'convert-select');
      select.id = `sel-${entry.id}`;
      select.dataset.role = 'select';
      label.htmlFor = select.id;
      select.setAttribute('aria-label', `Convertir ${entry.file.name} a`);
      entry.info.targets.forEach((t) => {
        const opt = el('option', null, t.label);
        opt.value = t.value;
        opt.selected = t.value === entry.target;
        select.append(opt);
      });
      select.disabled = busy;
      select.addEventListener('change', () => {
        entry.target = select.value;
        // Cambiar el destino de algo ya convertido lo deja listo para otra vuelta.
        if (entry.status === 'done' || entry.status === 'failed') {
          entry.status = 'idle';
          entry.reason = null;
        }
        renderQueue();
      });
      pick.append(label, select);
    }
    row.append(pick);

    row.append(el('span', 'queue-num', formatBytes(entry.file.size)));

    const actions = el('div', 'convert-actions');
    if (entry.status !== 'unsupported') {
      const go = el('button', 'btn btn-primary btn-micro', entry.status === 'failed' ? 'Reintentar'
        : entry.status === 'done' ? 'Hecho'
          : busy ? '···' : 'Convertir');
      go.type = 'button';
      go.dataset.role = 'go';
      go.disabled = busy || entry.status === 'done';
      go.addEventListener('click', () => enqueue(entry));
      actions.append(go);
    }
    const remove = el('button', 'btn btn-ghost btn-micro btn-muted', 'Quitar');
    remove.type = 'button';
    remove.dataset.role = 'remove';
    remove.disabled = entry.status === 'processing';
    remove.setAttribute('aria-label', `Quitar ${entry.file.name} de la cola`);
    remove.addEventListener('click', () => {
      const i = entries.indexOf(entry);
      if (i > -1) entries.splice(i, 1);
      render();
    });
    actions.append(remove);
    row.append(actions);

    queueList.append(row);
  });

  if (focusKey) {
    const [id, role] = focusKey.split(':');
    queueList.querySelector(`[data-entry="${id}"] [data-role="${role}"]`)?.focus();
  }
}

// El progreso llega decenas de veces por segundo. Reconstruir toda la cola en
// cada evento cerraría un desplegable abierto en otra fila; se toca sólo la
// fila que avanza.
function updateProgress(entry) {
  const row = queueList.querySelector(`[data-entry="${entry.id}"]`);
  if (!row) return;
  const fill = row.querySelector('.queue-bar-fill');
  if (typeof entry.percent === 'number') {
    row.classList.add('has-progress');
    fill.style.width = `${entry.percent}%`;
  } else {
    row.classList.remove('has-progress');
    fill.style.width = '';
  }
  let line = row.querySelector('.queue-reason');
  if (!line) {
    line = el('span', 'queue-reason');
    row.querySelector('.queue-main').append(line);
  }
  line.textContent = entry.stage || '';
}

function renderOutput() {
  outputEmpty.hidden = outputs.length > 0;
  downloadAllBtn.disabled = outputs.length === 0;
  deleteAllBtn.disabled = outputs.length === 0;
  outputBody.replaceChildren();

  outputs.forEach((o) => {
    const tr = el('tr');

    const name = el('td');
    name.append(el('span', 'output-name', o.filename), el('span', 'output-note', o.note));

    const conv = el('td', 'num output-delta', `${o.from.toUpperCase()} → ${o.to.toUpperCase()}`);
    const size = el('td', 'num output-after', formatBytes(o.blob.size));

    const actions = el('td', 'num row-actions');
    const down = el('button', 'btn btn-ghost btn-row', 'Bajar');
    down.type = 'button';
    down.addEventListener('click', () => triggerDownload(o.blob, o.filename));
    const rm = el('button', 'btn btn-ghost btn-row btn-muted', 'Quitar');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Quitar ${o.filename} de la lista`);
    rm.addEventListener('click', () => {
      outputs.splice(outputs.indexOf(o), 1);
      render();
    });
    actions.append(down, rm);

    tr.append(name, conv, size, actions);
    outputBody.append(tr);
  });
}

function renderLast() {
  const last = outputs[outputs.length - 1];
  lastFrom.textContent = last ? last.from.toUpperCase() : '—';
  lastTo.textContent = last ? last.to.toUpperCase() : '—';
  lastBefore.textContent = last ? formatBytes(last.source.size) : '—';
  lastAfter.textContent = last ? formatBytes(last.blob.size) : '—';
}

function renderFormats() {
  formatsBody.replaceChildren();
  formatTable().forEach((row) => {
    const tr = el('tr');
    tr.append(
      el('td', 'formats-family', row.family),
      el('td', 'formats-list', row.sources.map((s) => s.toUpperCase()).join(' · ')),
      el('td', 'formats-list', row.targets.map((s) => s.toUpperCase()).join(' · ')),
    );
    formatsBody.append(tr);
  });
}

renderFormats();
render();
