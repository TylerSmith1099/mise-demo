/**
 * Demo tenant seed — The Steward Hotel / Pinnacle Hotel Group (FICTIONAL).
 * MIS-185.
 *
 * Loads the demo client, venue, and all 29 staff from the mock workforce
 * adapter into Postgres under the client's RLS context (so the seed itself
 * honours the isolation contract — no row is written outside the client scope).
 *
 * Compliance / POS / gaming config are served live from the mock adapters via
 * src/api/routes/demo.js; they are read sources, not relational tables, so this
 * seed loads the relational records (client, venue, staff, logins) and prints a
 * summary of the mock datasets it is paired with.
 *
 * Idempotent-ish: re-running with a fresh DB is clean. The four demo logins
 * are deterministic emails so the demo accounts are always the same.
 *
 * Run:  node src/demo/seed.js        (from MISE/backend)
 */

import { randomUUID } from 'node:crypto';
import { initDb, withClientContext } from '../db.js';
import { hashPassword } from '../passwords.js';
import { loadConfig } from '../config.js';
import { STAFF } from '../integrations/mock/workforce.js';
import { getFullRegister } from '../integrations/mock/compliance.js';
import { getGamingMachines, getPosSummary } from '../integrations/mock/pos.js';

export const DEMO_PASSWORD = 'mise-demo-2026';

// Fixed, DOCUMENTED demo tenant ids (MIS-201). The login screen requires a
// Client ID + Venue ID, so the demo accounts are only usable if those ids are
// stable and known. Previously the seed minted random UUIDs every boot, which
// (a) left the login ids only in the deploy logs and (b) created a fresh orphan
// tenant on every redeploy. Pinning them makes the demo loginable with the
// credentials in DEPLOY.md and makes the seed idempotent across reboots.
// Overridable via env for any environment that needs different ids.
export const DEMO_CLIENT_ID = process.env.DEMO_CLIENT_ID || 'a0000000-0000-4000-8000-000000000001';
export const DEMO_VENUE_ID = process.env.DEMO_VENUE_ID || 'a0000000-0000-4000-8000-000000000002';

// The four demo accounts map onto specific seeded staff (by externalStaffId).
// groupgm@steward.demo is tier-2 (Group GM) — no Venue ID required at login;
// venue scope is resolved from staff_venue_assignments (group scope = all venues).
export const DEMO_ACCOUNTS = [
  { email: 'groupgm@steward.demo',     externalStaffId: 'STW-029', label: 'Group GM (Hannah Chiu)' },
  { email: 'gaming@steward.demo',      externalStaffId: 'STW-011', label: 'Gaming Attendant (Sarah Chen)' },
  { email: 'dutymanager@steward.demo', externalStaffId: 'STW-003', label: 'Duty Manager (James Kovacs)' },
  { email: 'manager@steward.demo',     externalStaffId: 'STW-001', label: 'Venue Manager (Rachel Drummond)' },
];

export async function seedStewardDemo() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const clientId = DEMO_CLIENT_ID;
  const venueId = DEMO_VENUE_ID;

  // externalStaffId -> { staffId, email } for wiring demo logins.
  const idMap = new Map();

  // Idempotent: if this demo tenant is already seeded, do nothing. This lets the
  // container boot with SEED_ON_BOOT=1 on a persistent DB without duplicate-key
  // errors or orphan tenants — the demo ids stay stable across redeploys.
  const already = await withClientContext(clientId, (q) =>
    q(`SELECT 1 FROM clients WHERE client_id = $1`, [clientId]).then((r) => r.rowCount > 0),
  );
  if (already) {
    return { clientId, venueId, staffCount: STAFF.length, idMap, skipped: true };
  }

  await withClientContext(clientId, async (q) => {
    await q(
      `INSERT INTO clients (client_id, client_name, white_label_name)
       VALUES ($1, $2, $3)`,
      [clientId, 'Pinnacle Hotel Group', 'Pinnacle Assist'],
    );
    await q(
      `INSERT INTO venues (venue_id, client_id, venue_name, state, timezone, venue_address)
       VALUES ($1, $2, $3, 'QLD', 'Australia/Brisbane', $4)`,
      [venueId, clientId, 'The Steward Hotel', '47 Caxton Street, Petrie Terrace QLD 4000'],
    );

    const demoEmailFor = (extId) =>
      DEMO_ACCOUNTS.find((a) => a.externalStaffId === extId)?.email;

    for (const p of STAFF) {
      const staffId = randomUUID();
      // Demo-login staff get the fixed demo email + password; everyone else gets
      // a deterministic internal email and the same hash (logins not exposed).
      const email = demoEmailFor(p.externalStaffId)
        || `${p.firstName}.${p.lastName}`.toLowerCase().replace(/[^a-z.]/g, '') + '@steward.demo';
      // Tier 1-3 (multi-venue desktop roles) have no home venue: their scope is
      // resolved from staff_venue_assignments after login (migration 032).
      const staffVenueId = p.roleTier <= 3 ? null : venueId;
      await q(
        `INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name,
                            email, role_tier, role_name, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [staffId, clientId, staffVenueId, p.firstName, p.lastName, email,
         p.roleTier, p.role, passwordHash],
      );
      idMap.set(p.externalStaffId, { staffId, email, role: p.role });
    }

    // Wire group-scope venue assignments for all tier 1-3 staff (MIS-409 / migration 023).
    // scope_type='group' grants access to every venue under the client.
    for (const p of STAFF.filter((m) => m.roleTier <= 3)) {
      const entry = idMap.get(p.externalStaffId);
      if (!entry) continue;
      await q(
        `INSERT INTO staff_venue_assignments (client_id, staff_id, scope_type)
         VALUES ($1, $2, 'group')`,
        [clientId, entry.staffId],
      );
    }
  });

  return { clientId, venueId, staffCount: STAFF.length, idMap, skipped: false };
}

// CLI entry — seeds, then prints the demo handover summary.
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  initDb(config);
  seedStewardDemo()
    .then(({ clientId, venueId, staffCount }) => {
      const reg = getFullRegister();
      const machines = getGamingMachines();
      const pos = getPosSummary();
      console.log('— The Steward Hotel demo tenant seeded —');
      console.log('  client_id:', clientId);
      console.log('  venue_id :', venueId);
      console.log('  staff    :', staffCount);
      console.log('  demo logins (password:', DEMO_PASSWORD + '):');
      for (const a of DEMO_ACCOUNTS) console.log('    ', a.email, '→', a.label);
      console.log('  mock datasets paired:');
      console.log('    RSA register   :', reg.rsa.length, 'entries');
      console.log('    RG register    :', reg.rg.length, 'entries');
      console.log('    gaming machines:', machines.machineCount,
        `(${machines.summary.fault} fault, ${machines.summary.idle} idle)`);
      console.log('    gaming NGR today:', pos.gamingFinancials.ngrToday);
      process.exit(0);
    })
    .catch((err) => {
      console.error('demo seed failed:', err.message);
      process.exit(1);
    });
}
