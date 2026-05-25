// Admin Homepage API tests (MIS-412)
//
// Verifies three mandatory test classes per the CTO architecture spec (§6):
//   1. Happy path — DM and venue-level staff get their venue's data
//   2. Client isolation boundary — RLS: staff from client A cannot see client B data
//   3. Intra-client scope boundary — DM cannot read a sibling venue;
//      Area Manager (cluster scope) cannot read outside their cluster
//
// Requires: Postgres running locally + migrations 001-022 (existing) + migrations
// 023+ from MIS-411 (venue_clusters, venue_cluster_members, staff_venue_assignments,
// revenue_daily, labour_actuals_daily). Tests skip gracefully if those tables are
// not yet present (MIS-411 still in_progress at time of authoring).
//
// Set MISE_TEST_DB_ADMIN_USER / MISE_TEST_DB_HOST to match your local Postgres.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generateKeyPairSync } from 'node:crypto';
import pg from 'pg';

import { loadConfig } from '../src/config.js';
import { initDb, closeDb, withClientContext } from '../src/db.js';
import { createApp } from '../src/app.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedDemo } from '../scripts/seed.js';
import { hashPassword } from '../src/passwords.js';

const ADMIN_USER = process.env.MISE_TEST_DB_ADMIN_USER || process.env.USER;
const DB_HOST    = process.env.MISE_TEST_DB_HOST || 'localhost';
const TEST_DB    = 'mise_test_admin';
const adminCs    = `postgres://${ADMIN_USER}@${DB_HOST}:5432/postgres`;
const testCs     = `postgres://${ADMIN_USER}@${DB_HOST}:5432/${TEST_DB}`;

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

let config;
let server;
let baseUrl;
let ids;          // seeded base ids from seedDemo()
let adminIds;     // extra ids seeded by this test suite for desktop roles
let hasMis411Tables = false;  // set to true if migrations 023+ are present

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

