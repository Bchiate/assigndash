'use strict';

const crypto = require('node:crypto');

const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER_SECRETS = new Set([
  'change-this-to-a-random-string',
  'change-me',
  'changeme',
  'secret',
  'your-secret-here',
]);

class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function readPositiveInt(env, name, fallback, problems) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    problems.push(`${name} must be a positive integer (got "${raw}").`);
    return fallback;
  }
  return value;
}

// Render (and most PaaS) terminate TLS at a single proxy hop. Trusting X-Forwarded-For
// anywhere else would let clients spoof their IP and dodge the auth rate limiter.
function readTrustProxy(env, problems) {
  const raw = env.TRUST_PROXY;
  if (raw === undefined || raw === '') return env.RENDER ? 1 : false;
  if (['false', '0'].includes(raw)) return false;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops > 0) return hops;
  problems.push(`TRUST_PROXY must be a number of proxy hops or "false" (got "${raw}").`);
  return false;
}

function checkSecret(secret) {
  if (!secret) return `JWT_SECRET is required (at least ${MIN_SECRET_LENGTH} random characters).`;
  if (secret.length < MIN_SECRET_LENGTH || PLACEHOLDER_SECRETS.has(secret.toLowerCase()) || new Set(secret).size < 10) {
    return `JWT_SECRET is too weak: use at least ${MIN_SECRET_LENGTH} random characters, e.g. the output of \`openssl rand -base64 32\`.`;
  }
  return null;
}

/**
 * Reads and validates configuration once at startup. Any problem is reported together and
 * stops the process, instead of failing later on the first request that needs the value.
 */
function loadConfig(env = process.env, { demo = false } = {}) {
  const problems = [];
  const isDemo = demo || isTruthy(env.DEMO);
  const isProduction = env.NODE_ENV === 'production' || Boolean(env.RENDER);

  let jwtSecret = env.JWT_SECRET || '';
  if (isDemo && !jwtSecret) {
    // Demo mode keeps every account in memory, so a per-process secret loses nothing on restart.
    jwtSecret = crypto.randomBytes(32).toString('base64url');
  } else {
    const problem = checkSecret(jwtSecret);
    if (problem) problems.push(problem);
  }

  if (!isDemo) {
    for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY']) {
      if (!env[name]) problems.push(`${name} is required (or start in demo mode with \`npm run demo\`).`);
    }
    if (env.SUPABASE_URL && !isHttpUrl(env.SUPABASE_URL)) {
      problems.push('SUPABASE_URL must be a URL like https://<project-ref>.supabase.co');
    }
  }

  const appUrl = env.APP_URL ? env.APP_URL.replace(/\/+$/, '') : null;
  if (appUrl && !isHttpUrl(appUrl)) problems.push('APP_URL must be an http(s) URL.');

  const config = {
    demo: isDemo,
    isProduction,
    port: readPositiveInt(env, 'PORT', 3000, problems),
    appUrl,
    trustProxy: readTrustProxy(env, problems),
    jwtSecret,
    supabase: {
      url: env.SUPABASE_URL || null,
      anonKey: env.SUPABASE_ANON_KEY || null,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || null,
    },
    openai: {
      apiKey: env.OPENAI_API_KEY || null,
      model: env.OPENAI_MODEL || 'gpt-4.1',
    },
    limits: {
      dailyExtractionsPerUser: readPositiveInt(env, 'DAILY_EXTRACTION_LIMIT', 20, problems),
      dailyExtractionsGlobal: readPositiveInt(env, 'GLOBAL_DAILY_EXTRACTION_LIMIT', 300, problems),
      maxFileBytes: 10 * 1024 * 1024,
      maxFilesPerRequest: 5,
      maxPastedChars: 60_000,
    },
  };

  if (problems.length) throw new ConfigError(problems);
  return config;
}

module.exports = { loadConfig, ConfigError, MIN_SECRET_LENGTH };
