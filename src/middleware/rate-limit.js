'use strict';

const { rateLimit } = require('express-rate-limit');

const DEFAULTS = {
  auth: { windowMs: 15 * 60 * 1000, limit: 20 }, // per IP: login, sign-up, resend
  extraction: { windowMs: 60 * 1000, limit: 10 }, // per user: AI extraction calls
};

function jsonHandler(message) {
  return (req, res, next, options) => res.status(options.statusCode).json({ error: message });
}

/**
 * Short-window limits that blunt bursts and password guessing. Counters live in process
 * memory, which is fine for a single instance; the daily extraction quota that protects
 * the OpenAI budget is stored in Postgres instead (see consume_extraction_quota).
 */
function createLimiters(overrides = {}) {
  const auth = { ...DEFAULTS.auth, ...overrides.auth };
  const extraction = { ...DEFAULTS.extraction, ...overrides.extraction };
  return {
    auth: rateLimit({
      ...auth,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: jsonHandler('Too many attempts. Please wait a few minutes and try again.'),
    }),
    extraction: rateLimit({
      ...extraction,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => req.userId, // runs after requireAuth
      handler: jsonHandler('You are sending files too quickly. Please wait a minute and try again.'),
    }),
  };
}

module.exports = { createLimiters };
