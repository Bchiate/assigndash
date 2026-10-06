'use strict';

// Contract tests for the Supabase adapters: a fake fetch records the HTTP requests that
// supabase-js and the auth client make, so query shapes are checked without a live project.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createSupabaseStore } = require('../src/store/supabase-store');
const { createSupabaseAuth } = require('../src/auth/supabase-auth');
const { AuthError } = require('../src/auth/errors');

const URL_BASE = 'https://project-ref.supabase.co';

function fakeFetch(handler) {
  const requests = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : { ...init.headers };
    const request = { method: init.method ?? 'GET', url, headers, body: init.body ? JSON.parse(init.body) : undefined };
    requests.push(request);
    const { status = 200, body = null } = handler(request) ?? {};
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, requests };
}

const lower = (headers) => Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

describe('Supabase store', () => {
  it('loads the dashboard with a single nested query', async () => {
    const row = { id: 3, name: 'Fall 2026', start_date: '2026-08-31', end_date: '2026-12-18', classes: [] };
    const { fetch, requests } = fakeFetch(() => ({ body: [row] }));
    const store = createSupabaseStore({ url: URL_BASE, serviceRoleKey: 'service-key', fetch });

    assert.deepEqual(await store.getSemester('user-1'), row);
    assert.equal(requests.length, 1);
    const [{ url, headers }] = requests;
    assert.equal(url.pathname, '/rest/v1/semesters');
    assert.equal(url.searchParams.get('user_id'), 'eq.user-1');
    assert.match(url.searchParams.get('select'), /classes\(.*assignments\(.*due_time.*\)\)/);
    assert.equal(lower(headers).authorization, 'Bearer service-key');
  });

  it('saves and merges through the transactional SQL functions', async () => {
    const { fetch, requests } = fakeFetch(() => ({ body: 7 }));
    const store = createSupabaseStore({ url: URL_BASE, serviceRoleKey: 'service-key', fetch });
    const schedule = { semester_name: 'Fall 2026', classes: [] };

    assert.equal(await store.saveSchedule('user-1', schedule), 7);
    assert.equal(await store.mergeSchedule('user-1', schedule), 7);
    assert.deepEqual(
      requests.map((r) => [r.method, r.url.pathname, r.body]),
      [
        ['POST', '/rest/v1/rpc/save_schedule', { p_user_id: 'user-1', p_schedule: schedule }],
        ['POST', '/rest/v1/rpc/merge_schedule', { p_user_id: 'user-1', p_schedule: schedule }],
      ],
    );
  });

  it('resolves ownership by joining up to the semester', async () => {
    const { fetch, requests } = fakeFetch(({ url }) => {
      if (url.pathname.endsWith('/assignments')) return { body: [{ id: 9, classes: { semesters: { user_id: 'owner' } } }] };
      if (url.pathname.endsWith('/classes')) return { body: [{ id: 4, semesters: { user_id: 'owner' } }] };
      return { body: [] };
    });
    const store = createSupabaseStore({ url: URL_BASE, serviceRoleKey: 'service-key', fetch });

    assert.equal(await store.ownerOf('assignment', 9), 'owner');
    assert.equal(await store.ownerOf('class', 4), 'owner');
    assert.equal(await store.ownerOf('semester', 1), null);
    assert.equal(requests[0].url.searchParams.get('select'), 'id,classes!inner(semesters!inner(user_id))');
    assert.equal(requests[0].url.searchParams.get('id'), 'eq.9');
  });

  it('surfaces database errors', async () => {
    const { fetch } = fakeFetch(() => ({ status: 400, body: { message: 'boom', code: 'XX000' } }));
    const store = createSupabaseStore({ url: URL_BASE, serviceRoleKey: 'service-key', fetch });
    await assert.rejects(store.deleteAssignment(1), /Supabase: boom/);
  });
});

describe('Supabase auth', () => {
  const options = { url: URL_BASE, anonKey: 'anon-key', serviceRoleKey: 'service-key', appUrl: 'https://assigndash.example' };

  it('signs up with the anon key and asks for confirmation when no session comes back', async () => {
    const { fetch, requests } = fakeFetch(() => ({ body: { id: 'new-user', email: 'ada@example.com', confirmation_sent_at: 'now' } }));
    const auth = createSupabaseAuth({ ...options, fetch });

    const result = await auth.signUp({ email: 'ada@example.com', password: 'correct horse battery', name: 'Ada' });
    assert.deepEqual(result, { userId: null, name: 'Ada', needsConfirmation: true });

    const [{ method, url, headers, body }] = requests;
    assert.equal(method, 'POST');
    assert.equal(url.pathname, '/auth/v1/signup');
    assert.equal(url.searchParams.get('redirect_to'), 'https://assigndash.example/?confirmed=1');
    assert.equal(headers.apikey, 'anon-key');
    assert.deepEqual(body, { email: 'ada@example.com', password: 'correct horse battery', data: { name: 'Ada' } });
  });

  it('starts a session right away when the project does not require confirmation', async () => {
    const { fetch } = fakeFetch(() => ({ body: { access_token: 'x', user: { id: 'new-user' } } }));
    const auth = createSupabaseAuth({ ...options, fetch });
    const result = await auth.signUp({ email: 'ada@example.com', password: 'correct horse battery', name: 'Ada' });
    assert.deepEqual(result, { userId: 'new-user', name: 'Ada', needsConfirmation: false });
  });

  it('maps password-grant errors, including older error formats', async () => {
    const cases = [
      [{ code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }, 'email_not_confirmed'],
      [{ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 'invalid_credentials'],
      [{ error: 'invalid_grant', error_description: 'Email not confirmed' }, 'email_not_confirmed'],
      [{ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 'invalid_credentials'],
    ];
    for (const [body, code] of cases) {
      const { fetch, requests } = fakeFetch(() => ({ status: 400, body }));
      const auth = createSupabaseAuth({ ...options, fetch });
      await assert.rejects(auth.signIn({ email: 'ada@example.com', password: 'x' }), (err) => err instanceof AuthError && err.code === code);
      assert.equal(requests[0].url.pathname, '/auth/v1/token');
      assert.equal(requests[0].url.searchParams.get('grant_type'), 'password');
    }
  });

  it('looks users up with the service-role key', async () => {
    const { fetch, requests } = fakeFetch(({ url }) =>
      url.pathname.endsWith('/missing') ? { status: 404, body: {} } : { body: { id: 'u1', email: 'ada@example.com', user_metadata: { name: 'Ada' } } },
    );
    const auth = createSupabaseAuth({ ...options, fetch });
    assert.deepEqual(await auth.getUser('u1'), { id: 'u1', email: 'ada@example.com', name: 'Ada' });
    assert.equal(await auth.getUser('missing'), null);
    assert.equal(requests[0].url.pathname, '/auth/v1/admin/users/u1');
    assert.equal(requests[0].headers.apikey, 'service-key');
  });
});
