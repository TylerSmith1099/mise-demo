// Process entrypoint. Loads + validates config, opens the DB pool, starts the
// HTTP server. Boot fails loudly if any required secret/setting is missing.

import { loadConfig } from './config.js';
import { initDb, closeDb } from './db.js';
import { createApp } from './app.js';
import { startAdminSyncSchedulers, stopAdminSyncSchedulers } from './admin/sync-wiring.js';

const config = loadConfig();
initDb(config);

// Start revenue (15 min) and labour (60 min) sync schedulers after DB init.
// Errors are logged and non-fatal — server starts regardless.
startAdminSyncSchedulers(config).catch((err) =>
  console.error('[admin-sync] startup error:', err.message),
);

const app = createApp(config);

const server = app.listen(config.port, () => {
  // Log non-secret facts only — never the keys or connection string.
  console.log(
    `Mise auth listening on :${config.port} ` +
      `(alg=${config.jwt.algorithm}, expiry=${config.jwt.expirySeconds}s, ` +
      `idle=${config.session.inactivityTimeoutSeconds}s)`,
  );
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  stopAdminSyncSchedulers();
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