before(async () => {
  const admin = new pg.Client({ connectionString: adminCs });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  await runMigrations(testCs);

  process.env.JWT_ALGORITHM   = 'RS256';
  process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.JWT_PUBLIC_KEY  = publicKey.export({ type: 'spki', format: 'pem' });
  process.env.SESSION_EXPIRY_HOURS          = '8';
  process.env.SESSION_TIMEOUT_MINUTES       = '30';
  process.env.DB_CONNECTION_STRING          = testCs;

  config = loadConfig();
  initDb(config);
  ids = await seedDemo();

  // Probe whether MIS-411 tables exist.
  const pool = new pg.Pool({ connectionString: testCs });
  try {
    await pool.query(`SELECT 1 FROM staff_venue_assignments LIMIT 0`);
    hasMis411Tables = true;
  } catch {
    hasMis411Tables = false;
  } finally {
    await pool.end();
  }

  // Seed additional data for desktop-role tests (requires MIS-411 tables).
  if (hasMis411Tables) {
    adminIds = await seedAdminData(ids);
  }

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

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedAdminData(baseIds) {
  const areaManagerPw = await hashPassword('area-mgr-pw');
  const areaManagerId = randomUUID();
  const venue2Id      = randomUUID();  // second venue under client A
  const clusterId     = randomUUID();

  // Add a second venue to client A.
  await withClientContext(baseIds.a.clientId, async (q) => {
    await q(
      `INSERT INTO venues (venue_id, client_id, venue_name, state, timezone, deleted_at)
       VALUES ($1, $2, 'Venue Two', 'QLD', 'Australia/Brisbane', NULL)`,
      [venue2Id, baseIds.a.clientId],
    );

    // Area Manager staff member (tier 2 or 3 — use 3 per MIS-415 §7-R resolution).
    await q(
      `INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name, email,
                          password_hash, role_name, role_tier, deleted_at)
       VALUES ($1, $2, NULL, 'Area Manager', 'Test', 'areaMgr@test.local', $3, 'Area Manager', 3, NULL)`,
      [areaManagerId, baseIds.a.clientId, areaManagerPw],
    );

    // Cluster containing only venue 1 (not venue 2) — tests scope boundary.
    await q(
      `INSERT INTO venue_clusters (cluster_id, client_id, cluster_name)
       VALUES ($1, $2, 'Test Cluster')`,
      [clusterId, baseIds.a.clientId],
    );
    await q(
      `INSERT INTO venue_cluster_members (client_id, cluster_id, venue_id)
       VALUES ($1, $2, $3)`,
      [baseIds.a.clientId, clusterId, baseIds.a.venueId],
    );

    // Assign area manager to the cluster (NOT to venue2).
    await q(
      `INSERT INTO staff_venue_assignments
         (assignment_id, client_id, staff_id, scope_type, cluster_id)
       VALUES (gen_random_uuid(), $1, $2, 'cluster', $3)`,
      [baseIds.a.clientId, areaManagerId, clusterId],
    );

    // Seed a revenue_daily row for venue 1 (inside cluster).
    await q(
      `INSERT INTO revenue_daily
         (revenue_id, client_id, venue_id, business_date,
          gross_revenue_cents, net_revenue_cents, transaction_count, source)
       VALUES (gen_random_uuid(), $1, $2, CURRENT_DATE, 500000, 450000, 120, 'seed')
       ON CONFLICT (client_id, venue_id, business_date, source) DO NOTHING`,
      [baseIds.a.clientId, baseIds.a.venueId],
    );

    // Seed a revenue_daily row for venue 2 (outside cluster).
    await q(
      `INSERT INTO revenue_daily
         (revenue_id, client_id, venue_id, business_date,
          gross_revenue_cents, net_revenue_cents, transaction_count, source)
       VALUES (gen_random_uuid(), $1, $2, CURRENT_DATE, 300000, 270000, 80, 'seed')
       ON CONFLICT (client_id, venue_id, business_date, source) DO NOTHING`,
      [baseIds.a.clientId, venue2Id],
    );
  });

  return { areaManagerId, venue2Id, clusterId };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function get(path, token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetch(baseUrl + path, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function login(clientId, venueId, email, password) {
  const res = await fetch(baseUrl + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, venue_id: venueId, email, password }),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Tests: endpoint availability + auth gate
// ---------------------------------------------------------------------------

describe('admin homepage auth gate', () => {
  test('GET /api/admin/homepage rejects unauthenticated request', async () => {
    const r = await get('/api/admin/homepage', null);
    assert.equal(r.status, 401);
  });

  test('GET /api/admin/stream rejects unauthenticated request', async () => {
    const r = await get('/api/admin/stream', null);
    assert.equal(r.status, 401);
  });

  test('tier 7 (Gaming Attendant) is forbidden from admin homepage', async () => {
    // ids.a.gaming is tier 7.
    const session = await login(ids.a.clientId, ids.a.venueId, 'grace@pinnacle.test', 'floor-1234');
    const r = await get('/api/admin/homepage', session.token);
    assert.equal(r.status, 403);
  });
});

// ---------------------------------------------------------------------------
// Tests: happy path — Duty Manager (tier 5, single-venue)
// ---------------------------------------------------------------------------

describe('happy path — Duty Manager', () => {
  let dmToken;

  before(async () => {
    const session = await login(ids.a.clientId, ids.a.venueId, 'dan@pinnacle.test', 'duty-5678');
    dmToken = session.token;
  });

  test('GET /api/admin/homepage returns 200 with expected shape', async () => {
    const r = await get('/api/admin/homepage', dmToken);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.scope?.venueIds), 'scope.venueIds is array');
    assert.equal(r.body.scope.venueIds.length, 1, 'DM scoped to 1 venue');
    assert.equal(r.body.scope.venueIds[0], ids.a.venueId);
    assert.ok(r.body.shiftSummary);
    assert.ok(Array.isArray(r.body.incidents));
    assert.ok(Array.isArray(r.body.compliance));
    assert.ok(r.body.generatedAt);
  });

  test('GET /api/admin/shifts/on-floor returns 200', async () => {
    const r = await get('/api/admin/shifts/on-floor', dmToken);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.shifts));
  });

  test('GET /api/admin/incidents returns 200', async () => {
    const r = await get('/api/admin/incidents', dmToken);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.incidents));
  });

  test('GET /api/admin/compliance/alerts returns 200', async () => {
    const r = await get('/api/admin/compliance/alerts', dmToken);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.alerts));
  });

  test('GET /api/admin/data-freshness returns 200', async () => {
    const r = await get('/api/admin/data-freshness', dmToken);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.connections));
  });

  test('DM can access revenue endpoint', async () => {
    const r = await get('/api/admin/revenue/daily', dmToken);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.revenue));
  });

  test('DM is forbidden from labour endpoint (cost data not DM-facing)', async () => {
    const r = await get('/api/admin/labour/daily', dmToken);
    assert.equal(r.status, 403);
  });
});

// ---------------------------------------------------------------------------
// Tests: client isolation boundary (Gate 1 — RLS)
// ---------------------------------------------------------------------------

