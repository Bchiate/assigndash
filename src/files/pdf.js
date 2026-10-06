'use strict';

const { getDocumentProxy, extractText } = require('unpdf');
const { FileReadError } = require('./errors');

const MAX_PAGES = 40;

function looksLikePdf(buffer) {
  return buffer.subarray(0, 1024).includes('%PDF-');
}

/** Returns the PDF's text layer, or an empty string for scanned documents. */
async function extractPdfText(buffer) {
  // pdf.js may transfer (detach) the bytes it is given, so pass a copy: the original buffer
  // is still needed if the PDF turns out to be a scan and gets sent to the model instead.
  const pdf = await getDocumentProxy(new Uint8Array(buffer), { isEvalSupported: false });
  try {
    if (pdf.numPages > MAX_PAGES) {
      throw new FileReadError(`has ${pdf.numPages} pages; upload just the schedule pages (up to ${MAX_PAGES}).`);
    }
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

module.exports = { looksLikePdf, extractPdfText, MAX_PAGES };
