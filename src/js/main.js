import { compressImage } from './compressors/image.js';
import { compressDocument } from './compressors/document.js';
import { compressGeneric } from './compressors/generic.js';
import { compressMedia } from './compressors/media.js';
import { formatBytes, extensionOf, triggerDownload } from './utils/format.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

const queueList = document.getElementById('queueList');
const queueEmpty = document.getElementById('queueEmpty');
const queueCount = document.getElementById('queueCount');
const clearBtn = document.getElementById('clearBtn');

const outputBody = document.getElementById('outputBody');
const outputEmpty = document.getElementById('outputEmpty');
const downloadAllBtn = document.getElementById('downloadAllBtn');

const lastDelta = document.getElementById('lastDelta');
const lastBefore = document.getElementById('lastBefore');
const lastAfter = document.getElementById('lastAfter');

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
const PDF_EXTS = ['pdf'];
const MEDIA_EXTS = ['mp3', 'wav', 'mp4', 'mov', 'webm', 'mkv'];
const NO_FREE_ENCODER_EXTS = ['rar'];

// Cada entrada: { id, file, ext, status, result?, reason? }
// status: 'pending' | 'processing' | 'done' | 'failed'
const entries = [];
let nextId = 0;
let draining = false;

/* --- Entrada de archivos ------------------------------------------------ */

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

['dragover', 'dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => e.preventDefault());
});
dropzone.addEventListener('dragover', () => dropzone.classList.add('is-dragging'));
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
dropzone.addEventListener('drop', (e) => {
  dropzone.classList.remove('is-dragging');
  addFiles(e.dataTransfer.files);
});

clearBtn.addEventListener('click', () => {
  // Lo ya encolado sigue procesándose; solo se limpia lo que se muestra.
  entries.length = 0;
  render();
});

downloadAllBtn.addEventListener('click', () => {
  entries.filter((e) => e.status === 'done').forEach((e) => {
    triggerDownload(e.result.blob, e.result.filename);
  });
});

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  files.forEach((file) => {
    entries.push({
      id: `f${nextId++}`,
      file,
      ext: extensionOf(file.name),
      status: 'pending',
    });
  });

  render();
  drain();
}

/* --- Procesamiento ------------------------------------------------------ */

// De a uno: comprimir varios archivos grandes en paralelo dispara el uso de
// memoria del tab sin ganar tiempo real.
async function drain() {
  if (draining) return;
  draining = true;

  try {
    for (;;) {
      const entry = entries.find((e) => e.status === 'pending');
      if (!entry) break;

      entry.status = 'processing';
      render();

      try {
        const result = await routeFile(entry.file);
        if (result.skipped) {
          entry.status = 'failed';
          entry.reason = result.skipped;
        } else {
          entry.status = 'done';
          entry.result = result;
        }
      } catch (err) {
        entry.status = 'failed';
        entry.reason = `No se pudo procesar: ${err.message}`;
        console.error(err);
      }

      render();
    }
  } finally {
    draining = false;
  }
}

async function routeFile(file) {
  const ext = extensionOf(file.name);

  if (IMAGE_EXTS.includes(ext)) return compressImage(file);
  if (PDF_EXTS.includes(ext)) return compressDocument(file);
  if (MEDIA_EXTS.includes(ext)) return compressMedia(file);

  if (NO_FREE_ENCODER_EXTS.includes(ext)) {
    return {
      skipped: '.rar no se puede crear sin la herramienta con licencia de WinRAR — no existe códec libre para eso.',
    };
  }

  // Cualquier otro tipo (zip, docx, txt, csv, lo que sea): respaldo genérico.
  return compressGeneric(file);
}

/* --- Render ------------------------------------------------------------- */

function deltaLabel(before, after) {
  if (before <= 0) return 'sin cambio';
  const pct = Math.round((1 - after / before) * 100);
  if (pct > 0) return `−${pct}%`;
  if (pct < 0) return `+${Math.abs(pct)}%`;
  return 'sin cambio';
}

function render() {
  renderQueue();
  renderOutput();
  renderLastPass();
}

function renderQueue() {
  queueCount.textContent = `${entries.length} ${entries.length === 1 ? 'archivo' : 'archivos'}`;
  queueEmpty.hidden = entries.length > 0;
  queueList.replaceChildren();

  entries.forEach((entry) => {
    const row = document.createElement('li');
    row.className = `queue-row is-${entry.status}`;

    const ext = document.createElement('span');
    ext.className = 'queue-ext';
    ext.textContent = entry.ext || 'bin';

    const main = document.createElement('div');
    main.className = 'queue-main';

    const name = document.createElement('span');
    name.className = 'queue-name';
    name.textContent = entry.file.name;

    const bar = document.createElement('div');
    bar.className = 'queue-bar';
    const fill = document.createElement('span');
    fill.className = 'queue-bar-fill';
    bar.appendChild(fill);

    main.append(name, bar);

    if (entry.status === 'failed') {
      const reason = document.createElement('span');
      reason.className = 'queue-reason';
      reason.textContent = entry.reason;
      main.appendChild(reason);
    }

    const before = document.createElement('span');
    before.className = 'queue-num';
    before.textContent = formatBytes(entry.file.size);

    const after = document.createElement('span');
    after.className = 'queue-num queue-after';
    after.textContent = entry.status === 'done' ? formatBytes(entry.result.blob.size) : '—';

    const delta = document.createElement('span');
    delta.className = 'queue-delta';
    delta.textContent = entry.status === 'done'
      ? deltaLabel(entry.file.size, entry.result.blob.size)
      : entry.status === 'processing' ? '···' : '—';

    row.append(ext, main, before, after, delta);
    queueList.appendChild(row);
  });
}

function renderOutput() {
  const done = entries.filter((e) => e.status === 'done');

  outputEmpty.hidden = done.length > 0;
  downloadAllBtn.disabled = done.length === 0;
  outputBody.replaceChildren();

  done.forEach((entry) => {
    const before = entry.file.size;
    const after = entry.result.blob.size;

    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    const name = document.createElement('span');
    name.className = 'output-name';
    name.textContent = entry.file.name;
    const note = document.createElement('span');
    note.className = 'output-note';
    note.textContent = entry.result.note;
    tdName.append(name, note);

    const tdBefore = document.createElement('td');
    tdBefore.className = 'num output-before';
    tdBefore.textContent = formatBytes(before);

    const tdAfter = document.createElement('td');
    tdAfter.className = 'num output-after';
    tdAfter.textContent = formatBytes(after);

    const tdDelta = document.createElement('td');
    const label = deltaLabel(before, after);
    tdDelta.className = label.startsWith('−') ? 'num output-delta' : 'num output-delta is-flat';
    tdDelta.textContent = label;

    const tdDownload = document.createElement('td');
    tdDownload.className = 'num';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-row';
    btn.textContent = 'Bajar';
    btn.addEventListener('click', () => triggerDownload(entry.result.blob, entry.result.filename));
    tdDownload.appendChild(btn);

    tr.append(tdName, tdBefore, tdAfter, tdDelta, tdDownload);
    outputBody.appendChild(tr);
  });
}

function renderLastPass() {
  const done = entries.filter((e) => e.status === 'done');
  const last = done[done.length - 1];

  if (!last) {
    lastDelta.textContent = '—';
    lastBefore.textContent = '—';
    lastAfter.textContent = '—';
    return;
  }

  const before = last.file.size;
  const after = last.result.blob.size;
  const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;

  lastDelta.textContent = pct > 0 ? `−${pct}` : String(pct);
  lastBefore.textContent = formatBytes(before);
  lastAfter.textContent = formatBytes(after);
}

render();
