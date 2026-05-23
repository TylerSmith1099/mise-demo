// Process entrypoint. Loads + validates config, opens the DB pool, starts the
// HTTP server. Boot fails loudly if any required secret/setting is missing.

import { loadConfig } from './config.js';
import { initDb, closeDb } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
initDb(config);
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
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
