'use strict';

const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');
const { FileReadError } = require('./errors');

const MAX_ROWS = 2000;
const MAX_COLUMNS = 30;
const MAX_SHEETS = 10;
const MAX_CELL_CHARS = 500;

// An .xlsx file is a zip archive. These limits are checked against the archive's central
// directory before anything is decompressed, to turn away obvious zip bombs cheaply.
const MAX_ZIP_ENTRIES = 300;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

function cleanCell(value) {
  return String(value).replace(/[\r\n\t|]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_CELL_CHARS);
}

function trimRow(cells) {
  const row = cells.slice(0, MAX_COLUMNS).map(cleanCell);
  while (row.length && row[row.length - 1] === '') row.pop();
  return row;
}

/** Parses CSV text into a single sheet of trimmed rows. */
function parseCsv(text) {
  let records;
  try {
    records = parse(text, {
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      to: MAX_ROWS,
    });
  } catch (err) {
    throw new FileReadError(`could not be read as CSV (${err.message.split('\n')[0]}).`);
  }
  const rows = records.map(trimRow).filter((row) => row.some(Boolean));
  return [{ name: null, rows }];
}

function assertReasonableZip(buffer) {
  const invalid = () => new FileReadError("doesn't look like a valid .xlsx file.");
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw invalid();

  // The End Of Central Directory record sits in the last 22 bytes plus an optional comment.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalid();

  const entries = buffer.readUInt16LE(eocd + 10);
  if (entries > MAX_ZIP_ENTRIES) throw new FileReadError('contains too many parts to be a normal spreadsheet.');

  let offset = buffer.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw invalid();
    total += buffer.readUInt32LE(offset + 24);
    if (total > MAX_UNCOMPRESSED_BYTES) throw new FileReadError('is too large once uncompressed.');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

/** Excel stores dates as wall-clock values; exceljs hands them back as UTC instants. */
function formatExcelDate(date) {
  const iso = date.toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  if (day === '1899-12-30') return time; // a time-only cell
  return time === '00:00' ? day : `${day} ${time}`;
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatExcelDate(value);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result); // formula
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return cellText(value.text); // hyperlink
    if ('error' in value) return '';
  }
  return String(value);
}

/** Reads every non-empty worksheet of an .xlsx file into rows of cell text. */
async function parseXlsx(buffer) {
  assertReasonableZip(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new FileReadError("couldn't be opened as an .xlsx spreadsheet.");
  }

  const sheets = [];
  for (const worksheet of workbook.worksheets.slice(0, MAX_SHEETS)) {
    const rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= MAX_ROWS) return;
      const cells = [];
      for (let col = 1; col <= Math.min(row.cellCount, MAX_COLUMNS); col += 1) {
        const cell = row.getCell(col);
        // exceljs reports a merged range's value in every cell of the range; keep it once.
        const mergedCopy = cell.isMerged && cell.master.address !== cell.address;
        cells.push(mergedCopy ? '' : cellText(cell.value));
      }
      const trimmed = trimRow(cells);
      if (trimmed.some(Boolean)) rows.push(trimmed);
    });
    if (rows.length) sheets.push({ name: worksheet.name, rows });
  }
  return sheets;
}

/** Renders sheets as pipe-separated rows, the format the extraction prompt expects. */
function formatSheets(sheets) {
  return sheets
    .map((sheet) => {
      const body = sheet.rows.map((row) => row.join(' | ')).join('\n');
      return sheet.name ? `[Sheet: ${sheet.name}]\n${body}` : body;
    })
    .join('\n\n');
}

module.exports = { parseCsv, parseXlsx, formatSheets, assertReasonableZip, MAX_ROWS };
