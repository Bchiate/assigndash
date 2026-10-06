'use strict';

const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const { createSessions } = require('./auth/session');
const { createLimiters } = require('./middleware/rate-limit');
const { requireSameOrigin } = require('./middleware/same-origin');
const { errorHandler } = require('./http-errors');
const authRoutes = require('./routes/auth');
const extractRoutes = require('./routes/extract');
const scheduleRoutes = require('./routes/schedule');
const assignmentRoutes = require('./routes/assignments');
const demoRoutes = require('./routes/demo');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Front-end libraries and the Inter font are served from node_modules, so pages load
// nothing from third-party origins and the Content-Security-Policy can stay at 'self'.
const VENDOR_FILES = {
  'jspdf.umd.min.js': require.resolve('jspdf/dist/jspdf.umd.min.js'),
  'jspdf.plugin.autotable.min.js': path.join(path.dirname(require.resolve('jspdf-autotable')), 'jspdf.plugin.autotable.min.js'),
};
const INTER_FONT_DIR = path.dirname(require.resolve('@fontsource-variable/inter/index.css'));

function securityHeaders(config) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        // The UI sets per-class colours through inline style attributes.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: config.isProduction ? { maxAge: 180 * 24 * 60 * 60 } : false,
  });
}

/**
 * Builds the Express app. Storage, authentication and extraction are passed in, so the
 * same app runs against Supabase + OpenAI in production and in-memory fakes in demo mode
 * and tests.
 */
function createApp({ config, store, auth, extractor, samples = null, rateLimits, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders(config));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const sessions = createSessions({ secret: config.jwtSecret, secure: config.isProduction });
  const limiters = createLimiters(rateLimits);
  const deps = { config, store, auth, extractor, samples, sessions, limiters, logger };

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use('/api', requireSameOrigin);
  app.get('/api/config', (req, res) => {
    res.json({
      demo: config.demo,
      maxFileMb: Math.round(config.limits.maxFileBytes / (1024 * 1024)),
      dailyExtractionLimit: config.limits.dailyExtractionsPerUser,
    });
  });
  app.use('/api', authRoutes(deps));
  app.use('/api', extractRoutes(deps));
  app.use('/api', scheduleRoutes(deps));
  app.use('/api', assignmentRoutes(deps));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  if (config.demo) app.use('/demo', demoRoutes(deps));

  app.get('/', (req, res) => {
    if (sessions.read(req)) return res.redirect('/dashboard');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
  app.get('/dashboard', (req, res) => {
    if (!sessions.read(req)) return res.redirect('/');
    res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
  });
  app.get('/vendor/:file', (req, res, next) => {
    const file = VENDOR_FILES[req.params.file];
    if (!file) return next();
    res.sendFile(file, { maxAge: '1d' });
  });
  app.use('/vendor/inter', express.static(INTER_FONT_DIR, { index: false, maxAge: '30d' }));
  app.use(express.static(PUBLIC_DIR, { index: false }));

  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
