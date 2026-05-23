/**
 * Demo tenant seed — The Steward Hotel / Pinnacle Hotel Group (FICTIONAL).
 * MIS-185.
 *
 * Loads the demo client, venue, and all 28 staff from the mock workforce
 * adapter into Postgres under the client's RLS context (so the seed itself
 * honours the isolation contract — no row is written outside the client scope).
 *
 * Compliance / POS / gaming config are served live from the mock adapters via
 * src/api/routes/demo.js; they are read sources, not relational tables, so this
 * seed loads the relational records (client, venue, staff, logins) and prints a
 * summary of the mock datasets it is paired with.
 *
 * Idempotent-ish: re-running with a fresh DB is clean. The three demo logins
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

// The three demo accounts map onto specific seeded staff (by externalStaffId).
export const DEMO_ACCOUNTS = [
  { email: 'gaming@steward.demo',      externalStaffId: 'STW-011', label: 'Gaming Attendant (Sarah Chen)' },
  { email: 'dutymanager@steward.demo', externalStaffId: 'STW-003', label: 'Duty Manager (James Kovacs)' },
  { email: 'manager@steward.demo',     externalStaffId: 'STW-001', label: 'Venue Manager (Rachel Drummond)' },
];

export async function seedStewardDemo() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const clientId = randomUUID();
  const venueId = randomUUID();

  // externalStaffId -> { staffId, email } for wiring demo logins.
  const idMap = new Map();

  await withClientContext(clientId, async (q) => {
    await q(
      `INSERT INTO clients (client_id, client_name, white_label_name)
       VALUES ($1, $2, $3)`,
      [clientId, 'Pinnacle Hotel Group', 'Pinnacle Assist'],
    );
    await q(
      `INSERT INTO venues (venue_id, client_id, venue_name, state, timezone)
       VALUES ($1, $2, $3, 'QLD', 'Australia/Brisbane')`,
      [venueId, clientId, 'The Steward Hotel'],
    );

    const demoEmailFor = (extId) =>
      DEMO_ACCOUNTS.find((a) => a.externalStaffId === extId)?.email;

    for (const p of STAFF) {
      const staffId = randomUUID();
      // Demo-login staff get the fixed demo email + password; everyone else gets
      // a deterministic internal email and the same hash (logins not exposed).
      const email = demoEmailFor(p.externalStaffId)
        || `${p.firstName}.${p.lastName}`.toLowerCase().replace(/[^a-z.]/g, '') + '@steward.demo';
      await q(
        `INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name,
                            email, role_tier, role_name, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [staffId, clientId, venueId, p.firstName, p.lastName, email,
         p.roleTier, p.role, passwordHash],
      );
      idMap.set(p.externalStaffId, { staffId, email, role: p.role });
    }
  });

  return { clientId, venueId, staffCount: STAFF.length, idMap };
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
