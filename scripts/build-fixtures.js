'use strict';

// Regenerates the parser test fixtures in test/fixtures from the demo sample builders.
// The date is fixed so the fixtures (and the tests' expectations) never change.
// Usage: npm run fixtures

const fs = require('node:fs');
const path = require('node:path');
const { buildDemoSamples } = require('../src/demo/samples');
const { createPdfPage } = require('../src/demo/pdf-writer');

const FIXTURE_DATE = '2026-10-06';
const OUT_DIR = path.join(__dirname, '..', 'test', 'fixtures');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const samples = await buildDemoSamples({ today: FIXTURE_DATE });
  for (const file of samples.files) {
    if (file.name.endsWith('.txt')) continue;
    fs.writeFileSync(path.join(OUT_DIR, file.name), file.body);
  }

  // A "scanned" PDF: a page with shapes but no text layer.
  const scan = createPdfPage();
  scan.rect(54, 54, 504, 40, { fill: [60, 60, 60] });
  for (let top = 120; top < 700; top += 18) scan.rect(54, top, 380 + ((top * 7) % 120), 8, { fill: [120, 120, 120] });
  fs.writeFileSync(path.join(OUT_DIR, 'scanned-syllabus.pdf'), scan.toBuffer({ title: 'Scanned syllabus' }));

  console.log(`Wrote fixtures for ${FIXTURE_DATE} to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
