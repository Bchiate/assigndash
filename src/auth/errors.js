'use strict';

/**
 * Auth provider failures, normalised to a small set of codes:
 * invalid_credentials, email_not_confirmed, user_exists, weak_password, invalid_email,
 * signup_disabled, rate_limited, unavailable.
 */
class AuthError extends Error {
  constructor(code, detail = '') {
    super(detail || code);
    this.name = 'AuthError';
    this.code = code;
  }
}

module.exports = { AuthError };
