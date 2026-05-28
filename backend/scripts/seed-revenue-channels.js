/**
 * seed-revenue-channels.js — per-channel revenue seed + bookings seed (MIS-642)
 *
 * Revenue: 18 months back + 1 month forward for 4 channels:
 *   gaming, bar, food, bottle_shop (The Steward Hotel, Brisbane)
 *
 * NON-NEGOTIABLE: gaming = NET RTV only (never meter turnover).
 *   Meter turnover ≈ $1.5M/week; NET RTV = $1,500,000 × 8.4% = $126,000/week.
 *
 * Weekly targets (matching HoP sign-off MIS-641):
 *   gaming:      $126,000 → 12,600,000 cents
 *   bar:         $50,000  →  5,000,000 cents
 *   food:        $80,000  →  8,000,000 cents
 *   bottle_shop: $52,000  →  5,200,000 cents
 *
 * Day weights (Sun=0 … Sat=6):
 *   [0.17, 0.08, 0.08, 0.10, 0.12, 0.20, 0.25]
 *
 * Bookings: 8 weeks back + 8 weeks forward (112 days) per venue.
 *
 * Idempotent: ON CONFLICT DO NOTHING for revenue rows; bookings table is
 * fully replaced on each run using soft-delete + re-insert.
 *
 * Run: DEMO_CLIENT_ID=... DEMO_VENUE_ID=... node scripts/seed-revenue-channels.js
 * docker-entrypoint.sh calls this for both demo tenants.
 */

