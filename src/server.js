'use strict';

const { loadConfig, ConfigError } = require('./config');
const { createApp } = require('./app');

function loadDotEnv() {
  try {
    process.loadEnvFile();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/** Real services in full mode; in-memory store, accounts and sample extraction in demo mode. */
async function createDependencies(config) {
  if (config.demo) {
    const { createMemoryStore } = require('./store/memory-store');
    const { createMemoryAuth } = require('./auth/memory-auth');
    const { createDemoExtractor } = require('./extraction/demo');
    const { buildDemoSamples } = require('./demo/samples');

    const store = createMemoryStore({ maxAssignments: 20_000 });
    const auth = createMemoryAuth({ maxUsers: 200, onEvict: (userId) => store.deleteUserData(userId) });
    const samples = await buildDemoSamples();
    return { store, auth, samples, extractor: createDemoExtractor({ samples, delayMs: 600 }) };
  }

  const { createSupabaseStore } = require('./store/supabase-store');
  const { createSupabaseAuth } = require('./auth/supabase-auth');
  const { createOpenAIExtractor } = require('./extraction/openai');
  return {
    store: createSupabaseStore(config.supabase),
    auth: createSupabaseAuth({ ...config.supabase, appUrl: config.appUrl }),
    extractor: createOpenAIExtractor(config.openai),
  };
}

async function main() {
  loadDotEnv();
  let config;
  try {
    config = loadConfig(process.env, { demo: process.argv.includes('--demo') });
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const app = createApp({ config, ...(await createDependencies(config)) });
  const server = app.listen(config.port, () => {
    const mode = config.demo ? ' in demo mode (in-memory data, sample extraction)' : '';
    console.log(`AssignDash running${mode} at http://localhost:${config.port}`);
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createDependencies };
