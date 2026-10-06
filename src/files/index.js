'use strict';

const path = require('node:path');
const { FileReadError } = require('./errors');
const { looksLikePdf, extractPdfText } = require('./pdf');
const { parseCsv, parseXlsx, formatSheets } = require('./spreadsheet');
const { parseIcs, formatEvents } = require('./ics');

const KIND_BY_EXTENSION = {
  '.pdf': 'pdf',
  '.txt': 'text',
  '.csv': 'csv',
  '.xlsx': 'xlsx',
  '.ics': 'ics',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
};

const ACCEPTED_EXTENSIONS = Object.keys(KIND_BY_EXTENSION);
const MIN_PDF_TEXT_CHARS = 50; // below this, treat the PDF as a scan
const MIN_TEXT_CHARS = 20;
const MAX_TEXT_CHARS = 100_000; // keeps one request's prompt (and cost) bounded

// Browsers report MIME types inconsistently (a CSV can arrive as application/vnd.ms-excel,
// an .ics as application/octet-stream), so uploads are classified by extension and then
// checked by content.
function detectKind(filename) {
  return KIND_BY_EXTENSION[path.extname(filename || '').toLowerCase()] ?? null;
}

function unsupportedFileMessage(filename) {
  if (path.extname(filename || '').toLowerCase() === '.xls') {
    return `${filename}: legacy .xls files aren't supported. Save it as .xlsx or .csv and upload that instead.`;
  }
  return `${filename}: unsupported file type. Upload a PDF, TXT, CSV, XLSX, ICS, PNG, JPG or WEBP file.`;
}

function sniffImage(buffer) {
  if (buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le'); // Excel "Unicode text"
  if (buffer.includes(0)) throw new FileReadError('looks like a binary file, not text.');
  return buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function requireText(text, emptyMessage) {
  const trimmed = text.trim();
  if (trimmed.length < MIN_TEXT_CHARS) throw new FileReadError(emptyMessage);
  if (trimmed.length <= MAX_TEXT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_TEXT_CHARS)}\n[... truncated: the rest of this file was not sent]`;
}

async function readByKind(kind, buffer, { timeZone, logger }) {
  switch (kind) {
    case 'pdf': {
      if (!looksLikePdf(buffer)) throw new FileReadError("doesn't look like a valid PDF.");
      let text = '';
      try {
        text = await extractPdfText(buffer);
      } catch (err) {
        if (err instanceof FileReadError) throw err;
        // Damaged or unusual PDFs still go to the model, which may be able to read them.
        logger.warn(`PDF text extraction failed (${err.message}); sending the file to the model instead.`);
      }
      if (text.trim().length >= MIN_PDF_TEXT_CHARS) return { text: requireText(text, 'contains no readable text.') };
      return { file: { mime: 'application/pdf', base64: buffer.toString('base64') } };
    }
    case 'text':
      return { text: requireText(decodeText(buffer), 'appears to be empty.') };
    case 'csv':
      return { text: requireText(formatSheets(parseCsv(decodeText(buffer))), 'appears to be empty.') };
    case 'xlsx':
      return { text: requireText(formatSheets(await parseXlsx(buffer)), 'appears to be empty.') };
    case 'ics':
      return { text: requireText(formatEvents(parseIcs(decodeText(buffer), { timeZone })), 'contains no events.') };
    case 'image': {
      const mime = sniffImage(buffer);
      if (!mime) throw new FileReadError("doesn't look like a PNG, JPEG or WEBP image.");
      return { file: { mime, base64: buffer.toString('base64') } };
    }
    default:
      throw new FileReadError('is not a supported file type.');
  }
}

/**
 * Turns one uploaded file into a document for the extractor: either `text` produced on
 * the server, or a `file` (scanned PDF or image) for the model to read visually.
 */
async function readUpload({ originalname: name, buffer }, { timeZone, logger = console } = {}) {
  const kind = detectKind(name);
  if (!kind) throw new FileReadError(unsupportedFileMessage(name));
  try {
    return { name, kind, ...(await readByKind(kind, buffer, { timeZone, logger })) };
  } catch (err) {
    if (err instanceof FileReadError) throw new FileReadError(`${name} ${err.message}`);
    throw err;
  }
}

/** Reads every file, collecting per-file problems instead of failing the whole upload. */
async function readUploads(files, { timeZone, logger = console } = {}) {
  const documents = [];
  const errors = [];
  for (const file of files) {
    try {
      documents.push(await readUpload(file, { timeZone, logger }));
    } catch (err) {
      if (err instanceof FileReadError) {
        errors.push(err.message);
      } else {
        logger.error(`Unexpected error reading an uploaded ${detectKind(file.originalname)} file:`, err);
        errors.push(`${file.originalname} could not be read.`);
      }
    }
  }
  return { documents, errors };
}

module.exports = {
  ACCEPTED_EXTENSIONS,
  detectKind,
  unsupportedFileMessage,
  readUpload,
  readUploads,
  sniffImage,
};
