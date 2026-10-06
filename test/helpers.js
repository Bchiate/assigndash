'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memory-store');
const { createMemoryAuth } = require('../src/auth/memory-auth');

const FIXTURES = path.join(__dirname, 'fixtures');
const TEST_SECRET = 'test-only-secret-9f8e7d6c5b4a3210-abcdefghij';
const silentLogger = { error() {}, warn() {}, log() {} };

function testConfig(overrides = {}) {
  return {
    demo: false,
    isProduction: false,
    port: 0,
    appUrl: null,
    trustProxy: false,
    jwtSecret: TEST_SECRET,
    supabase: {},
    openai: {},
    ...overrides,
    limits: {
      dailyExtractionsPerUser: 20,
      dailyExtractionsGlobal: 1000,
      maxFileBytes: 2 * 1024 * 1024,
      maxFilesPerRequest: 5,
      maxPastedChars: 60_000,
      ...overrides.limits,
    },
  };
}

const SCHEDULE = {
  semester_name: 'Fall 2026',
  semester_start: '2026-08-31',
  semester_end: '2026-12-18',
  classes: [
    {
      name: 'Introduction to Planetary Science',
      short_name: 'ASTR 1270',
      assignments: [
        { title: 'Problem Set 1', date: '2026-09-11', end_date: null, due_time: '23:59', type: 'due' },
        { title: 'Midterm Exam', date: '2026-10-21', end_date: null, due_time: '10:00', type: 'exam' },
      ],
    },
  ],
};

/** Records what it was asked to extract and returns a fixed, valid result. */
function fakeExtractor(result = SCHEDULE) {
  const calls = [];
  return {
    calls,
    async extract(input) {
      calls.push(input);
      return { data: structuredClone(result), warnings: [] };
    },
  };
}

function buildApp({
  config,
  store = createMemoryStore(),
  auth = createMemoryAuth(),
  extractor = fakeExtractor(),
  rateLimits = { auth: { limit: 1000 }, extraction: { limit: 1000 } },
} = {}) {
  const app = createApp({ config: testConfig(config), store, auth, extractor, rateLimits, logger: silentLogger });
  return { app, store, auth, extractor };
}

let counter = 0;

/** Registers a new user and returns a supertest agent that carries their session cookie. */
async function signUp(app, { name = 'Test Student', password = 'correct horse battery staple' } = {}) {
  counter += 1;
  const email = `student${counter}@example.com`;
  const agent = request.agent(app);
  const res = await agent.post('/api/register').send({ name, email, password });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return agent;
}

module.exports = { FIXTURES, TEST_SECRET, SCHEDULE, silentLogger, testConfig, fakeExtractor, buildApp, signUp };
