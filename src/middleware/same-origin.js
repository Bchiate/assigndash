'use strict';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defence in depth against cross-site request forgery, on top of the SameSite=Lax session
 * cookie: state-changing requests that a browser marks as coming from another site are
 * refused. Requests without these headers (curl, tests, older browsers) pass through.
 */
function requireSameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  }

  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  }
  next();
}

module.exports = { requireSameOrigin };
