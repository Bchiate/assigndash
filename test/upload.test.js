'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildApp, signUp, FIXTURES } = require('./helpers');

const fixture = (name) => path.join(FIXTURES, name);

describe('POST /api/upload-syllabus', () => {
  // Regression test: the original upload filter only allowed PDF, text and image MIME
  // types, so spreadsheets and calendar files were dropped before reaching the parser.
  for (const [name, kind, expected] of [
    ['stat-2380-schedule.csv', 'csv', /Homework 1 \| 11:59 PM/],
    ['stat-2380-schedule.xlsx', 'xlsx', /2026-09-08 \| Visualizing distributions/],
    ['writ-1190-calendar.ics', 'ics', /Calendar: WRIT 1190/],
    ['astr-1270-syllabus.pdf', 'pdf', /ASTR 1270/],
  ]) {
    it(`imports ${kind.toUpperCase()} files end to end`, async () => {
      const { app, extractor } = buildApp();
      const agent = await signUp(app);
      const res = await agent.post('/api/upload-syllabus').attach('files', fixture(name));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.ok, true);
      assert.ok(res.body.data.classes.length > 0);

      const [document] = extractor.calls[0].documents;
      assert.equal(document.kind, kind);
      assert.match(document.text, expected);
    });
  }

  it('accepts CSV even when the browser labels it application/vnd.ms-excel', async () => {
    const { app, extractor } = buildApp();
    const agent = await signUp(app);
    const res = await agent
      .post('/api/upload-syllabus')
      .attach('files', fixture('stat-2380-schedule.csv'), { contentType: 'application/vnd.ms-excel' });
    assert.equal(res.status, 200);
    assert.equal(extractor.calls[0].documents[0].kind, 'csv');
  });

  it('passes the browser time zone to the calendar parser', async () => {
    const { app, extractor } = buildApp();
    const agent = await signUp(app);
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20261006T045900Z\r\nSUMMARY:Essay due\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const res = await agent
      .post('/api/upload-syllabus')
      .field('timezone', 'America/Chicago')
      .attach('files', Buffer.from(ics), 'canvas.ics');
    assert.equal(res.status, 200);
    assert.match(extractor.calls[0].documents[0].text, /2026-10-05 23:59 \| Essay due/);
  });

  it('rejects unsupported types with an explanation', async () => {
    const { app, extractor } = buildApp();
    const agent = await signUp(app);
    const docx = await agent.post('/api/upload-syllabus').attach('files', Buffer.from('PK\u0003\u0004'), 'syllabus.docx');
    assert.equal(docx.status, 415);
    assert.match(docx.body.error, /syllabus\.docx: unsupported file type/);
    const xls = await agent.post('/api/upload-syllabus').attach('files', Buffer.from('legacy'), 'grades.xls');
    assert.equal(xls.status, 415);
    assert.match(xls.body.error, /Save it as \.xlsx or \.csv/);
    assert.equal(extractor.calls.length, 0);
  });

  it('reports unreadable files without calling the model', async () => {
    const { app, extractor } = buildApp();
    const agent = await signUp(app);
    const res = await agent.post('/api/upload-syllabus').attach('files', Buffer.from('not really a pdf'), 'broken.pdf');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /broken\.pdf doesn't look like a valid PDF/);
    assert.equal(extractor.calls.length, 0);
  });

  it('returns readable files and warns about the rest', async () => {
    const { app, extractor } = buildApp();
    const agent = await signUp(app);
    const res = await agent
      .post('/api/upload-syllabus')
      .attach('files', fixture('stat-2380-schedule.csv'))
      .attach('files', Buffer.from('nope'), 'broken.pdf');
    assert.equal(res.status, 200);
    assert.equal(extractor.calls[0].documents.length, 1);
    assert.match(res.body.warnings[0], /broken\.pdf/);
  });

  it('enforces size and count limits', async () => {
    const { app } = buildApp({ config: { limits: { maxFileBytes: 1024, maxFilesPerRequest: 2 } } });
    const agent = await signUp(app);
    const big = await agent.post('/api/upload-syllabus').attach('files', Buffer.alloc(2048, 'a'), 'big.txt');
    assert.equal(big.status, 413);
    assert.match(big.body.error, /at most 1 KB each/);

    const many = agent.post('/api/upload-syllabus');
    for (let i = 0; i < 3; i += 1) many.attach('files', Buffer.from('Homework 1 is due on 2026-09-01.'), `notes${i}.txt`);
    const res = await many;
    assert.equal(res.status, 400);
    assert.match(res.body.error, /at most 2 files/);
  });

  it('requires at least one file', async () => {
    const { app } = buildApp();
    const agent = await signUp(app);
    const res = await agent.post('/api/upload-syllabus').field('timezone', 'UTC');
    assert.equal(res.status, 400);
  });
});

