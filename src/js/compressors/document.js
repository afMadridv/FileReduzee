// PDF vía pdf-lib: quita metadata y reescribe los objetos internos usando
// object streams. No re-comprime las imágenes incrustadas (eso exigiría
// re-muestrearlas, que ya es pérdida) — por eso el ahorro aquí es modesto
// pero genuinamente sin tocar el contenido visible del documento.

import { PDFDocument } from 'pdf-lib';
import { withSuffix } from '../utils/format.js';

export async function compressDocument(file) {
  const bytes = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes);

  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('');
  pdfDoc.setCreator('');

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  const blob = new Blob([outBytes], { type: 'application/pdf' });

  return {
    blob,
    filename: withSuffix(file.name, '-comprimido'),
    note: 'Sin pérdida de contenido visible: se quitó metadata y se reescribieron los objetos internos.',
  };
}
