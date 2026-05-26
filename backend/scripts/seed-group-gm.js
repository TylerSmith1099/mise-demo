/**
 * Patch seed — add Group GM (Hannah Chiu / STW-029) to the live demo DB.
 * MIS-497.
 *
 * The main seed (src/demo/seed.js) is idempotent-skip: it does nothing if the
 * client already exists. This script safely adds the new tier-2 account to an
 * already-seeded DB without touching existing rows.
 *
 * Idempotent: no-ops if groupgm@steward.demo already exists.
 *
 * Run: node scripts/seed-group-gm.js   (from backend/)
 * Or add to the Start Command after seed.js (see DEPLOY.md).
 *
 * DEMO_CLIENT_ID / DEMO_VENUE_ID must match values used by src/demo/seed.js.
 */

import { randomUUID } from 'node:crypto';
import { initDb, withClientContext, closeDb } from '../src/db.js';
import { hashPassword } from '../src/passwords.js';
import { loadConfig } from '../src/config.js';

const DEMO_CLIENT_ID = process.env.DEMO_CLIENT_ID || 'a0000000-0000-4000-8000-000000000001';
const DEMO_PASSWORD  = 'mise-demo-2026';

const GROUP_GM = {
  externalStaffId: 'STW-029',
  firstName: 'Hannah',
  lastName: 'Chiu',
  role: 'Group General Manager',
  roleTier: 2,
  email: 'groupgm@steward.demo',
};

async function main() {
  const config = loadConfig();
  initDb(config);
  const clientId = DEMO_CLIENT_ID;

  await withClientContext(clientId, async (q) => {
    // No-op if already seeded.
    const { rowCount } = await q(
      `SELECT 1 FROM staff WHERE client_id = $1 AND email = $2 AND deleted_at IS NULL`,
      [clientId, GROUP_GM.email],
    );
    if (rowCount > 0) {
      console.log('seed-group-gm: groupgm@steward.demo already exists — skipping');
      return;
    }

    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const staffId = randomUUID();

    // Tier 1-3 staff have null venue_id; scope comes from staff_venue_assignments.
    await q(
      `INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name,
                          email, role_tier, role_name, password_hash)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8)`,
      [staffId, clientId,
       GROUP_GM.firstName, GROUP_GM.lastName, GROUP_GM.email,
       GROUP_GM.roleTier, GROUP_GM.role, passwordHash],
    );

    // Group scope: access to all venues under this client.
    await q(
      `INSERT INTO staff_venue_assignments (client_id, staff_id, scope_type)
       VALUES ($1, $2, 'group')`,
      [clientId, staffId],
    );

    console.log('seed-group-gm: seeded', GROUP_GM.email, '— staff_id:', staffId);
    console.log('  Login: client_id=%s  email=%s  password=%s  (Venue ID: leave blank)',
      clientId, GROUP_GM.email, DEMO_PASSWORD);
  });

  await closeDb();
}

main().catch((err) => {
  console.error('seed-group-gm failed:', err.message);
  process.exit(1);
});
