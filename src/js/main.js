import { compressImage } from './compressors/image.js';
import { compressDocument } from './compressors/document.js';
import { compressGeneric } from './compressors/generic.js';
import { compressMedia } from './compressors/media.js';
import { formatBytes, triggerDownload } from './utils/format.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');

const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');

const resultEl = document.getElementById('result');
const resultName = document.getElementById('resultName');
const resultBarFill = document.getElementById('resultBarFill');
const resultBefore = document.getElementById('resultBefore');
const resultAfter = document.getElementById('resultAfter');
const resultPct = document.getElementById('resultPct');
const resultNote = document.getElementById('resultNote');
const downloadBtn = document.getElementById('downloadBtn');

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
const PDF_EXTS = ['pdf'];
const MEDIA_EXTS = ['mp3', 'wav', 'mp4', 'mov', 'webm', 'mkv'];
const NO_FREE_ENCODER_EXTS = ['rar'];

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
  fileInput.value = '';
});

['dragover', 'dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => e.preventDefault());
});
dropzone.addEventListener('dragover', () => dropzone.classList.add('is-dragging'));
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
dropzone.addEventListener('drop', (e) => {
  dropzone.classList.remove('is-dragging');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  resultEl.hidden = true;
  showStatus(`Procesando ${file.name}…`);

  try {
    const result = await routeFile(file);

    if (result.skipped) {
      showStatus(result.skipped);
      return;
    }

    hideStatus();
    showResult(file, result);
  } catch (err) {
    showStatus(`No se pudo procesar ${file.name}: ${err.message}`);
    console.error(err);
  }
}

async function routeFile(file) {
  const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';

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

function showStatus(text) {
  statusText.textContent = text;
  statusEl.hidden = false;
}

function hideStatus() {
  statusEl.hidden = true;
}

function showResult(file, { blob, filename, note }) {
  const before = file.size;
  const after = blob.size;
  const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;

  resultName.textContent = file.name;
  resultBefore.textContent = formatBytes(before);
  resultAfter.textContent = formatBytes(after);
  resultPct.textContent = pct > 0 ? `-${pct}%` : pct < 0 ? `+${Math.abs(pct)}%` : 'sin cambio';
  resultBarFill.style.width = `${before > 0 ? Math.min(100, (after / before) * 100) : 100}%`;
  resultNote.textContent = note;

  downloadBtn.hidden = false;
  downloadBtn.onclick = (e) => {
    e.preventDefault();
    triggerDownload(blob, filename);
  };

  resultEl.hidden = false;
}
