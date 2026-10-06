'use strict';

// A deliberately small PDF writer: one page, the standard Helvetica fonts, text, lines and
// filled rectangles. It exists so demo mode can generate its sample syllabus with dates
// relative to today, without pulling a PDF library into the production dependencies.

const FONTS = { regular: 'F1', bold: 'F2', italic: 'F3' };
const BASE_FONTS = { F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Helvetica-Oblique' };

// Characters outside Latin-1 that the standard fonts' WinAnsi encoding can still show.
const WIN_ANSI_EXTRAS = { '–': 0x96, '—': 0x97, '•': 0x95, '’': 0x92, '“': 0x93, '”': 0x94 };

function encodeText(value) {
  const bytes = [];
  for (const char of String(value)) {
    const code = WIN_ANSI_EXTRAS[char] ?? char.codePointAt(0);
    const byte = code <= 0xff ? code : 0x3f; // "?"
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c); // escape ( ) \
    bytes.push(byte);
  }
  return Buffer.from(bytes).toString('latin1');
}

const rgb = ([r, g, b]) => [r, g, b].map((c) => (c / 255).toFixed(3)).join(' ');

/**
 * Creates a page. Coordinates are in points measured from the top-left corner, which is
 * easier to lay out by hand than PDF's bottom-left origin.
 */
function createPdfPage({ width = 612, height = 792 } = {}) {
  const ops = [];
  const y = (top) => (height - top).toFixed(2);

  return {
    text(x, top, value, { font = 'regular', size = 10, color = [20, 20, 30] } = {}) {
      ops.push(`BT /${FONTS[font]} ${size} Tf ${rgb(color)} rg ${x.toFixed(2)} ${y(top)} Td (${encodeText(value)}) Tj ET`);
    },

    line(x1, top1, x2, top2, { width: lineWidth = 0.5, color = [200, 200, 210] } = {}) {
      ops.push(`${rgb(color)} RG ${lineWidth} w ${x1} ${y(top1)} m ${x2} ${y(top2)} l S`);
    },

    rect(x, top, w, h, { fill = [240, 240, 245] } = {}) {
      ops.push(`${rgb(fill)} rg ${x} ${y(top + h)} ${w} ${h} re f`);
    },

    toBuffer({ title = 'Document' } = {}) {
      const content = Buffer.from(ops.join('\n'), 'latin1');
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
          '/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>',
        null, // content stream, written separately below
        ...Object.values(BASE_FONTS).map((name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`),
        `<< /Title (${encodeText(title)}) /Producer (AssignDash demo) >>`,
      ];

      const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
      const offsets = [];
      let length = chunks[0].length;
      const push = (buffer) => {
        chunks.push(buffer);
        length += buffer.length;
      };

      objects.forEach((body, index) => {
        offsets.push(length);
        const number = index + 1;
        if (body === null) {
          push(Buffer.from(`${number} 0 obj\n<< /Length ${content.length} >>\nstream\n`, 'latin1'));
          push(content);
          push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
        } else {
          push(Buffer.from(`${number} 0 obj\n${body}\nendobj\n`, 'latin1'));
        }
      });

      const xrefOffset = length;
      const xref = [
        'xref',
        `0 ${objects.length + 1}`,
        '0000000000 65535 f ',
        ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
        'trailer',
        `<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>`,
        'startxref',
        String(xrefOffset),
        '%%EOF',
        '',
      ].join('\n');
      push(Buffer.from(xref, 'latin1'));
      return Buffer.concat(chunks);
    },
  };
}

module.exports = { createPdfPage };
