'use strict';

const express = require('express');
const { z } = require('zod');
const { AuthError } = require('../auth/errors');
const { HttpError, parseBody } = require('../http-errors');

const Email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.'));

const RegisterBody = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(80, 'Names can be at most 80 characters.'),
  email: Email,
  password: z.string().min(8, 'Passwords must be at least 8 characters.').max(72, 'Passwords can be at most 72 characters.'),
});

const LoginBody = z.object({
  email: Email,
  password: z.string().min(1, 'Please enter your password.').max(200),
});

const ResendBody = z.object({ email: Email });

const AUTH_ERRORS = {
  invalid_credentials: [401, 'Invalid email or password.'],
  email_not_confirmed: [403, 'Please confirm your email address first: use the link we emailed you.'],
  user_exists: [409, 'That email is already registered. Try logging in instead.'],
  weak_password: [400, 'That password is too easy to guess. Please choose a stronger one.'],
  invalid_email: [400, 'Enter a valid email address.'],
  signup_disabled: [403, 'Sign-ups are currently closed.'],
  rate_limited: [429, 'Too many attempts. Please wait a few minutes and try again.'],
  unavailable: [503, 'The sign-in service is unavailable right now. Please try again shortly.'],
};

function toHttpError(err, logger) {
  if (!(err instanceof AuthError)) return err;
  if (err.code === 'unavailable') logger.error('Auth provider error:', err.message);
  const [status, message] = AUTH_ERRORS[err.code] ?? AUTH_ERRORS.unavailable;
  return new HttpError(status, message, { code: err.code });
}

async function callAuth(promise, logger) {
  try {
    return await promise;
  } catch (err) {
    throw toHttpError(err, logger);
  }
}

module.exports = function authRoutes({ config, auth, sessions, limiters, logger }) {
  const router = express.Router();

  router.post('/register', limiters.auth, async (req, res) => {
    const body = parseBody(RegisterBody, req.body);
    const result = await callAuth(auth.signUp(body), logger);
    if (result.needsConfirmation) {
      return res.status(202).json({ ok: true, needsConfirmation: true });
    }
    sessions.issue(res, result.userId);
    res.status(201).json({ ok: true, name: body.name });
  });

  router.post('/login', limiters.auth, async (req, res) => {
    const body = parseBody(LoginBody, req.body);
    const user = await callAuth(auth.signIn(body), logger);
    sessions.issue(res, user.userId);
    res.json({ ok: true, name: user.name });
  });

  // Always answers the same way, so it can't be used to find out which emails have accounts.
  router.post('/resend-confirmation', limiters.auth, async (req, res) => {
    const { email } = parseBody(ResendBody, req.body);
    try {
      await auth.resendConfirmation(email);
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
      if (err.code === 'unavailable') logger.error('Resend confirmation failed:', err.message);
    }
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    sessions.clear(res);
    res.json({ ok: true });
  });

  router.get('/me', sessions.requireAuth, async (req, res) => {
    const user = await callAuth(auth.getUser(req.userId), logger);
    if (!user) {
      sessions.clear(res);
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({ id: user.id, email: user.email, name: user.name });
  });

  if (config.demo) {
    router.post('/demo-login', limiters.auth, async (req, res) => {
      const user = await auth.createDemoUser();
      sessions.issue(res, user.userId);
      res.json({ ok: true, name: user.name });
    });
  }

  return router;
};
