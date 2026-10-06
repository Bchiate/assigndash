'use strict';

/**
 * An error whose message is safe to show to the user, with the HTTP status to send and an
 * optional machine-readable code for the front end.
 */
class HttpError extends Error {
  constructor(status, message, { code, headers } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

/**
 * Validates a request body against a zod schema and returns the parsed (stripped, coerced)
 * value, or throws a 400 with the first problem in plain language.
 */
function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  // Schemas carry their own wording for user-facing rules; zod's generic messages
  // ("Invalid input: expected string...") are replaced with the offending field's path.
  const generic = /^(Invalid|Too big|Too small|Unrecognized)/.test(issue.message);
  throw new HttpError(400, generic ? `Invalid value for ${issue.path.join('.') || 'request body'}.` : issue.message);
}

function errorHandler(logger = console) {
  // Express recognises error handlers by their four-argument signature.
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) {
      if (err.headers) res.set(err.headers);
      return res.status(err.status).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });

    logger.error(`${req.method} ${req.originalUrl} failed:`, err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  };
}

module.exports = { HttpError, parseBody, errorHandler };
