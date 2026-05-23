// Seed demo data: two clients (to exercise cross-client isolation), each with a
// venue and staff across the MVP tiers, plus one above-MVP staff to show tier
// gating. Reusable as a module (seedDemo) and as a CLI.
//
// Inserts run inside each client's RLS context (set per-transaction), so the
// seed itself respects the isolation contract.

import { randomUUID } from 'node:crypto';
import { initDb, withClientContext } from '../src/db.js';
import { hashPassword } from '../src/passwords.js';
import { loadConfig } from '../src/config.js';

export async function seedDemo() {
  const pinnacleHash = await hashPassword('floor-1234');
  const dutyHash = await hashPassword('duty-5678');
  const venueMgrHash = await hashPassword('venue-9012');
  const gmHash = await hashPassword('gm-3456');
  const otherHash = await hashPassword('other-0000');

  const a = {
    clientId: randomUUID(),
    venueId: randomUUID(),
    gaming: randomUUID(),
    duty: randomUUID(),
    venueMgr: randomUUID(),
    gm: randomUUID(),
  };
  const b = { clientId: randomUUID(), venueId: randomUUID(), staff: randomUUID() };

  await withClientContext(a.clientId, async (q) => {
    await q(
      `INSERT INTO clients (client_id, client_name, white_label_name)
       VALUES ($1, $2, $3)`,
      [a.clientId, 'Pinnacle Hotel Group', 'Pinnacle Assist'],
    );
    await q(
      `INSERT INTO venues (venue_id, client_id, venue_name, state, timezone)
       VALUES ($1, $2, $3, 'QLD', 'Australia/Brisbane')`,
      [a.venueId, a.clientId, 'The Criterion Hotel'],
    );
    const staffRows = [
      [a.gaming, 'Grace', 'Attendant', 'grace@pinnacle.test', 7, 'Gaming Attendant', pinnacleHash],
      [a.duty, 'Dan', 'Manager', 'dan@pinnacle.test', 5, 'Duty Manager', dutyHash],
      [a.venueMgr, 'Vera', 'Boss', 'vera@pinnacle.test', 4, 'Venue Manager', venueMgrHash],
      [a.gm, 'Gina', 'Exec', 'gina@pinnacle.test', 3, 'General Manager', gmHash],
    ];
    for (const r of staffRows) {
      await q(
        `INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name,
                            email, role_tier, role_name, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [r[0], a.clientId, a.venueId, r[1], r[2], r[3], r[4], r[5], r[6]],
      );
    }
  });

  await withClientContext(b.clientId, async (q) => {
    await q(
      `INSERT INTO clients (client_id, client_name, white_label_name)
       VALUES ($1, $2, $3)`,
      [b.clientId, 'Rival Taverns', 'Rival Assist'],
    );
    await q(
      `INSERT INTO venues (venue_id, client_id, venue_name, state, timezone)
       VALUES ($1, $2, $3, 'NSW', 'Australia/Sydney')`,
      [b.venueId, b.clientId, 'The Other Pub'],
    );
    await q(
      `INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name,
                          email, role_tier, role_name, password_hash)
       VALUES ($1, $2, $3, 'Otto', 'Other', 'otto@rival.test', 5, 'Duty Manager', $4)`,
      [b.staff, b.clientId, b.venueId, otherHash],
    );
  });

  return { a, b };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  initDb(config);
  seedDemo()
    .then((ids) => {
      console.log('seeded clients:', ids.a.clientId, ids.b.clientId);
      process.exit(0);
    })
    .catch((err) => {
      console.error('seed failed:', err.message);
      process.exit(1);
    });
}