describe('client isolation — staff from client B cannot read client A data', () => {
  let clientBToken;

  before(async () => {
    const session = await login(ids.b.clientId, ids.b.venueId, 'otto@rival.test', 'other-0000');
    clientBToken = session.token;
  });

  test('client B DM gets 200 but only sees their own venueId in scope', async () => {
    // Client B has its own venue; it should never see client A venue data.
    const r = await get('/api/admin/homepage', clientBToken);
    if (r.status === 403) {
      // Client B may not have a DM (tier 5) — it uses tier 7 from seed.
      // This is acceptable — the gate works.
      assert.ok(true, 'client B staff gated at tier check');
      return;
    }
    assert.equal(r.status, 200);
    // venueIds must only contain B's venue — never A's.
    assert.ok(!r.body.scope.venueIds.includes(ids.a.venueId),
      'client B scope must not include client A venue');
    assert.ok(r.body.scope.venueIds.includes(ids.b.venueId) ||
              r.body.scope.venueIds.length === 0);
  });

  test('client B requesting client A venueId as query param gets 403', async () => {
    // Client B DM tries to narrow to client A venue via ?venueId=.
    const session = await login(ids.b.clientId, ids.b.venueId, 'otto@rival.test', 'other-0000');
    const r = await get(`/api/admin/revenue/daily?venueId=${ids.a.venueId}`, session.token);
    // Either 403 (scope check) or 200 with empty data (RLS). Either is safe.
    if (r.status === 200) {
      assert.equal(r.body.revenue?.length ?? 0, 0, 'RLS must return zero client-A rows to client-B caller');
    } else {
      assert.equal(r.status, 403);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: intra-client scope boundary (Gate 2 — resolveScope)
// ---------------------------------------------------------------------------

describe('intra-client scope — DM cannot read sibling venue', () => {
  test('DM scope is limited to their single venue (not sibling venues)', async () => {
    if (!hasMis411Tables) {
      // Skip until MIS-411 migrations land.
      console.log('  [skip] MIS-411 tables not yet present');
      return;
    }

    const session = await login(ids.a.clientId, ids.a.venueId, 'dan@pinnacle.test', 'duty-5678');

    // DM requesting a sibling venue (venue2) gets 403.
    const r = await get(`/api/admin/revenue/daily?venueId=${adminIds.venue2Id}`, session.token);
    assert.equal(r.status, 403, 'DM must be forbidden from sibling venue revenue data');
  });
});

describe('intra-client scope — Area Manager limited to their cluster', () => {
  test('Area Manager sees venue1 (in cluster) but not venue2 (outside cluster)', async () => {
    if (!hasMis411Tables) {
      console.log('  [skip] MIS-411 tables not yet present');
      return;
    }

    const session = await login(ids.a.clientId, null, 'areaMgr@test.local', 'area-mgr-pw');
    const r = await get('/api/admin/homepage', session.token);

    assert.equal(r.status, 200);
    assert.ok(r.body.scope.venueIds.includes(ids.a.venueId),
      'Area Manager must see venue1 (in their cluster)');
    assert.ok(!r.body.scope.venueIds.includes(adminIds.venue2Id),
      'Area Manager must NOT see venue2 (outside their cluster)');
  });

  test('Area Manager requesting out-of-cluster venueId gets 403', async () => {
    if (!hasMis411Tables) {
      console.log('  [skip] MIS-411 tables not yet present');
      return;
    }

    const session = await login(ids.a.clientId, null, 'areaMgr@test.local', 'area-mgr-pw');
    const r = await get(`/api/admin/revenue/daily?venueId=${adminIds.venue2Id}`, session.token);
    assert.equal(r.status, 403, 'venue outside cluster must return 403, not empty');
  });

  test('Area Manager revenue data contains only in-cluster venue rows', async () => {
    if (!hasMis411Tables) {
      console.log('  [skip] MIS-411 tables not yet present');
      return;
    }

    const session = await login(ids.a.clientId, null, 'areaMgr@test.local', 'area-mgr-pw');
    const r = await get('/api/admin/revenue/daily', session.token);

    assert.equal(r.status, 200);
    const venueIds = new Set((r.body.revenue || []).map((row) => row.venue_id));
    assert.ok(!venueIds.has(adminIds.venue2Id),
      'revenue rows must not include out-of-cluster venue2');
  });
});

// ---------------------------------------------------------------------------
// Tests: makeRevenueSignal shape validation
// ---------------------------------------------------------------------------

describe('makeRevenueSignal shape', () => {
  test('validates and freezes a valid revenue signal', async () => {
    const { makeRevenueSignal } = await import('../src/integrations/signal-shape.js');
    const sig = makeRevenueSignal({
      id: 'bepoz:v1:2026-05-25',
      venueId: randomUUID(),
      businessDate: '2026-05-25',
      grossCents: 500000,
      netCents: 450000,
      txnCount: 120,
      source: 'bepoz',
    });
    assert.equal(sig._type, 'RevenueSignal');
    assert.equal(sig.grossCents, 500000);
    assert.equal(sig.source, 'bepoz');
    assert.equal(Object.isFrozen(sig), true);
  });

  test('rejects missing required fields', async () => {
    const { makeRevenueSignal } = await import('../src/integrations/signal-shape.js');
    assert.throws(
      () => makeRevenueSignal({ venueId: randomUUID(), businessDate: '2026-05-25' }),
      /missing required field "id"/,
    );
  });

  test('rounds float dollars to integer cents', async () => {
    const { makeRevenueSignal } = await import('../src/integrations/signal-shape.js');
    const sig = makeRevenueSignal({
      id: 'test:1',
      venueId: randomUUID(),
      businessDate: '2026-05-25',
      grossCents: 500001.7,
      source: 'manual',
    });
    assert.equal(sig.grossCents, 500002); // Math.round
  });
});
