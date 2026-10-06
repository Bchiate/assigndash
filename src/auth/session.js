'use strict';

const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'assigndash_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ISSUER = 'assigndash';
const AUDIENCE = 'assigndash-web';

/**
 * Sessions are short JWTs (HS256, 7 days) in an httpOnly cookie. The token only carries the
 * user id; it is never readable from JavaScript, and SameSite=Lax keeps it off cross-site
 * POSTs. Logging out clears the cookie, but a copied token stays valid until it expires:
 * see "Known limitations" in the README.
 */
function createSessions({ secret, secure }) {
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };

  function issue(res, userId) {
    const token = jwt.sign({}, secret, {
      algorithm: 'HS256',
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: SESSION_TTL_SECONDS,
    });
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_TTL_SECONDS * 1000 });
  }

  function clear(res) {
    res.clearCookie(COOKIE_NAME, cookieOptions);
  }

  /** Returns the signed-in user's id, or null. */
  function read(req) {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return null;
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
      return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
    } catch {
      return null;
    }
  }

  function requireAuth(req, res, next) {
    const userId = read(req);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    req.userId = userId;
    next();
  }

  return { issue, clear, read, requireAuth };
}

module.exports = { createSessions, COOKIE_NAME, SESSION_TTL_SECONDS };
