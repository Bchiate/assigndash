'use strict';

const { AuthError } = require('./errors');

function toAuthError(status, body) {
  const code = body.error_code || (typeof body.code === 'string' ? body.code : null) || body.error || '';
  const message = body.msg || body.message || body.error_description || '';

  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) return new AuthError('email_not_confirmed');
  if (code === 'invalid_credentials' || code === 'invalid_grant') return new AuthError('invalid_credentials');
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(message)) {
    return new AuthError('user_exists');
  }
  if (code === 'weak_password') return new AuthError('weak_password', message);
  if (code === 'email_address_invalid' || code === 'validation_failed') return new AuthError('invalid_email', message);
  if (code === 'signup_disabled' || code === 'email_provider_disabled') return new AuthError('signup_disabled');
  if (status === 429 || code.startsWith('over_')) return new AuthError('rate_limited');
  return new AuthError('unavailable', `Supabase Auth responded ${status}: ${code} ${message}`.trim());
}

/**
 * Supabase Auth (GoTrue) over its REST API, using the standard sign-up flow: if "Confirm
 * email" is enabled for the project, sign-up sends a confirmation link and login is refused
 * until it has been clicked. Public endpoints use the anon key; only the user lookup uses
 * the service-role key.
 */
function createSupabaseAuth({ url, anonKey, serviceRoleKey, appUrl = null, fetch = globalThis.fetch }) {
  const base = `${url.replace(/\/+$/, '')}/auth/v1`;
  const redirectTo = appUrl ? `${appUrl}/?confirmed=1` : null;

  async function call(path, { method = 'POST', body, key = anonKey, query = {} } = {}) {
    const target = new URL(base + path);
    for (const [name, value] of Object.entries(query)) if (value) target.searchParams.set(name, value);
    let res;
    try {
      res = await fetch(target, {
        method,
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new AuthError('unavailable', `Supabase Auth request failed: ${err.message}`);
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  return {
    async signUp({ email, password, name }) {
      const { ok, status, data } = await call('/signup', {
        body: { email, password, data: { name } },
        query: { redirect_to: redirectTo },
      });
      if (!ok) throw toAuthError(status, data);
      // With email confirmation on, Supabase returns only the user (and, for an address that
      // is already registered, an obfuscated one) so accounts can't be enumerated.
      if (!data.access_token) return { userId: null, name, needsConfirmation: true };
      return { userId: data.user.id, name, needsConfirmation: false };
    },

    async signIn({ email, password }) {
      const { ok, status, data } = await call('/token', {
        query: { grant_type: 'password' },
        body: { email, password },
      });
      if (!ok) throw toAuthError(status, data);
      return { userId: data.user.id, name: data.user.user_metadata?.name || email.split('@')[0] };
    },

    async getUser(userId) {
      const { ok, status, data } = await call(`/admin/users/${encodeURIComponent(userId)}`, {
        method: 'GET',
        key: serviceRoleKey,
      });
      if (status === 404) return null;
      if (!ok) throw toAuthError(status, data);
      return { id: data.id, email: data.email, name: data.user_metadata?.name || '' };
    },

    async resendConfirmation(email) {
      const { ok, status, data } = await call('/resend', {
        body: { type: 'signup', email },
        query: { redirect_to: redirectTo },
      });
      if (!ok) throw toAuthError(status, data);
    },
  };
}

module.exports = { createSupabaseAuth, toAuthError };
