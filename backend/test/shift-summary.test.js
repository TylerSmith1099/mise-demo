// MIS-43 — Duty Manager shift summary + handover. Runs against a REAL Postgres
// with migrations 001–009 and the full Criterion demo dataset, then asserts the
// computed summary/handover against the loaded data (the issue's acceptance):
//
//   1. Opening summary shows staffing count, gaming labour 13.1% flagged (>12%),
//      the open RSA-refusal + EGM-malfunction incidents, and prior-shift notes.
//   2. The handover note pulls open compliance items + recommended actions.
//
// These exercise the data layer (buildShiftSummary / buildHandover) inside the
// caller's RLS context — the same functions the HTTP routes call.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { loadConfig } from '../src/config.js';
import { initDb, closeDb, withClientContext } from '../src/db.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedCriterionDemo } from '../scripts/seed-demo-criterion.js';
import {
  buildShiftSummary,
  buildHandover,
  GAMING_LABOUR_THRESHOLD_PCT,
} from '../src/shift-summary-api.js';

const ADMIN_USER = process.env.MISE_TEST_DB_ADMIN_USER || process.env.USER;
const DB_HOST = process.env.MISE_TEST_DB_HOST || 'localhost';
const TEST_DB = 'mise_shift_summary_test';
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

  // Minimal env so loadConfig succeeds (HS256 is the permitted minimum).
  process.env.JWT_ALGORITHM = 'HS256';
  process.env.JWT_SECRET = 'test-secret-shift-summary';
  process.env.SESSION_EXPIRY_HOURS = '8';
  process.env.SESSION_TIMEOUT_MINUTES = '30';
  process.env.DB_CONNECTION_STRING = testCs;

  initDb(loadConfig());
  ids = await seedCriterionDemo();
});

after(async () => {
  await closeDb();
});

test('opening summary: staffing, gaming labour 13.1% flagged, open incidents, prior notes', async () => {
  const summary = await withClientContext(ids.clientId, (q) =>
    buildShiftSummary(q, { venueId: ids.venueId }),
  );

  // Venue identity
  assert.equal(summary.venueName, 'The Criterion Hotel');
  assert.equal(summary.venueState, 'QLD');

  // Staffing: 5 on now (grace, liam, olivia, noah, dan); gaming floor 1 of 2 min.
  assert.equal(summary.staffing.onNow, 5);
  assert.equal(summary.staffing.gamingOnFloor, 1);
  assert.equal(summary.staffing.gamingMinAttendants, 2);
  assert.equal(summary.staffing.gamingUnderstaffed, true);

  // Gaming labour 13.1% > 12% threshold, flagged.
  assert.equal(summary.gamingLabour.pct, 13.1);
  assert.equal(summary.gamingLabour.thresholdPct, GAMING_LABOUR_THRESHOLD_PCT);
  assert.equal(summary.gamingLabour.flagged, true);
  assert.equal(summary.gamingLabour.weeklyLabourCost, 16450);
  // MIS-73: denominator MUST be net gaming revenue (RTV net ~$126k/wk), NEVER the
  // EGM meter (~$1.8M/wk, a 14x difference). Lock it so a meter regression — which
  // would silently drop the % to ~0.9% and hide the DM flag — breaks the build.
  assert.equal(summary.gamingLabour.netGamingRevenueWeekly, 126000);

  // Two open (unacknowledged) incidents: RSA refusal + EGM malfunction.
  // (The RG patron interaction is acknowledged, so it must NOT appear.)
  const types = summary.openCompliance.map((c) => c.eventType).sort();
  assert.deepEqual(types, ['egm_malfunction', 'rsa_refusal']);
  assert.ok(!types.includes('rg_patron_interaction'));
  assert.equal(summary.openCompliance.length, 2);

  // Prior-shift handover highlights present.
  assert.ok(summary.priorHandover);
  assert.ok(summary.priorHandover.highlights.length >= 1);
});

test('handover: open compliance items + recommended actions, structured', async () => {
  const h = await withClientContext(ids.clientId, (q) =>
    buildHandover(q, { venueId: ids.venueId }),
  );
  assert.equal(h.fromRole, 'Duty Manager (day)');
  assert.equal(h.toRole, 'Duty Manager (evening)');
  assert.equal(h.author, 'Mia Fraser');
  // Open items + recommended actions are split into structured lists.
  assert.ok(h.openComplianceItems.length >= 3);
  assert.ok(h.actionItems.length >= 4);
  assert.ok(h.staffingNotes && h.staffingNotes.length > 0);
  assert.ok(h.incidentsSummary && h.incidentsSummary.length > 0);
  // Recommended actions are real follow-ups, not empty bullets.
  assert.ok(h.actionItems.every((a) => a.length > 3));
});
