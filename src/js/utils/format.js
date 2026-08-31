// Formatea bytes en unidades legibles (B, KB, MB, GB).
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Inserta un sufijo antes de la extensión: "foto.png" -> "foto-comprimido.png"
export function withSuffix(name, suffix) {
  const i = name.lastIndexOf('.');
  return i > -1 ? `${name.slice(0, i)}${suffix}${name.slice(i)}` : `${name}${suffix}`;
}

// Dispara la descarga de un Blob con el nombre indicado.
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
