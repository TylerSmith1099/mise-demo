// Database access with mandatory per-transaction client isolation.
//
// The Database stage (migration 005) keys RLS off `app.current_client_id` and
// requires it to be set per-transaction with the LOCAL flag so it cannot bleed
// across a pooled connection. This module is the ONLY sanctioned way the app
// touches the DB, so that contract is impossible to forget:
//
//   withClientContext(clientId, async (q) => { ... })
//
// wraps the work in a transaction that:
//   1. BEGIN
//   2. SET LOCAL ROLE <appRole>          -- least-privilege, FORCE-RLS subject
//   3. set_config('app.current_client_id', $clientId, /*is_local*/ true)
//   4. runs the callback
//   5. COMMIT (or ROLLBACK on throw)
//
// The clientId is supplied by the caller from a SERVER-VERIFIED source (the JWT
// after validation, or — at login only — the claimed client being authenticated
// against). It is bound as a parameter to set_config(), never string-interpolated.

import pg from 'pg';

let pool = null;
let appRole = 'mise_app';

export function initDb(config) {
  if (pool) return pool;
  // Managed Postgres over the public network (e.g. Render external host) needs
  // TLS, but presents a cert that won't chain to the system CAs — so verify is
  // off. Same-region INTERNAL connections (no public domain) and local Postgres
  // stay plaintext. Opt in via DB_SSL=require or a *.render.com host.
  const cs = config.db.connectionString;
  const needsSsl =
    process.env.DB_SSL === 'require' || /[@.][^/@]*\.render\.com/.test(cs || '');
  pool = new pg.Pool({
    connectionString: cs,
    max: 10,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  appRole = config.db.appRole;
  return pool;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

function assertInitialised() {
  if (!pool) throw new Error('db not initialised — call initDb(config) first');
}

// A thin query helper handed to the callback so it can only run statements
// inside the already-scoped transaction.
function makeQ(client) {
  return (text, params) => client.query(text, params);
}

/**
 * Run `fn` inside a transaction scoped to exactly one client via RLS.
 * @param {string} clientId UUID from a verified source (token or login claim).
 */
export async function withClientContext(clientId, fn) {
  assertInitialised();
  if (!clientId) {
    // Fail closed: never run client-scoped work without a client id. (RLS would
    // also return zero rows, but refusing here makes the bug loud, not silent.)
    throw new Error('withClientContext requires a clientId');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Role is a fixed identifier (validated config), safe to interpolate.
    await client.query(`SET LOCAL ROLE ${appRole}`);
    // is_local = true -> scoped to THIS transaction, auto-cleared on COMMIT/ROLLBACK.
    await client.query("SELECT set_config('app.current_client_id', $1, true)", [
      clientId,
    ]);
    const result = await fn(makeQ(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection may be broken; release will discard it */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` with NO tenant scoping, for the system-level security-audit table
 * (failed_logins) which is intentionally not under client RLS. Used only on the
 * pre-auth path where no verified client context exists yet.
 */
export async function withSystemContext(fn) {
  assertInitialised();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(makeQ(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}
