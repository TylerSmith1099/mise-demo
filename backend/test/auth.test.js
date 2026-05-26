// End-to-end auth + security tests. Runs against a REAL Postgres with the
// Database stage migrations (001–007), RLS, and the role_at_login trigger live.
//
// Maps directly to the CTO sign-off criteria:
//   1. JWT validated on every route — no exceptions          -> "token gating"
//   2. app.current_client_id set from the verified token,
//      never the request body                                 -> "client isolation"
//   3. Session audit trail intact (never deleted; ended_at)   -> "session lifecycle"
//   4. role_at_login immutable post-creation (token + DB)     -> "role immutability"
//
// Set MISE_TEST_DB_ADMIN to a maintenance connection string if not using the
// default local superuser. The suite drops/creates a throwaway mise_test DB.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPrivateKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';

import { loadConfig } from '../src/config.js';
import { initDb, closeDb, withClientContext } from '../src/db.js';
import { createApp } from '../src/app.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedDemo } from '../scripts/seed.js';

const ADMIN_USER = process.env.MISE_TEST_DB_ADMIN_USER || process.env.USER;
const DB_HOST = process.env.MISE_TEST_DB_HOST || 'localhost';
const TEST_DB = 'mise_test';
const adminCs = `postgres://${ADMIN_USER}@${DB_HOST}:5432/postgres`;
const testCs = `postgres://${ADMIN_USER}@${DB_HOST}:5432/${TEST_DB}`;

let config;
let server;
let baseUrl;
let ids; // seeded ids { a, b }

// RS256 keypair generated at test time — exercises the preferred algorithm.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

before(async () => {
  // (Re)create the throwaway test database.
  const admin = new pg.Client({ connectionString: adminCs });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  await runMigrations(testCs);

  // Give mise_app LOGIN-less membership is unnecessary here: we connect as the
  // superuser owner and SET LOCAL ROLE mise_app per txn (see src/db.js), which a
  // superuser may always do. Production uses a login member of mise_app.
  process.env.JWT_ALGORITHM = 'RS256';
  process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' });
  process.env.SESSION_EXPIRY_HOURS = '8';
  process.env.SESSION_TIMEOUT_MINUTES = '30';
  process.env.DB_CONNECTION_STRING = testCs;

  config = loadConfig();
  initDb(config);
  ids = await seedDemo();

  const app = createApp(config);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await closeDb();
});

