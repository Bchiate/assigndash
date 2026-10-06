'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createMemoryAuth } = require('../src/auth/memory-auth');
const { COOKIE_NAME } = require('../src/auth/session');
const { buildApp, signUp, TEST_SECRET } = require('./helpers');

const PASSWORD = 'correct horse battery staple';

function sessionCookie(res) {
  return (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${COOKIE_NAME}=`));
}

function tokenFor(userId, { secret = TEST_SECRET, ...options } = {}) {
  return jwt.sign({}, secret, { subject: userId, issuer: 'assigndash', audience: 'assigndash-web', expiresIn: 60, ...options });
}

describe('sign-up and login', () => {
  it('signs up, sets an httpOnly SameSite=Lax session cookie and returns the user', async () => {
    const { app } = buildApp();
    const agent = request.agent(app);
    const res = await agent.post('/api/register').send({ name: 'Ada', email: 'Ada@Example.com ', password: PASSWORD });
    assert.equal(res.status, 201);
    const cookie = sessionCookie(res);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Secure/, 'plain-HTTP development should not set Secure');

    const me = await agent.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.name, 'Ada');
    assert.equal(me.body.email, 'ada@example.com', 'emails are normalised');
  });

  it('marks the cookie Secure in production', async () => {
    const { app } = buildApp({ config: { isProduction: true } });
    const res = await request(app).post('/api/register').send({ name: 'Ada', email: 'ada@example.com', password: PASSWORD });
    assert.match(sessionCookie(res), /Secure/);
  });

  it('logs in with the right password only', async () => {
    const { app } = buildApp();
    await request(app).post('/api/register').send({ name: 'Ada', email: 'ada@example.com', password: PASSWORD });

    const wrong = await request(app).post('/api/login').send({ email: 'ada@example.com', password: 'not the password' });
    assert.equal(wrong.status, 401);
    assert.equal(sessionCookie(wrong), undefined);

    const unknown = await request(app).post('/api/login').send({ email: 'nobody@example.com', password: PASSWORD });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, wrong.body.error, 'unknown accounts look the same as wrong passwords');

    const right = await request(app).post('/api/login').send({ email: 'ADA@example.com', password: PASSWORD });
    assert.equal(right.status, 200);
    assert.ok(sessionCookie(right));
  });

  it('validates sign-up input', async () => {
    const { app } = buildApp();
    const short = await request(app).post('/api/register').send({ name: 'Ada', email: 'ada@example.com', password: 'short' });
    assert.equal(short.status, 400);
    assert.match(short.body.error, /at least 8/);
    const badEmail = await request(app).post('/api/register').send({ name: 'Ada', email: 'not-an-email', password: PASSWORD });
    assert.equal(badEmail.status, 400);
    const missingName = await request(app).post('/api/register').send({ email: 'ada@example.com', password: PASSWORD });
    assert.equal(missingName.status, 400);
  });

  it('rejects a second account for the same email when confirmation is off', async () => {
    const { app } = buildApp();
    await request(app).post('/api/register').send({ name: 'Ada', email: 'ada@example.com', password: PASSWORD });
    const again = await request(app).post('/api/register').send({ name: 'Ada', email: 'ada@example.com', password: PASSWORD });
    assert.equal(again.status, 409);
  });

  it('logout clears the cookie', async () => {
    const { app } = buildApp();
    const agent = await signUp(app);
    const res = await agent.post('/api/logout');
    assert.match(sessionCookie(res), /Expires=Thu, 01 Jan 1970/);
    assert.equal((await agent.get('/api/me')).status, 401);
  });
});

describe('email confirmation', () => {
  it('does not start a session until the email is confirmed', async () => {
    const auth = createMemoryAuth({ requireConfirmation: true });
    const { app } = buildApp({ auth });

    const signup = await request(app).post('/api/register').send({ name: 'Ada', email: 'ada@example.com', password: PASSWORD });
    assert.equal(signup.status, 202);
    assert.equal(signup.body.needsConfirmation, true);
    assert.equal(sessionCookie(signup), undefined);

    const early = await request(app).post('/api/login').send({ email: 'ada@example.com', password: PASSWORD });
    assert.equal(early.status, 403);
    assert.equal(early.body.code, 'email_not_confirmed');

    auth.confirmEmail('ada@example.com');
    const confirmed = await request(app).post('/api/login').send({ email: 'ada@example.com', password: PASSWORD });
    assert.equal(confirmed.status, 200);
  });

  it('answers sign-up and resend the same way for existing addresses', async () => {
    const { app } = buildApp({ auth: createMemoryAuth({ requireConfirmation: true }) });
    const first = await request(app).post('/api/register').send({ name: 'Ada', email: 'ada@example.com', password: PASSWORD });
    const second = await request(app).post('/api/register').send({ name: 'Eve', email: 'ada@example.com', password: PASSWORD });
    assert.equal(second.status, first.status);
    assert.deepEqual(second.body, first.body);

    const known = await request(app).post('/api/resend-confirmation').send({ email: 'ada@example.com' });
    const unknown = await request(app).post('/api/resend-confirmation').send({ email: 'nobody@example.com' });
    assert.deepEqual([known.status, known.body], [unknown.status, unknown.body]);
  });
});

describe('session tokens', () => {
  async function userIdOf(agent) {
    return (await agent.get('/api/me')).body.id;
  }

  it('rejects requests without a session', async () => {
    const { app } = buildApp();
    for (const [method, path] of [['get', '/api/me'], ['get', '/api/dashboard'], ['post', '/api/save-schedule'], ['post', '/api/upload-syllabus']]) {
      const res = await request(app)[method](path);
      assert.equal(res.status, 401, `${method.toUpperCase()} ${path}`);
    }
  });

  it('accepts a valid token and rejects forged, expired or tampered ones', async () => {
    const { app } = buildApp();
    const userId = await userIdOf(await signUp(app));
    const me = (token) => request(app).get('/api/me').set('Cookie', `${COOKIE_NAME}=${token}`);

    assert.equal((await me(tokenFor(userId))).status, 200);
    assert.equal((await me(tokenFor(userId, { secret: 'some-other-secret-that-is-long-enough!!' }))).status, 401);
    assert.equal((await me(tokenFor(userId, { expiresIn: -10 }))).status, 401);
    assert.equal((await me(tokenFor(userId, { audience: 'someone-else' }))).status, 401);

    const unsigned = jwt.sign({ sub: userId, iss: 'assigndash', aud: 'assigndash-web' }, null, { algorithm: 'none' });
    assert.equal((await me(unsigned)).status, 401, 'alg=none must be refused');

    const [header, , signature] = tokenFor(userId).split('.');
    const otherPayload = Buffer.from(JSON.stringify({ sub: 'someone-else', iss: 'assigndash', aud: 'assigndash-web' })).toString('base64url');
    assert.equal((await me(`${header}.${otherPayload}.${signature}`)).status, 401);
  });

  it('treats a token for a deleted account as signed out', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/me').set('Cookie', `${COOKIE_NAME}=${tokenFor('00000000-0000-0000-0000-000000000000')}`);
    assert.equal(res.status, 401);
  });
});

describe('page routes and headers', () => {
  it('redirects between the landing page and the dashboard based on the session', async () => {
    const { app } = buildApp();
    const anonymous = await request(app).get('/dashboard');
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.location, '/');

    const agent = await signUp(app);
    const landing = await agent.get('/');
    assert.equal(landing.status, 302);
    assert.equal(landing.headers.location, '/dashboard');
    assert.equal((await agent.get('/dashboard')).status, 200);
  });

  it('sends a restrictive Content-Security-Policy', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('refuses cross-site state-changing requests', async () => {
    const { app } = buildApp();
    const body = { email: 'ada@example.com', password: PASSWORD };
    const crossSite = await request(app).post('/api/login').set('Sec-Fetch-Site', 'cross-site').send(body);
    assert.equal(crossSite.status, 403);
    const foreignOrigin = await request(app).post('/api/login').set('Origin', 'https://attacker.example').send(body);
    assert.equal(foreignOrigin.status, 403);
    const sameOrigin = await request(app).post('/api/login').set('Sec-Fetch-Site', 'same-origin').send(body);
    assert.equal(sameOrigin.status, 401, 'same-origin requests reach the handler');
  });
});

describe('rate limiting', () => {
  it('limits repeated login attempts', async () => {
    const { app } = buildApp({ rateLimits: { auth: { limit: 3 }, extraction: { limit: 1000 } } });
    const attempt = () => request(app).post('/api/login').send({ email: 'ada@example.com', password: 'guess' });
    for (let i = 0; i < 3; i += 1) assert.equal((await attempt()).status, 401);
    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /Too many attempts/);
  });
});