import { initDb, withClientContext, closeDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';

// ─── Demo tenant IDs (overridable via env) ────────────────────────────────────
const DEMO_CLIENT_ID = process.env.DEMO_CLIENT_ID || 'a0000000-0000-4000-8000-000000000001';
const DEMO_VENUE_ID  = process.env.DEMO_VENUE_ID  || 'a0000000-0000-4000-8000-000000000002';

// ─── Revenue targets (weekly, cents) ─────────────────────────────────────────
// NON-NEGOTIABLE: gaming = NET RTV only (~$126k/wk at 8.4% of $1.5M turnover)
const WEEKLY_TARGETS_CENTS = {
  gaming:      12_600_000,
  bar:          5_000_000,
  food:         8_000_000,
  bottle_shop:  5_200_000,
};

// Day weights: index = JS getDay() (0=Sun, 6=Sat)
const DAY_WEIGHTS = [0.17, 0.08, 0.08, 0.10, 0.12, 0.20, 0.25];

const CHANNELS = Object.keys(WEEKLY_TARGETS_CENTS);

// ─── Guest name pools for bookings ────────────────────────────────────────────
const FIRST_NAMES = [
  'James','Sarah','Michael','Emma','David','Jessica','Robert','Ashley',
  'Thomas','Amanda','Daniel','Melissa','Matthew','Stephanie','William',
  'Nicole','Joseph','Rachel','Charles','Lauren','Mark','Rebecca','Paul',
  'Heather','Steven','Megan','Kevin','Amber','Brian','Kristin',
];
const LAST_NAMES = [
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis',
  'Wilson','Taylor','Anderson','Thomas','Jackson','White','Harris','Martin',
  'Thompson','Robinson','Clark','Rodriguez','Lewis','Lee','Walker','Hall',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

// Brisbane today (UTC+10, no DST)
function today() {
  return isoDate(new Date(Date.now() + 10 * 3_600_000));
}

// Simple deterministic pseudo-random (seeded by date string to be reproducible)
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededRand(seed) {
  // LCG seeded on hash
  const h = simpleHash(String(seed));
  return ((h * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff;
}

// Sinusoidal ±8% variance keyed to week offset (week repeats over time)
function weekVariance(dateStr) {
  const daysSinceEpoch = Math.floor(new Date(dateStr).getTime() / 86_400_000);
  const week = Math.floor(daysSinceEpoch / 7);
  return 1 + 0.08 * Math.sin(week * 0.8);
}

// Deterministic noise ±3% for within-day jitter
function dayNoise(dateStr, channel) {
  const r = seededRand(dateStr + channel);
  return 1 + (r - 0.5) * 0.06;
}

// ─── Revenue helpers ─────────────────────────────────────────────────────────
function dailyTarget(channel, dateStr) {
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  return Math.round(WEEKLY_TARGETS_CENTS[channel] * DAY_WEIGHTS[dow]);
}

function dailyActual(channel, dateStr) {
  const target = dailyTarget(channel, dateStr);
  const variance = weekVariance(dateStr);
  const noise = dayNoise(dateStr, channel);
  return Math.round(target * variance * noise);
}

// ─── Booking helpers ─────────────────────────────────────────────────────────
const SERVICE_WINDOWS = [
  { window: 'lunch',  slots: ['12:00', '12:30', '13:00', '13:30'] },
  { window: 'dinner', slots: ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30'] },
  { window: 'bar',    slots: ['20:00', '20:30', '21:00'] },
];

function guestName(seed) {
  const h = simpleHash(seed);
  const first = FIRST_NAMES[h % FIRST_NAMES.length];
  const last = LAST_NAMES[(h >> 4) % LAST_NAMES.length];
  return `${first} ${last}`;
}

function bookingsForDate(dateStr, clientId, venueId) {
  const baseStatus = new Date(dateStr + 'T12:00:00Z') < new Date() ? 'completed' : null;
  const rows = [];

  for (const { window, slots } of SERVICE_WINDOWS) {
    for (const slot of slots) {
      // Deterministic count: 0–5 bookings per slot (skip some slots to vary density)
      const countSeed = simpleHash(dateStr + window + slot);
      const count = countSeed % 6; // 0–5
      if (count === 0) continue;

      for (let i = 0; i < count; i++) {
        const seed = `${dateStr}${window}${slot}${i}`;
        const h = simpleHash(seed);
        const partySize = 1 + (h % 7); // 1–7
        const isVip = h % 13 === 0; // ~8% VIP
        const r = seededRand(seed);
        let status = baseStatus;
        if (!status) {
          status = r < 0.15 ? 'tentative' : 'confirmed';
        }

        rows.push({
          client_id:      clientId,
          venue_id:       venueId,
          booking_date:   dateStr,
          service_window: window,
          slot_time:      slot + ':00',
          party_size:     partySize,
          guest_name:     guestName(seed),
          status,
          is_vip:         isVip,
        });
      }
    }
  }

  return rows;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const config = loadConfig();
  initDb(config);

  const clientId = DEMO_CLIENT_ID;
  const venueId  = DEMO_VENUE_ID;
  const BASE = today();

  console.log(`[seed-channels] client=${clientId} venue=${venueId} base=${BASE}`);

  await withClientContext(clientId, async (q) => {

    // ── Revenue: 18 months back + 1 month forward ─────────────────────────────
    const revStart = addDays(BASE, -548); // ~18 months
    const revEnd   = addDays(BASE, 31);   // 1 month forward

    let revInserted = 0;
    let revSkipped  = 0;
    let d = revStart;

    while (d <= revEnd) {
      for (const channel of CHANNELS) {
        const actual = dailyActual(channel, d);
        const result = await q(
          `INSERT INTO revenue_daily
             (client_id, venue_id, business_date, gross_revenue_cents, net_revenue_cents,
              transaction_count, source, channel)
           VALUES ($1, $2, $3, $4, $5, $6, 'seed', $7)
           ON CONFLICT (client_id, venue_id, business_date, source, channel) DO NOTHING`,
          [clientId, venueId, d, actual, actual, Math.round(actual / 2800), channel],
        );
        if (result.rowCount > 0) revInserted++;
        else revSkipped++;
      }
      d = addDays(d, 1);
    }

    console.log(`[seed-channels] revenue: ${revInserted} inserted, ${revSkipped} skipped (idempotent)`);

    // ── Bookings: 8 weeks back + 8 weeks forward ──────────────────────────────
    // Soft-delete existing seed bookings then re-insert (keeps data fresh)
    await q(
      `UPDATE bookings SET deleted_at = now()
        WHERE client_id = $1 AND venue_id = $2
          AND deleted_at IS NULL
          AND booking_date >= $3 AND booking_date <= $4`,
      [clientId, venueId, addDays(BASE, -56), addDays(BASE, 56)],
    );

    const bookStart = addDays(BASE, -56);
    const bookEnd   = addDays(BASE, 56);
    let bookInserted = 0;

    let bd = bookStart;
    while (bd <= bookEnd) {
      const rows = bookingsForDate(bd, clientId, venueId);
      for (const row of rows) {
        await q(
          `INSERT INTO bookings
             (client_id, venue_id, booking_date, service_window, slot_time,
              party_size, guest_name, status, is_vip)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            row.client_id, row.venue_id, row.booking_date, row.service_window,
            row.slot_time, row.party_size, row.guest_name, row.status, row.is_vip,
          ],
        );
        bookInserted++;
      }
      bd = addDays(bd, 1);
    }

    console.log(`[seed-channels] bookings: ${bookInserted} inserted for ${bookStart} → ${bookEnd}`);
  });

  await closeDb();
  console.log('[seed-channels] done');
}

main().catch((err) => {
  console.error('[seed-channels] fatal:', err.message);
  process.exit(1);
});
