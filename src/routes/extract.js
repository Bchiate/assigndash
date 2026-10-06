'use strict';

const express = require('express');
const { z } = require('zod');
const { HttpError, parseBody } = require('../http-errors');
const { readUploads } = require('../files');
const { isValidTimeZone } = require('../files/ics');
const { createUploadMiddleware } = require('../middleware/upload');

function secondsUntilUtcMidnight(now = new Date()) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((midnight - now.getTime()) / 1000);
}

module.exports = function extractRoutes({ config, store, extractor, sessions, limiters, logger }) {
  const router = express.Router();
  const { limits } = config;
  const upload = createUploadMiddleware(limits);

  const PasteBody = z.object({
    text: z
      .string()
      .trim()
      .min(20, 'Please paste more text: the input is too short.')
      .max(limits.maxPastedChars, `Pasted text can be at most ${limits.maxPastedChars.toLocaleString('en-US')} characters.`),
  });

  // Called after the files have been read locally (which is free) and before the paid AI call.
  async function consumeQuota(userId) {
    const result = await store.consumeExtractionQuota(userId, {
      perUser: limits.dailyExtractionsPerUser,
      global: limits.dailyExtractionsGlobal,
    });
    const retryAfter = { 'Retry-After': String(secondsUntilUtcMidnight()) };
    if (result === 'user_limit') {
      throw new HttpError(
        429,
        `You've used today's ${limits.dailyExtractionsPerUser} document extractions. The limit resets at midnight UTC.`,
        { code: 'daily_limit', headers: retryAfter },
      );
    }
    if (result === 'global_limit') {
      throw new HttpError(503, 'AssignDash has reached its daily processing budget. Please try again tomorrow.', {
        code: 'global_limit',
        headers: retryAfter,
      });
    }
  }

  router.post('/upload-syllabus', sessions.requireAuth, limiters.extraction, upload, async (req, res) => {
    const files = req.files ?? [];
    if (files.length === 0) throw new HttpError(400, 'No files were uploaded.');

    const timeZone = isValidTimeZone(req.body?.timezone) ? req.body.timezone : undefined;
    const { documents, errors } = await readUploads(files, { timeZone, logger });
    if (documents.length === 0) throw new HttpError(400, errors.join('\n'));

    await consumeQuota(req.userId);
    const { data, warnings } = await extractor.extract({ documents });
    res.json({ ok: true, data, warnings: [...errors, ...warnings] });
  });

  router.post('/parse-text', sessions.requireAuth, limiters.extraction, async (req, res) => {
    const { text } = parseBody(PasteBody, req.body);
    await consumeQuota(req.userId);
    const { data, warnings } = await extractor.extract({ documents: [{ name: 'Pasted text', kind: 'paste', text }] });
    res.json({ ok: true, data, warnings });
  });

  return router;
};
