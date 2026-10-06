'use strict';

/* global document, window -- used inside page.evaluate callbacks, which run in the browser */

// Captures the README screenshots from an in-process demo-mode instance, walking through
// the real flow: demo login, sample upload, review, save, dashboard views.
// Usage: npm run screenshots
//   (needs a Playwright Chromium: `npx playwright install chromium`, or set CHROMIUM_PATH)

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { createDependencies } = require('../src/server');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const VIEWPORT = { width: 1440, height: 900 };

async function startDemoServer() {
  const config = loadConfig({}, { demo: true });
  const app = createApp({ config, ...(await createDependencies(config)) });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, baseUrl: `http://localhost:${server.address().port}` };
}

async function capture(page, name, options = {}) {
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', ...options });
  console.log(`saved ${path.relative(process.cwd(), file)}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { server, baseUrl } = await startDemoServer();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, colorScheme: 'dark' });
    page.on('pageerror', (err) => {
      throw err;
    });

    await page.goto(baseUrl);
    await page.click('#demoBtn:not([hidden])');
    await page.waitForURL(`${baseUrl}/dashboard`);

    // Upload the three sample documents and wait for the review screen.
    await page.click('#uploadLoadSamplesBtn');
    await page.waitForFunction(() => document.querySelectorAll('.file-item').length === 3);
    await page.click('#uploadBtn');
    await page.waitForSelector('#reviewSection', { state: 'visible', timeout: 30_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, 'upload-review', { clip: { x: 0, y: 0, width: VIEWPORT.width, height: 1100 }, fullPage: true });

    await page.click('#saveBtn');
    await page.waitForSelector('.timeline-item');
    await capture(page, 'dashboard-timeline');

    await page.click('.view-btn[data-view="calendar"]');
    await page.waitForSelector('.calendar-grid');
    await capture(page, 'dashboard-calendar', { fullPage: true });

    await page.click('#settingsBtn');
    await page.click('.theme-option[data-theme="light"]');
    await page.click('#closeSettingsBtn');
    await page.click('.view-btn[data-view="byclass"]');
    await page.waitForSelector('.class-card');
    await capture(page, 'dashboard-by-class-light');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