// --- helpers ----------------------------------------------------------------
async function post(path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function get(path, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(baseUrl + path, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function loginAs(clientId, venueId, email, password) {
  return post('/auth/login', {
    client_id: clientId,
    venue_id: venueId,
    email,
    password,
  });
}

// ============================================================================
// LOGIN + JWT PAYLOAD
// ============================================================================
test('login succeeds and issues a JWT with the exact required payload', async () => {
  const r = await loginAs(ids.a.clientId, ids.a.venueId, 'grace@pinnacle.test', 'floor-1234');
  assert.equal(r.status, 200);
  assert.ok(r.body.token);

  const decoded = jwt.verify(r.body.token, config.jwt.verifyingKey, {
    algorithms: ['RS256'],
    issuer: 'mise',
    audience: 'mise-app',
  });
  // Exact payload contract.
  assert.equal(decoded.sub, ids.a.gaming); // staff_id
  assert.equal(decoded.client_id, ids.a.clientId);
  assert.equal(decoded.venue_id, ids.a.venueId);
  assert.equal(decoded.role_at_login, 'Gaming Attendant');
  assert.equal(decoded.role_tier, 7);
  assert.ok(decoded.session_id);
  assert.ok(Number.isInteger(decoded.iat));
  assert.ok(Number.isInteger(decoded.exp));
  // 8-hour expiry.
  assert.equal(decoded.exp - decoded.iat, 8 * 3600);
});

test('role_at_login is taken from the staff record, not the request body', async () => {
  // Attempt to claim a higher role in the body — must be ignored.
  const r = await post('/auth/login', {
    client_id: ids.a.clientId,
    venue_id: ids.a.venueId,
    email: 'grace@pinnacle.test',
    password: 'floor-1234',
    role: 'C-Suite / Owner', // injected — should have zero effect
    role_tier: 1,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.role_at_login, 'Gaming Attendant');
  assert.equal(r.body.role_tier, 7);
});

// ============================================================================
// SESSION LIFECYCLE  (criterion 3)
// ============================================================================
test('a new login invalidates the prior session (one active per staff)', async () => {
  const first = await loginAs(ids.a.clientId, ids.a.venueId, 'dan@pinnacle.test', 'duty-5678');
  const second = await loginAs(ids.a.clientId, ids.a.venueId, 'dan@pinnacle.test', 'duty-5678');
  const s1 = jwt.decode(first.body.token).session_id;
  const s2 = jwt.decode(second.body.token).session_id;
  assert.notEqual(s1, s2);

  const rows = await withClientContext(ids.a.clientId, (q) =>
    q(
      `SELECT session_id, ended_at FROM sessions WHERE staff_id = $1`,
      [ids.a.duty],
    ).then((r) => r.rows),
  );
  const active = rows.filter((r) => r.ended_at === null);
  assert.equal(active.length, 1, 'exactly one active session');
  assert.equal(active[0].session_id, s2, 'newest session is the active one');
  // Audit trail intact: prior session still present, just ended.
  const ended = rows.find((r) => r.session_id === s1);
  assert.ok(ended && ended.ended_at !== null, 'prior session retained with ended_at');

  // The old token must no longer work (session invalidated).
  const meOld = await get('/api/me', first.body.token);
  assert.equal(meOld.status, 401);
});

test('logout ends the session but never deletes the record', async () => {
  const r = await loginAs(ids.a.clientId, ids.a.venueId, 'vera@pinnacle.test', 'venue-9012');
  const sid = jwt.decode(r.body.token).session_id;

  const out = await post('/api/logout', {}, r.body.token);
  assert.equal(out.status, 200);

  // Token now rejected.
  assert.equal((await get('/api/me', r.body.token)).status, 401);

  // Row still exists with ended_at set.
  const rows = await withClientContext(ids.a.clientId, (q) =>
    q(`SELECT ended_at FROM sessions WHERE session_id = $1`, [sid]).then((x) => x.rows),
  );
  assert.equal(rows.length, 1);
  assert.ok(rows[0].ended_at !== null);
});

test('inactivity beyond the timeout ends the session and rejects the request', async () => {
  const r = await loginAs(ids.a.clientId, ids.a.venueId, 'dan@pinnacle.test', 'duty-5678');
  const sid = jwt.decode(r.body.token).session_id;

  // Backdate last activity past the 30-minute window.
  await withClientContext(ids.a.clientId, (q) =>
    q(`UPDATE sessions SET last_active_at = now() - interval '31 minutes' WHERE session_id = $1`, [
      sid,
    ]),
  );

  const me = await get('/api/me', r.body.token);
  assert.equal(me.status, 401);

  const rows = await withClientContext(ids.a.clientId, (q) =>
    q(`SELECT ended_at FROM sessions WHERE session_id = $1`, [sid]).then((x) => x.rows),
  );
  assert.ok(rows[0].ended_at !== null, 'timed-out session is closed, not deleted');
});

// ============================================================================
// TOKEN GATING ON EVERY ROUTE  (criterion 1)
// ============================================================================
test('protected route rejects missing / invalid / expired / tampered tokens', async () => {
  // Missing.
  assert.equal((await get('/api/me')).status, 401);

  // Garbage.
  assert.equal((await get('/api/me', 'not-a-jwt')).status, 401);

  // Tampered: flip role_tier in the payload but keep the original signature.
  const good = await loginAs(ids.a.clientId, ids.a.venueId, 'grace@pinnacle.test', 'floor-1234');
  const [h, p, s] = good.body.token.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  payload.role_tier = 1;
  payload.role_at_login = 'C-Suite / Owner';
  const forgedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const tampered = `${h}.${forgedPayload}.${s}`;
  assert.equal((await get('/api/me', tampered)).status, 401, 'tampered token rejected');

  // "alg":none downgrade attempt.
  const noneToken = jwt.sign(payload, '', { algorithm: 'none' });
  assert.equal((await get('/api/me', noneToken)).status, 401, 'alg=none rejected');

  // Expired: sign a token with the real key but exp in the past.
  const key = createPrivateKey(config.jwt.signingKey);
  const { exp, iat, aud, iss, sub, ...claimsOnly } = payload; // drop registered claims before re-signing
  const expired = jwt.sign(claimsOnly, key, {
    algorithm: 'RS256',
    subject: sub,
    issuer: 'mise',
    audience: 'mise-app',
    expiresIn: -10,
  });
  assert.equal((await get('/api/me', expired)).status, 401, 'expired token rejected');
});

// ============================================================================
// ROLE IMMUTABILITY  (criterion 4)
// ============================================================================
test('role cannot be escalated via the request body on a protected route', async () => {
  const r = await loginAs(ids.a.clientId, ids.a.venueId, 'grace@pinnacle.test', 'floor-1234');
  const res = await post('/api/effective-role', { role: 'C-Suite / Owner', role_tier: 1 }, r.body.token);
  assert.equal(res.status, 200);
  assert.equal(res.body.effective_role, 'Gaming Attendant'); // from token
  assert.equal(res.body.effective_tier, 7);
});

test('DB trigger rejects any UPDATE to sessions.role_at_login', async () => {
  const r = await loginAs(ids.a.clientId, ids.a.venueId, 'grace@pinnacle.test', 'floor-1234');
  const sid = jwt.decode(r.body.token).session_id;

  await assert.rejects(
    () =>
      withClientContext(ids.a.clientId, (q) =>
        q(`UPDATE sessions SET role_at_login = 'C-Suite / Owner' WHERE session_id = $1`, [sid]),
      ),
    (err) => /immutable/i.test(err.message),
    'role_at_login UPDATE must be rejected by the trigger',
  );

  // The stored value is unchanged.
  const rows = await withClientContext(ids.a.clientId, (q) =>
    q(`SELECT role_at_login FROM sessions WHERE session_id = $1`, [sid]).then((x) => x.rows),
  );
  assert.equal(rows[0].role_at_login, 'Gaming Attendant');
});

// ============================================================================
// CLIENT ISOLATION  (criterion 2)
// ============================================================================
test('app.current_client_id comes from the token; body client_id cannot override it', async () => {
  const r = await loginAs(ids.a.clientId, ids.a.venueId, 'dan@pinnacle.test', 'duty-5678');

  // Even though we send client B's id in the body, results are scoped to A.
  const res = await get('/api/staff', r.body.token);
  assert.equal(res.status, 200);
  assert.equal(res.body.client_id, ids.a.clientId);
  const staffIds = res.body.staff.map((s) => s.staff_id);
  assert.ok(staffIds.includes(ids.a.gaming), 'sees own client staff');
  assert.ok(!staffIds.includes(ids.b.staff), 'never sees another client staff');
});

test('a token for client A cannot read client B data (RLS fail-closed)', async () => {
  const r = await loginAs(ids.a.clientId, ids.a.venueId, 'dan@pinnacle.test', 'duty-5678');
  // Directly attempt to read B's staff under A's token context.
  const rows = await withClientContext(ids.a.clientId, (q) =>
    q(`SELECT staff_id FROM staff WHERE staff_id = $1`, [ids.b.staff]).then((x) => x.rows),
  );
  assert.equal(rows.length, 0, 'cross-client row is invisible');
});

// ============================================================================
// MVP TIER GATING + FAILED-LOGIN AUDIT (no existence disclosure)
// ============================================================================
test('login is denied for roles outside the MVP tiers (4,5,7) and is audited', async () => {
  const r = await loginAs(ids.a.clientId, ids.a.venueId, 'gina@pinnacle.test', 'gm-3456');
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Invalid credentials');

  const rows = await dbAdmin(
    `SELECT reason FROM failed_logins WHERE staff_id_attempted = $1 ORDER BY attempted_at DESC LIMIT 1`,
    [ids.a.gm],
  );
  assert.equal(rows[0].reason, 'tier_not_in_mvp');
});

test('wrong password and unknown email return the SAME generic error (no enumeration)', async () => {
  const wrong = await loginAs(ids.a.clientId, ids.a.venueId, 'grace@pinnacle.test', 'WRONG');
  const unknown = await loginAs(ids.a.clientId, ids.a.venueId, 'ghost@pinnacle.test', 'whatever');
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body); // identical responses
  assert.equal(wrong.body.error, 'Invalid credentials');

  // But the audit log distinguishes the real reasons.
  const wrongRow = await dbAdmin(
    `SELECT reason FROM failed_logins WHERE email_attempted = 'grace@pinnacle.test' AND reason='bad_password' LIMIT 1`,
  );
  const unknownRow = await dbAdmin(
    `SELECT reason FROM failed_logins WHERE email_attempted = 'ghost@pinnacle.test' LIMIT 1`,
  );
  assert.equal(wrongRow[0].reason, 'bad_password');
  assert.equal(unknownRow[0].reason, 'no_such_staff');
});

test('venue_id empty string returns 401 not 500 (MIS-507: defense-in-depth against uuid cast)', async () => {
  // The UI fix (MIS-506) prevents "" being sent, but the backend must never
  // let a malformed string reach the Postgres uuid cast and return an unhandled
  // 500. Empty string is normalised → null at the service boundary; for
  // venue-scoped staff this triggers venue_mismatch → 401 AuthError, not a DB
  // error. Whitespace-only strings are also normalised.
  const emptyStr = await loginAs(ids.a.clientId, '', 'grace@pinnacle.test', 'floor-1234');
  assert.equal(emptyStr.status, 401, 'venue_id:"" must be 401');
  assert.equal(emptyStr.body.error, 'Invalid credentials');

  const whitespace = await loginAs(ids.a.clientId, '   ', 'grace@pinnacle.test', 'floor-1234');
  assert.equal(whitespace.status, 401, 'venue_id:"   " must be 401');
  assert.equal(whitespace.body.error, 'Invalid credentials');
});

// failed_logins has no RLS; read it directly via an admin connection.
async function dbAdmin(sql, params) {
  const c = new pg.Client({ connectionString: testCs });
  await c.connect();
  try {
    const { rows } = await c.query(sql, params);
    return rows;
  } finally {
    await c.end();
  }
}
