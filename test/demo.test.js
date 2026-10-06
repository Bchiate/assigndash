'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildDemoSamples } = require('../src/demo/samples');
const { createDemoExtractor } = require('../src/extraction/demo');
const { readUpload } = require('../src/files');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory-store');
const { createMemoryAuth } = require('../src/auth/memory-auth');
const { testConfig, silentLogger } = require('./helpers');

describe('demo samples', () => {
  let samples;
  before(async () => {
    samples = await buildDemoSamples({ today: '2027-02-17' });
  });

  it('places the demo semester around today', () => {
    assert.equal(samples.term.name, 'Spring 2027');
    assert.equal(samples.term.start, '2027-01-11');
    assert.equal(samples.term.end, '2027-04-30');
  });

  it('generates sample files whose contents match the canned extraction', async () => {
    const extractor = createDemoExtractor({ samples });
    for (const file of samples.files) {
      const doc = await readUpload({ originalname: file.name, buffer: file.body }, { logger: silentLogger });
      assert.ok(doc.text, `${file.name} should have a text layer`);
      const { data } = await extractor.extract({ documents: [doc] });
      assert.equal(data.classes.length, 1, file.name);
      for (const item of data.classes[0].assignments) {
        assert.ok(doc.text.includes(item.title), `${file.name} should mention "${item.title}"`);
      }
    }
  });

  it('refuses documents it does not know', async () => {
    const extractor = createDemoExtractor({ samples });
    await assert.rejects(
      extractor.extract({ documents: [{ name: 'mine.txt', kind: 'text', text: 'BIOL 2000 Lab report due 9/14' }] }),
      { status: 422 },
    );
  });
});

describe('demo mode app', () => {
  it('offers a one-click demo account and serves the samples', async () => {
    const samples = await buildDemoSamples();
    const app = createApp({
      config: testConfig({ demo: true }),
      store: createMemoryStore(),
      auth: createMemoryAuth(),
      extractor: createDemoExtractor({ samples }),
      samples,
      logger: silentLogger,
    });
    assert.equal((await request(app).get('/api/config')).body.demo, true);

    const agent = request.agent(app);
    assert.equal((await agent.post('/api/demo-login')).status, 200);
    assert.equal((await agent.get('/api/me')).body.name, 'Demo Student');

    const list = (await agent.get('/demo/samples')).body;
    assert.deepEqual(list.filter((s) => s.autoload).map((s) => s.name), ['astr-1270-syllabus.pdf', 'stat-2380-schedule.xlsx', 'writ-1190-calendar.ics']);

    const pdf = await agent.get('/demo/samples/astr-1270-syllabus.pdf').buffer(true);
    const upload = await agent.post('/api/upload-syllabus').attach('files', pdf.body, 'astr-1270-syllabus.pdf');
    assert.equal(upload.status, 200);
    assert.equal(upload.body.data.classes[0].short_name, 'ASTR 1270');
    assert.equal((await agent.post('/api/save-schedule').send(upload.body.data)).status, 200);
    assert.equal((await agent.get('/api/dashboard')).body.assignments.length, 15);
  });

  it('does not expose demo routes outside demo mode', async () => {
    const app = createApp({
      config: testConfig(),
      store: createMemoryStore(),
      auth: createMemoryAuth(),
      extractor: {},
      logger: silentLogger,
    });
    assert.equal((await request(app).post('/api/demo-login')).status, 404);
    assert.equal((await request(app).get('/demo/samples')).status, 404);
  });
});
