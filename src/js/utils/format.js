// Formatea bytes con el mismo criterio que el diseño: MB/GB con un decimal,
// KB redondeado a entero, bytes tal cual. (El diseño no contemplaba GB; se
// agregó porque un archivo real puede pasar el giga.)
export function formatBytes(bytes) {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// Inserta un sufijo antes de la extensión: "foto.png" -> "foto-comprimido.png"
export function withSuffix(name, suffix) {
  const i = name.lastIndexOf('.');
  return i > -1 ? `${name.slice(0, i)}${suffix}${name.slice(i)}` : `${name}${suffix}`;
}

// Agrega un sufijo y, si se pide, cambia la extensión:
//   ("foto.png", "webp", "-comprimido") -> "foto-comprimido.webp"
//   ("foto.png", null,   "-comprimido") -> "foto-comprimido.png"
export function withExtension(name, ext, suffix = '') {
  const i = name.lastIndexOf('.');
  const base = i > -1 ? name.slice(0, i) : name;
  const current = i > -1 ? name.slice(i + 1) : '';
  const final = ext ?? current;
  return final ? `${base}${suffix}.${final}` : `${base}${suffix}`;
}

// Extensión en minúsculas, o '' si el archivo no tiene.
export function extensionOf(name) {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
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
