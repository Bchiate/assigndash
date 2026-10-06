'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig, ConfigError } = require('../src/config');

const STRONG_SECRET = 'r7Kq2vX9pL4mN8sT1wY6zB3cD5fG0hJ2';
const FULL_ENV = {
  SUPABASE_URL: 'https://project-ref.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  OPENAI_API_KEY: 'openai-key',
  JWT_SECRET: STRONG_SECRET,
};

function problemsFor(env) {
  try {
    loadConfig(env);
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    return err.problems.join('\n');
  }
  return '';
}

describe('loadConfig', () => {
  it('accepts a complete environment', () => {
    const config = loadConfig({ ...FULL_ENV, PORT: '4000', DAILY_EXTRACTION_LIMIT: '5' });
    assert.equal(config.demo, false);
    assert.equal(config.port, 4000);
    assert.equal(config.limits.dailyExtractionsPerUser, 5);
    assert.equal(config.openai.model, 'gpt-4.1');
    assert.equal(config.trustProxy, false);
  });

  it('requires JWT_SECRET instead of silently generating one', () => {
    const { JWT_SECRET, ...env } = FULL_ENV;
    assert.ok(JWT_SECRET);
    assert.match(problemsFor(env), /JWT_SECRET is required/);
  });

  it('rejects weak secrets', () => {
    for (const weak of ['short', 'change-this-to-a-random-string', 'a'.repeat(40), 'abababababababababababababababababab']) {
      assert.match(problemsFor({ ...FULL_ENV, JWT_SECRET: weak }), /JWT_SECRET is too weak/, weak);
    }
  });

  it('lists every missing service variable at once', () => {
    const problems = problemsFor({ JWT_SECRET: STRONG_SECRET });
    for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY']) {
      assert.match(problems, new RegExp(`${name} is required`));
    }
  });

  it('rejects malformed values', () => {
    assert.match(problemsFor({ ...FULL_ENV, SUPABASE_URL: 'not a url' }), /SUPABASE_URL must be a URL/);
    assert.match(problemsFor({ ...FULL_ENV, DAILY_EXTRACTION_LIMIT: '0' }), /DAILY_EXTRACTION_LIMIT must be a positive integer/);
    assert.match(problemsFor({ ...FULL_ENV, TRUST_PROXY: 'maybe' }), /TRUST_PROXY/);
  });

  it('trusts one proxy hop on Render and marks it as production', () => {
    const config = loadConfig({ ...FULL_ENV, RENDER: 'true' });
    assert.equal(config.trustProxy, 1);
    assert.equal(config.isProduction, true);
  });

  it('needs no services or secret in demo mode', () => {
    const config = loadConfig({}, { demo: true });
    assert.equal(config.demo, true);
    assert.ok(config.jwtSecret.length >= 32);
    assert.equal(loadConfig({ DEMO: '1' }).demo, true);
  });

  it('still validates an explicitly provided secret in demo mode', () => {
    assert.match(problemsFor({ DEMO: 'true', JWT_SECRET: 'short' }), /JWT_SECRET is too weak/);
  });
});

describe('server startup', () => {
  it('exits with an error instead of starting without required configuration', () => {
    const server = path.join(__dirname, '..', 'src', 'server.js');
    // Run from a directory without a .env file so a developer's local settings can't satisfy the check.
    const result = spawnSync(process.execPath, [server], {
      cwd: path.join(__dirname, 'fixtures'),
      env: { PATH: process.env.PATH, PORT: '0' },
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /JWT_SECRET is required/);
    assert.match(result.stderr, /OPENAI_API_KEY is required/);
  });
});
