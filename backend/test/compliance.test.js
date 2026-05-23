// Compliance Monitor tests — MIS-44 / Demo Scene 3.
//
// Runs against a REAL Postgres with migrations 001–009 and the seeded Pinnacle /
// Criterion demo dataset. Maps to the issue acceptance criteria:
//   1. Check 4 writes a Critical compliance_events row (the 10s timer just defers
//      this call; the call itself is what fires the alert).            -> "fires"
//   2. Severity is 'critical'.                                          -> "severity"
//   3. Acknowledgement persists acknowledged_at + acknowledged_by.      -> "ack persists"
//   4. Detail matches roster: tonight's gaming evening shift, 1 on floor,
//      minimum 2, 1 short.                                              -> "detail"
//   + Idempotent: a second activation reuses the open alert.            -> "idempotent"
//   + Isolation: the alert is scoped to the venue's client.            -> "isolation"
//
// Same throwaway-DB pattern as auth.test.js / rag.test.js.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { initDb, closeDb, withClientContext } from '../src/db.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedCriterionDemo } from '../scripts/seed-demo-criterion.js';
import { runUnderstaffingCheck, UNDERSTAFFING_EVENT_TYPE } from '../src/compliance-monitor.js';

const ADMIN_USER = process.env.MISE_TEST_DB_ADMIN_USER || process.env.USER;
const DB_HOST = process.env.MISE_TEST_DB_HOST || 'localhost';
const TEST_DB = 'mise_compliance_test';
const adminCs = `postgres://${ADMIN_USER}@${DB_HOST}:5432/postgres`;
const testCs = `postgres://${ADMIN_USER}@${DB_HOST}:5432/${TEST_DB}`;

let ids; // { clientId, venueId, staff }

before(async () => {
  const admin = new pg.Client({ connectionString: adminCs });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  await runMigrations(testCs);
  initDb({ db: { connectionString: testCs, appRole: 'mise_app' } });
  ids = await seedCriterionDemo();
});

after(async () => {
  await closeDb();
});

test('Check 4 fires a Critical gaming_understaffing alert', async () => {
  const alert = await runUnderstaffingCheck({ clientId: ids.clientId, venueId: ids.venueId });
  assert.ok(alert, 'expected an alert — the floor is 1 short');
  assert.equal(alert.event_type, UNDERSTAFFING_EVENT_TYPE);
  assert.equal(alert.severity, 'critical');
});

test('detail matches the roster (1 on floor, min 2, 1 short, Grace)', async () => {
  const alert = await runUnderstaffingCheck({ clientId: ids.clientId, venueId: ids.venueId });
  const d = alert.description;
  assert.match(d, /1 attendant on the floor/);
  assert.match(d, /minimum of 2/);
  assert.match(d, /1 short/);
  assert.match(d, /Grace Nguyen/);
});

test('idempotent: re-running reuses the open alert (no duplicate row)', async () => {
  await runUnderstaffingCheck({ clientId: ids.clientId, venueId: ids.venueId });
  await runUnderstaffingCheck({ clientId: ids.clientId, venueId: ids.venueId });
  const count = await withClientContext(ids.clientId, async (q) => {
    const { rows } = await q(
      `SELECT count(*)::int AS n FROM compliance_events
        WHERE venue_id = $1 AND event_type = $2
          AND acknowledged_at IS NULL AND deleted_at IS NULL`,
      [ids.venueId, UNDERSTAFFING_EVENT_TYPE],
    );
    return rows[0].n;
  });
  assert.equal(count, 1, 'exactly one open understaffing alert');
});

test('acknowledgement persists acknowledged_at + acknowledged_by', async () => {
  const alert = await runUnderstaffingCheck({ clientId: ids.clientId, venueId: ids.venueId });
  const dan = ids.staff.dan;
  const updated = await withClientContext(ids.clientId, async (q) => {
    const { rows } = await q(
      `UPDATE compliance_events
          SET acknowledged_at = now(), acknowledged_by = $2,
              description = description || E'\n\n— Acknowledged action: ' || $3
        WHERE event_id = $1 AND acknowledged_at IS NULL
        RETURNING acknowledged_at, acknowledged_by`,
      [alert.event_id, dan, 'Pulled a second attendant from beverage to cover gaming.'],
    );
    return rows[0];
  });
  assert.ok(updated.acknowledged_at, 'acknowledged_at set');
  assert.equal(updated.acknowledged_by, dan, 'acknowledged_by = the duty manager');
});

test('isolation: the alert belongs to the seeded client only', async () => {
  await runUnderstaffingCheck({ clientId: ids.clientId, venueId: ids.venueId });
  // A different client context sees zero of this venue's events (RLS).
  const otherClient = '00000000-0000-0000-0000-0000000000ff';
  const leaked = await withClientContext(otherClient, async (q) => {
    const { rows } = await q(
      `SELECT count(*)::int AS n FROM compliance_events WHERE venue_id = $1`,
      [ids.venueId],
    );
    return rows[0].n;
  });
  assert.equal(leaked, 0, 'no cross-client visibility of the alert');
});