describe('POST /api/parse-text', () => {
  it('extracts from pasted text', async () => {
    const { app, extractor } = buildApp();
    const agent = await signUp(app);
    const text = 'ASTR 1270 Problem Set 1 due Friday, September 11 at 11:59 PM';
    const res = await agent.post('/api/parse-text').send({ text });
    assert.equal(res.status, 200);
    assert.deepEqual(extractor.calls[0].documents, [{ name: 'Pasted text', kind: 'paste', text }]);
  });

  it('rejects text that is too short or too long', async () => {
    const { app } = buildApp({ config: { limits: { maxPastedChars: 100 } } });
    const agent = await signUp(app);
    assert.equal((await agent.post('/api/parse-text').send({ text: 'too short' })).status, 400);
    const long = await agent.post('/api/parse-text').send({ text: 'x'.repeat(101) });
    assert.equal(long.status, 400);
    assert.match(long.body.error, /at most 100 characters/);
  });
});

describe('extraction quotas', () => {
  const text = 'ASTR 1270 Problem Set 1 due Friday, September 11 at 11:59 PM';

  it('stops a user after their daily limit and says when it resets', async () => {
    const { app, extractor } = buildApp({ config: { limits: { dailyExtractionsPerUser: 2 } } });
    const agent = await signUp(app);
    assert.equal((await agent.post('/api/parse-text').send({ text })).status, 200);
    assert.equal((await agent.post('/api/upload-syllabus').attach('files', fixture('stat-2380-schedule.csv'))).status, 200);

    const blocked = await agent.post('/api/parse-text').send({ text });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, 'daily_limit');
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    assert.equal(extractor.calls.length, 2, 'the model is not called once the limit is reached');

    const other = await signUp(app);
    assert.equal((await other.post('/api/parse-text').send({ text })).status, 200, 'limits are per user');
  });

  it('does not count uploads that fail before reaching the model', async () => {
    const { app } = buildApp({ config: { limits: { dailyExtractionsPerUser: 1 } } });
    const agent = await signUp(app);
    assert.equal((await agent.post('/api/upload-syllabus').attach('files', Buffer.from('nope'), 'broken.pdf')).status, 400);
    assert.equal((await agent.post('/api/parse-text').send({ text })).status, 200);
  });

  it('applies a global daily budget across all users', async () => {
    const { app } = buildApp({ config: { limits: { dailyExtractionsGlobal: 2 } } });
    for (let i = 0; i < 2; i += 1) {
      const agent = await signUp(app);
      assert.equal((await agent.post('/api/parse-text').send({ text })).status, 200);
    }
    const late = await signUp(app);
    const res = await late.post('/api/parse-text').send({ text });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'global_limit');
  });

  it('rate-limits bursts of extraction requests per user', async () => {
    const { app } = buildApp({ rateLimits: { auth: { limit: 1000 }, extraction: { limit: 2 } } });
    const agent = await signUp(app);
    await agent.post('/api/parse-text').send({ text });
    await agent.post('/api/parse-text').send({ text });
    const res = await agent.post('/api/parse-text').send({ text });
    assert.equal(res.status, 429);
    assert.match(res.body.error, /too quickly/);
  });
});
