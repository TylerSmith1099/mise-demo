/**
 * Demo tenant seed V2 — MIS-436 / MIS-433.
 *
 * Extends seed.js (MIS-185/201) with:
 *   - Sibling venues 003-005 + cluster
 *   - Desktop personas (Area Mgr, Group Admin) + staff_venue_assignments
 *   - Revenue/labour actuals: 90d daily × 4 venues, 14d hourly × 4 venues
 *   - EGM machines on primary venue (45)
 *   - Handover note on primary venue
 *   - P&L summary (current month, primary venue)
 *   - §1 isolation gate: decoy client + G1-G5 assertions + §1.3 structural checks
 *
 * Revenue curve (MIS-435 R&D source of truth):
 *   Primary venue (The Steward Hotel) weekly: $269k total
 *     Gaming net RTV $126k · Bar $75k · Food $38k · TAB $18k · Functions $12k
 *   Sibling venues scaled at 60% / 50% / 45% of primary respectively.
 *   Gaming RTV: mean-reverting walk centred 8.0%, clamped 7-9%.
 *
 * Labour rates (casual, HIGA MA000009 eff 1 Jul 2025, verified FWO):
 *   G3 Gaming  Mon-Fri $33.38 / Sat $40.05 / Sun $46.73 / PH $66.75
 *   G2 Bar/Bistro Mon-Fri $32.31 / Sat $38.78 / Sun $45.24 / PH $64.63
 *
 * Contract ref: Deliverables/Technical/Demo-Seed-Isolation-and-Format-Contract-V1.md
 * Gate: §1 isolation gate MUST pass (exits non-zero on failure). Gate output is
 * the validation summary reviewed by the CTO before MIS-436 closes.
 *
 * Run: node src/demo/seed-demo-v2.js  (from MISE/backend)
 *      DB_CONNECTION_STRING=postgres://... node src/demo/seed-demo-v2.js
 */

import { randomUUID } from 'node:crypto';
import { initDb, withClientContext } from '../db.js';
import { hashPassword } from '../passwords.js';
import { loadConfig } from '../config.js';
import { seedStewardDemo, DEMO_CLIENT_ID, DEMO_VENUE_ID, DEMO_PASSWORD } from './seed.js';

// ============================================================
// §2 Fixed identifiers — MIS-434 contract, do not change without updating DEPLOY.md
// ============================================================

const CLIENT_ID  = DEMO_CLIENT_ID; // a0000000-0000-4000-8000-000000000001
const VENUE_002  = DEMO_VENUE_ID;  // The Steward Hotel (primary)
const VENUE_003  = 'a0000000-0000-4000-8000-000000000003'; // The Criterion Tavern
const VENUE_004  = 'a0000000-0000-4000-8000-000000000004'; // Pinnacle on Grey
const VENUE_005  = 'a0000000-0000-4000-8000-000000000005'; // The Lord Alfred (NSW)
const CLUSTER_ID = 'a0000000-0000-4000-8000-0000000000c1'; // South-East QLD

// §1.1 Decoy tenant — fixed documented IDs
const DECOY_CLIENT_ID = 'b0000000-0000-4000-8000-0000000000ff';
const DECOY_VENUE_ID  = 'b0000000-0000-4000-8000-000000000001';

// Desktop persona fixed IDs
const AREA_MGR_ID  = 'a0000000-0000-4000-8000-000000000da1';
const GROUP_ADM_ID = 'a0000000-0000-4000-8000-000000000da2';

// ============================================================
// Venue table — drives iteration
// ============================================================

const VENUES = [
  { venueId: VENUE_002, name: 'The Steward Hotel',    state: 'QLD', tz: 'Australia/Brisbane', egmCount: 45, scale: 1.00, primary: true },
  { venueId: VENUE_003, name: 'The Criterion Tavern', state: 'QLD', tz: 'Australia/Brisbane', egmCount: 0,  scale: 0.60 },
  { venueId: VENUE_004, name: 'Pinnacle on Grey',     state: 'QLD', tz: 'Australia/Brisbane', egmCount: 0,  scale: 0.50 },
  { venueId: VENUE_005, name: 'The Lord Alfred',      state: 'NSW', tz: 'Australia/Sydney',   egmCount: 0,  scale: 0.45 },
];

// ============================================================
// Revenue curve (MIS-435 — primary venue weekly targets in cents)
// ============================================================

const PRIMARY_WEEKLY_CENTS = {
  gaming: 12_600_000, // $126k net RTV
  bar:     7_500_000, // $75k
  food:    3_800_000, // $38k
  tab:     1_800_000, // $18k
  functions: 1_200_000, // $12k
  // total: $269k
};

// Day-of-week revenue weights (indices: 0=Mon ... 6=Sun)
// Beverage/Food/Functions peak Fri-Sat; Gaming peaks Fri-Sat; TAB flat
const DOW_WEIGHTS = {
  bar:       [0.08, 0.09, 0.11, 0.14, 0.22, 0.22, 0.14],
  food:      [0.08, 0.09, 0.12, 0.14, 0.23, 0.23, 0.11],
  gaming:    [0.10, 0.11, 0.12, 0.14, 0.22, 0.22, 0.09],
  tab:       [0.16, 0.16, 0.16, 0.16, 0.18, 0.18, 0.00],
  functions: [0.04, 0.04, 0.05, 0.06, 0.33, 0.33, 0.15],
};

// ±noise bound (fraction of daily amount) to avoid perfectly flat series
const NOISE = 0.08;

// QLD/NSW public holidays in the 90-day seed window (approx Feb 2026 - May 2026)
// All dates are ISO strings (local trading date)
const PUBLIC_HOLIDAYS = new Set([
  '2026-04-03', // Good Friday
  '2026-04-04', // Easter Saturday (QLD)
  '2026-04-06', // Easter Monday
  '2026-04-25', // Anzac Day
  '2026-05-04', // QLD Labour Day
]);

// ============================================================
// Date helpers — always fresh, never module-level constants (MIS-270 lesson)
// ============================================================

function demoClock() { return new Date(); }

// venue-local trading date for a given UTC timestamp (05:00 rollover)
function tradingDate(utcDate, ianaTimezone) {
  const rolloverHour = 5;
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: ianaTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(dtf.formatToParts(utcDate).map(p => [p.type, p.value]));
  const localHour = Number(parts.hour);
  const isoDate = `${parts.year}-${parts.month}-${parts.day}`;
  if (localHour < rolloverHour) {
    // before 05:00 belongs to prior trading day
    const d = new Date(utcDate);
    d.setDate(d.getDate() - 1);
    const prev = Object.fromEntries(dtf.formatToParts(d).map(p => [p.type, p.value]));
    return `${prev.year}-${prev.month}-${prev.day}`;
  }
  return isoDate;
}

// Generate last N distinct trading dates ending at 'today' for a venue tz
function tradingDates(n, ianaTimezone) {
  const seen = new Set();
  const dates = [];
  const cursor = demoClock();
  while (dates.length < n) {
    const d = tradingDate(cursor, ianaTimezone);
    if (!seen.has(d)) { seen.add(d); dates.push(d); }
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates.reverse(); // oldest first
}

// Day-of-week (0=Mon, 6=Sun) from an ISO date string
function dowIndex(isoDate) {
  const d = new Date(isoDate + 'T12:00:00Z');
  return (d.getUTCDay() + 6) % 7; // convert Sun=0 → Mon=0
}

// Seeded deterministic noise — same run gives same output
function noise(seed, bound) {
  const x = Math.abs(Math.sin(seed) * 43758.5453);
  return (x - Math.floor(x) - 0.5) * 2 * bound;
}

// ============================================================
// Revenue generation
// ============================================================

// Generate daily revenue in cents for one venue+date
function dailyRevenue(venueId, isoDate, scale) {
  const dow = dowIndex(isoDate);
  const dateSeed = parseInt(isoDate.replace(/-/g, ''), 10);
  const venueSeed = parseInt(venueId.replace(/-/g, '').slice(0, 8), 16);

  let totalNet = 0;
  const streams = {};
  for (const [stream, weeklyCents] of Object.entries(PRIMARY_WEEKLY_CENTS)) {
    const weights = DOW_WEIGHTS[stream] || DOW_WEIGHTS.bar;
    const base = Math.round(weeklyCents * weights[dow] * scale);
    const jitter = Math.round(base * noise(dateSeed + venueSeed + stream.charCodeAt(0), NOISE));
    streams[stream] = Math.max(0, base + jitter);
    totalNet += streams[stream];
  }

  // Gaming: also compute meter turnover at an effective RTV rate (mean-reverting 7-9%)
  // RTV varies week-to-week; use a simple deterministic walk based on week number
  const weekNum = Math.floor(dateSeed / 7);
  const rtvBase = 0.08;
  const rtvWalk = 0.015 * Math.sin(weekNum * 1.7 + venueSeed % 100);
  const rtvRate = Math.max(0.07, Math.min(0.09, rtvBase + rtvWalk));
  const meterTurnover = Math.round(streams.gaming / rtvRate);

  // Gross = net * 1.025 (modest gross-to-net ratio for a gaming pub)
  const grossNet = Math.round(totalNet * 1.025);
  const txnCount = Math.max(1, Math.round(totalNet / 4500 + noise(dateSeed, 30)));

  return { netCents: totalNet, grossCents: grossNet, txnCount, gamingNetCents: streams.gaming, meterTurnoverCents: meterTurnover, streams, rtvRate };
}

// Hourly distribution weights (hour_local 0-23, where 0 = 05:00 local)
// Active trading: hour_local 5 (10:00) through 22 (03:00 next day)
const HOURLY_WEIGHTS = [
  0.000, 0.000, 0.000, 0.000, 0.000, // 0-4: pre-open (05:00-09:59)
  0.020, 0.030,                        // 5-6: slow open (10:00-11:59)
  0.080, 0.090,                        // 7-8: lunch (12:00-13:59)
  0.050, 0.040,                        // 9-10: afternoon lull (14:00-15:59)
  0.040, 0.060,                        // 11-12: late afternoon (16:00-17:59)
  0.070, 0.100,                        // 13-14: early evening (18:00-19:59)
  0.120, 0.100,                        // 15-16: peak (20:00-21:59)
  0.080, 0.060,                        // 17-18: post-peak (22:00-23:59)
  0.040, 0.020,                        // 19-20: late (00:00-01:59)
  0.010, 0.005, 0.005,                 // 21-23: very late (02:00-04:59)
];
const HOURLY_WEIGHT_SUM = HOURLY_WEIGHTS.reduce((a, b) => a + b, 0);

// Distribute daily net revenue across hours — must SUM exactly to daily total (§3.4)
function hourlyRevenue(dailyNetCents) {
  if (dailyNetCents === 0) return Array(24).fill(0);
  const raw = HOURLY_WEIGHTS.map(w => Math.round(dailyNetCents * w / HOURLY_WEIGHT_SUM));
  const roundingErr = dailyNetCents - raw.reduce((a, b) => a + b, 0);
  raw[15] += roundingErr; // absorb rounding into peak hour
  return raw;
}

// ============================================================
// Labour generation
// ============================================================

// Casual HIGA rates in cents per hour (eff 1 Jul 2025 — MIS-435 correction)
const LABOUR_RATE_CENTS = {
  gaming: { mf: 3338, sat: 4005, sun: 4673, ph: 6675 },
  other:  { mf: 3231, sat: 3878, sun: 4524, ph: 6463 },
};

function dailyLabour(venueId, isoDate, netRevCents, scale) {
  const dow = dowIndex(isoDate);
  const isPH = PUBLIC_HOLIDAYS.has(isoDate);
  const dateSeed = parseInt(isoDate.replace(/-/g, ''), 10);

  // Staff count: scale from primary venue (~15 weekday, ~22 weekend)
  const baseStaff = dow >= 5 ? 22 : (dow >= 4 ? 18 : 15);
  const scaledStaff = Math.max(3, Math.round(baseStaff * scale));

  // Gaming staff: ~30% of floor staff, rest are bar/food
  const gamingStaff = Math.max(1, Math.round(scaledStaff * 0.30));
  const otherStaff = scaledStaff - gamingStaff;

  // Hours per staff per shift: ~8h weekday, ~10h weekend
  const shiftHours = dow >= 5 ? 10 : 8;

  const rateKey = isPH ? 'ph' : (dow === 5 ? 'sat' : (dow === 6 ? 'sun' : 'mf'));
  const gamingCostCents = gamingStaff * shiftHours * LABOUR_RATE_CENTS.gaming[rateKey];
  const otherCostCents = otherStaff * shiftHours * LABOUR_RATE_CENTS.other[rateKey];
  const totalCostCents = gamingCostCents + otherCostCents;

  const workedHours = (gamingStaff + otherStaff) * shiftHours;

  // Budget: typically ~5-10% higher than actuals
  const budgetMultiplier = 1.07 + noise(dateSeed + 1, 0.03);
  const budgetedCosts = Math.round(totalCostCents * budgetMultiplier);
  const budgetedHours = workedHours * budgetMultiplier;

  return {
    workedHours,
    costCents: totalCostCents,
    budgetedHours,
    budgetedCostCents: budgetedCosts,
  };
}

// ============================================================
// §2 Seed sibling venues
// ============================================================

async function seedVenues(q) {
  for (const v of VENUES) {
    if (v.primary) {
      // Update primary venue egm_count (original seed may have left it 0)
      await q(
        `UPDATE venues SET egm_count = 45 WHERE client_id = $1 AND venue_id = $2`,
        [CLIENT_ID, VENUE_002],
      );
      continue;
    }
    await q(
      `INSERT INTO venues (venue_id, client_id, venue_name, state, timezone, egm_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (client_id, venue_id) DO UPDATE
         SET venue_name = EXCLUDED.venue_name,
             state      = EXCLUDED.state,
             timezone   = EXCLUDED.timezone,
             egm_count  = EXCLUDED.egm_count`,
      [v.venueId, CLIENT_ID, v.name, v.state, v.tz, v.egmCount],
    );
  }
}

// ============================================================
// §2 Cluster
// ============================================================

async function seedCluster(q) {
  await q(
    `INSERT INTO venue_clusters (cluster_id, client_id, cluster_name)
     VALUES ($1, $2, 'South-East QLD')
     ON CONFLICT (client_id, cluster_id) DO UPDATE SET cluster_name = EXCLUDED.cluster_name`,
    [CLUSTER_ID, CLIENT_ID],
  );
  for (const venueId of [VENUE_002, VENUE_003, VENUE_004]) {
    await q(
      `INSERT INTO venue_cluster_members (client_id, cluster_id, venue_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [CLIENT_ID, CLUSTER_ID, venueId],
    );
  }
  // VENUE_005 (Lord Alfred, NSW) is outside the cluster — group scope only
}

// ============================================================
// §2 Desktop personas
// ============================================================

async function seedDesktopPersonas(q, passwordHash) {
  const personas = [
    {
      staffId: AREA_MGR_ID, firstName: 'Simone', lastName: 'Nakamura',
      email: 'areamanager@pinnacle.demo', roleTier: 3, roleName: 'Area Manager',
      scopeType: 'cluster', venueId: null, clusterId: CLUSTER_ID,
    },
    {
      staffId: GROUP_ADM_ID, firstName: 'David', lastName: 'Okafor',
      email: 'groupadmin@pinnacle.demo', roleTier: 2, roleName: 'Group Admin',
      scopeType: 'group', venueId: null, clusterId: null,
    },
  ];
  for (const p of personas) {
    await q(
      `INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name,
                          email, role_tier, role_name, password_hash)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (client_id, staff_id) DO UPDATE
         SET role_name = EXCLUDED.role_name`,
      [p.staffId, CLIENT_ID, p.firstName, p.lastName, p.email, p.roleTier, p.roleName, passwordHash],
    );
    await q(
      `INSERT INTO staff_venue_assignments
         (assignment_id, client_id, staff_id, scope_type, venue_id, cluster_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [randomUUID(), CLIENT_ID, p.staffId, p.scopeType, p.venueId, p.clusterId],
    );
  }
}

// Sibling-venue staff + venue-scope assignments for Venue Coordinators
const SIBLING_STAFF = [
  { venueId: VENUE_003, first: 'Liam',   last: 'Torres',   roleTier: 4, roleName: 'Venue Coordinator', dept: 'management' },
  { venueId: VENUE_003, first: 'Priya',  last: 'Sethi',    roleTier: 5, roleName: 'Duty Manager',      dept: 'management' },
  { venueId: VENUE_003, first: 'Mark',   last: 'Flanagan', roleTier: 7, roleName: 'Gaming Attendant',  dept: 'gaming'     },
  { venueId: VENUE_004, first: 'Aisha',  last: 'Okonkwo',  roleTier: 4, roleName: 'Venue Coordinator', dept: 'management' },
  { venueId: VENUE_004, first: 'Tomas',  last: 'Berger',   roleTier: 5, roleName: 'Duty Manager',      dept: 'management' },
  { venueId: VENUE_004, first: 'Chloe',  last: 'Ingham',   roleTier: 7, roleName: 'Gaming Attendant',  dept: 'gaming'     },
  { venueId: VENUE_005, first: 'James',  last: 'Prescott', roleTier: 4, roleName: 'Venue Coordinator', dept: 'management' },
  { venueId: VENUE_005, first: 'Fatima', last: 'Hussain',  roleTier: 5, roleName: 'Duty Manager',      dept: 'management' },
  { venueId: VENUE_005, first: 'Ryan',   last: 'Callahan', roleTier: 7, roleName: 'Gaming Attendant',  dept: 'gaming'     },
];

async function seedSiblingStaff(q, passwordHash) {
  for (const p of SIBLING_STAFF) {
    const staffId = randomUUID();
    const email = `${p.first.toLowerCase()}.${p.last.toLowerCase()}@demo.mise`;
    await q(
      `INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name,
                          email, role_tier, role_name, password_hash, department)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING`,
      [staffId, CLIENT_ID, p.venueId, p.first, p.last, email, p.roleTier, p.roleName, passwordHash, p.dept],
    );
    // Resolve actual staff_id — the insert above may have been a no-op if the
    // record already existed (ON CONFLICT DO NOTHING), so we must fetch the
    // real id rather than using the freshly-generated UUID which was never stored.
    const { rows: [existing] } = await q(
      `SELECT staff_id FROM staff WHERE client_id = $1 AND email = $2`,
      [CLIENT_ID, email],
    );
    const actualStaffId = existing?.staff_id ?? staffId;
    if (p.roleTier === 4) {
      await q(
        `INSERT INTO staff_venue_assignments
           (assignment_id, client_id, staff_id, scope_type, venue_id, cluster_id)
         VALUES ($1, $2, $3, 'venue', $4, NULL) ON CONFLICT DO NOTHING`,
        [randomUUID(), CLIENT_ID, actualStaffId, p.venueId],
      );
    }
  }
}

// ============================================================
// §4 EGM machines (primary venue, 45 machines)
// ============================================================

const GAME_NAMES = [
  "Dragon's Fortune", 'Golden Reef', 'Lucky Stars', 'Phoenix Rising',
  'Crown Jewels', 'Outback Gold', 'Harbour Lights', 'Blue Diamond',
  'Red Kangaroo', 'Coral Bay', 'Sunset Strip', 'Treasure Chest',
  'Wild Rivers', 'Star Power', 'Lucky Charm',
];

async function seedEgmMachines(q) {
  // Weekly turnover: gaming net $126k/wk at ~8% RTV → meter ~$1.575M/wk ÷ 45 machines = ~$35k/machine/wk
  // Distribute with variance: some machines busier than others
  const avgWeeklyTurnover = Math.round(PRIMARY_WEEKLY_CENTS.gaming / 0.08 / 45);
  for (let num = 1; num <= 45; num++) {
    const gameName = GAME_NAMES[(num - 1) % GAME_NAMES.length];
    const variance = 1.0 + (noise(num * 997, 0.40)); // ±40% variance between machines
    const weeklyTurnover = Math.round((avgWeeklyTurnover * variance) / 100) * 100; // round to $100
    const status = [8, 19, 33, 44].includes(num) ? 'suspended' :
                   [12, 27, 41].includes(num) ? 'out_of_service' : 'active';
    await q(
      `INSERT INTO egm_machines (client_id, venue_id, machine_number, game_name, weekly_turnover, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (client_id, venue_id, machine_number) DO UPDATE
         SET game_name = EXCLUDED.game_name,
             weekly_turnover = EXCLUDED.weekly_turnover,
             status = EXCLUDED.status`,
      [CLIENT_ID, VENUE_002, num, gameName, weeklyTurnover / 100, status], // weekly_turnover is NUMERIC(12,2) (dollars)
    );
  }
}

// ============================================================
// §4 Handover note
// ============================================================

async function seedHandoverNote(q, dutyManagerStaffId) {
  const today = demoClock().toISOString().slice(0, 10);
  await q(
    `INSERT INTO handover_notes
       (client_id, venue_id, author_staff_id, from_role, to_role, shift_date,
        open_compliance_items, staffing_notes, incidents_summary, action_items)
     VALUES ($1, $2, $3, 'Duty Manager', 'Duty Manager', $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING`,
    [
      CLIENT_ID, VENUE_002, dutyManagerStaffId, today,
      'RSA certification for STW-019 expires in 9 days — reminder sent. Liquor licence renewal 5 months out — broker contacted.',
      'Full complement tonight. Gaming floor fully staffed. Extra bar staff for the weekend rush.',
      'Minor patron dispute at bar 21:30, de-escalated by Duty Manager, no formal report filed. RG welfare check completed for patron on M033, documented.',
      '1. Follow up gaming cert renewal with STW-019 before next shift. 2. Confirm weekend extra staff hours with payroll. 3. Restock bar fridge before open.',
    ],
  );
}

// ============================================================
// Revenue/Labour — 90d daily × 4 venues
// ============================================================

async function seedRevenueDailyAll(q) {
  for (const v of VENUES) {
    const dates = tradingDates(90, v.tz);
    for (const date of dates) {
      const { netCents, grossCents, txnCount } = dailyRevenue(v.venueId, date, v.scale);
      await q(
        `INSERT INTO revenue_daily
           (client_id, venue_id, business_date, gross_revenue_cents, net_revenue_cents,
            transaction_count, source, is_stale)
         VALUES ($1, $2, $3, $4, $5, $6, 'seed', false)
         ON CONFLICT (client_id, venue_id, business_date, source) DO UPDATE
           SET gross_revenue_cents = EXCLUDED.gross_revenue_cents,
               net_revenue_cents   = EXCLUDED.net_revenue_cents,
               transaction_count   = EXCLUDED.transaction_count`,
        [CLIENT_ID, v.venueId, date, grossCents, netCents, txnCount],
      );
    }
  }
}

// Revenue hourly — last 15 days × 4 venues × 24 hours (15d ensures 14d gate window covered)
// MUST reconcile: SUM(hourly net_revenue_cents) = daily net_revenue_cents (§3.4)
async function seedRevenueHourlyAll(q) {
  for (const v of VENUES) {
    const dates = tradingDates(15, v.tz);
    for (const date of dates) {
      const { netCents } = dailyRevenue(v.venueId, date, v.scale);
      const hourBuckets = hourlyRevenue(netCents);
      for (let h = 0; h < 24; h++) {
        const hNetCents = hourBuckets[h];
        const hGrossCents = Math.round(hNetCents * 1.025);
        const hTxnCount = Math.max(0, Math.round(hNetCents / 4500));
        await q(
          `INSERT INTO revenue_hourly
             (client_id, venue_id, business_date, hour_local,
              gross_revenue_cents, net_revenue_cents, transaction_count, source, is_stale)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'seed', false)
           ON CONFLICT (client_id, venue_id, business_date, hour_local, source) DO UPDATE
             SET gross_revenue_cents = EXCLUDED.gross_revenue_cents,
                 net_revenue_cents   = EXCLUDED.net_revenue_cents,
                 transaction_count   = EXCLUDED.transaction_count`,
          [CLIENT_ID, v.venueId, date, h, hGrossCents, hNetCents, hTxnCount],
        );
      }
    }
  }
}

// Labour actuals — 90d daily × 4 venues
async function seedLabourDailyAll(q) {
  for (const v of VENUES) {
    const dates = tradingDates(90, v.tz);
    for (const date of dates) {
      const { netCents } = dailyRevenue(v.venueId, date, v.scale);
      const labour = dailyLabour(v.venueId, date, netCents, v.scale);
      await q(
        `INSERT INTO labour_actuals_daily
           (client_id, venue_id, business_date, worked_hours, labour_cost_cents,
            budgeted_hours, budgeted_cost_cents, source, is_stale)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'award_estimate', false)
         ON CONFLICT (client_id, venue_id, business_date, source) DO UPDATE
           SET worked_hours        = EXCLUDED.worked_hours,
               labour_cost_cents   = EXCLUDED.labour_cost_cents,
               budgeted_hours      = EXCLUDED.budgeted_hours,
               budgeted_cost_cents = EXCLUDED.budgeted_cost_cents`,
        [CLIENT_ID, v.venueId, date, labour.workedHours, labour.costCents,
         labour.budgetedHours, labour.budgetedCostCents],
      );
    }
  }
}

// P&L summary — current month, primary venue
async function seedPnlSummary(q) {
  const now = demoClock();
  const monthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')} (monthly)`;

  // Sum revenue over current month for primary venue
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const daysInMonth = now.getDate();

  let totalRevCents = 0;
  let totalLabourCents = 0;
  let totalGamingNetCents = 0;
  let totalMeterTurnoverCents = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rev = dailyRevenue(VENUE_002, date, 1.0);
    const lab = dailyLabour(VENUE_002, date, rev.netCents, 1.0);
    totalRevCents += rev.netCents;
    totalLabourCents += lab.costCents;
    totalGamingNetCents += rev.gamingNetCents;
    totalMeterTurnoverCents += rev.meterTurnoverCents;
  }

  const departments = [
    { dept: 'gaming',      revenue: totalGamingNetCents, labourFrac: 0.30, ngr: totalGamingNetCents, meter: totalMeterTurnoverCents },
    { dept: 'beverage',    revenue: Math.round(totalRevCents * 0.279), labourFrac: 0.25, ngr: null, meter: null },
    { dept: 'food',        revenue: Math.round(totalRevCents * 0.141), labourFrac: 0.28, ngr: null, meter: null },
    { dept: 'bottle_shop', revenue: Math.round(totalRevCents * 0.116), labourFrac: 0.10, ngr: null, meter: null },
    { dept: 'total',       revenue: totalRevCents, labourFrac: null, ngr: null, meter: null },
  ];

  for (const d of departments) {
    const labourCost = d.labourFrac != null ? Math.round(d.revenue * d.labourFrac) :
      departments.slice(0, -1).reduce((s, x) => s + Math.round(x.revenue * x.labourFrac), 0);
    const labourPct = d.revenue > 0 ? (labourCost / d.revenue * 100).toFixed(2) : '0.00';

    await q(
      `INSERT INTO pnl_summary
         (client_id, venue_id, period_label, department,
          revenue, labour_cost, labour_pct, net_gaming_revenue, meter_turnover)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [
        CLIENT_ID, VENUE_002, monthLabel, d.dept,
        (d.revenue / 100).toFixed(2),
        (labourCost / 100).toFixed(2),
        labourPct,
        d.ngr != null ? (d.ngr / 100).toFixed(2) : null,
        d.meter != null ? (d.meter / 100).toFixed(2) : null,
      ],
    );
  }
}

// ============================================================
// §1.2 + §1.3 Isolation gate
// Exit non-zero on any assertion failure. Stdout = validation summary.
// ============================================================

async function runIsolationGate(pool) {
  const client = await pool.connect();
  let passed = 0;
  let failed = 0;
  const ok  = (msg) => { console.log('  PASS:', msg); passed++; };
  const fail = (msg) => { console.error('  FAIL:', msg); failed++; };

  const TABLES = [
    'clients', 'venues', 'staff',
    'revenue_daily', 'revenue_hourly', 'labour_actuals_daily',
    'egm_machines', 'handover_notes', 'pnl_summary',
  ];
  const FACT_TABLES = ['revenue_daily', 'revenue_hourly', 'labour_actuals_daily'];

  try {
    console.log('\n========================================');
    console.log('§1 ISOLATION GATE — MIS-436 / MIS-433');
    console.log('========================================\n');

    // Run AS mise_app — never superuser (§1.2)
    // set_config uses is_local=false (session-scoped) because gate runs in autocommit mode;
    // is_local=true would revert after each single-statement transaction.
    await client.query('SET ROLE mise_app');

    // --- G1: demo context cannot see decoy rows ---
    console.log('[G1] Under DEMO context — no decoy rows visible:');
    await client.query(`SELECT set_config('app.current_client_id', $1, false)`, [CLIENT_ID]);
    for (const tbl of TABLES) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE client_id = $1`, [DECOY_CLIENT_ID]);
      if (rows[0].n !== 0) fail(`G1 ${tbl}: demo context saw ${rows[0].n} decoy rows`);
      else ok(`G1 ${tbl}: 0 decoy rows`);
    }

    // --- G2: demo context cannot INSERT for decoy client ---
    console.log('\n[G2] Under DEMO context — INSERT for decoy rejected:');
    try {
      await client.query(
        `INSERT INTO revenue_daily (client_id, venue_id, business_date, gross_revenue_cents, net_revenue_cents, source)
         VALUES ($1, $2, '2026-01-10', 100, 90, 'seed')`,
        [DECOY_CLIENT_ID, DECOY_VENUE_ID],
      );
      fail('G2 revenue_daily: cross-client INSERT succeeded — RLS WITH CHECK did not fire');
    } catch (e) {
      if (['42501', '23514'].includes(e.code)) ok('G2 revenue_daily: RLS WITH CHECK rejected cross-client INSERT');
      else fail(`G2 revenue_daily: unexpected error code ${e.code}: ${e.message}`);
    }

    // --- G3: decoy context cannot see demo rows ---
    console.log('\n[G3] Under DECOY context — no demo rows visible:');
    await client.query(`SELECT set_config('app.current_client_id', $1, false)`, [DECOY_CLIENT_ID]);
    for (const tbl of TABLES) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE client_id = $1`, [CLIENT_ID]);
      if (rows[0].n !== 0) fail(`G3 ${tbl}: decoy context saw ${rows[0].n} demo rows`);
      else ok(`G3 ${tbl}: 0 demo rows`);
    }

    // --- G4: demo context sees its own rows ---
    console.log('\n[G4] Under DEMO context — demo rows visible to owner:');
    await client.query(`SELECT set_config('app.current_client_id', $1, false)`, [CLIENT_ID]);
    const G4_TABLES = ['clients', 'venues', 'staff', 'revenue_daily', 'revenue_hourly',
                       'labour_actuals_daily', 'egm_machines', 'handover_notes'];
    for (const tbl of G4_TABLES) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE client_id = $1`, [CLIENT_ID]);
      if (rows[0].n === 0) fail(`G4 ${tbl}: 0 rows — seed wrote nothing under context (RLS context bug)`);
      else ok(`G4 ${tbl}: ${rows[0].n} rows visible to owner`);
    }

    // --- G5: row-count parity — no orphan client_ids (run as table owner) ---
    console.log('\n[G5] Row-count parity — no rows with unexpected client_id:');
    await client.query('RESET ROLE');
    for (const tbl of FACT_TABLES) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS total,
                sum(CASE WHEN client_id = $1 THEN 1 ELSE 0 END)::int AS demo,
                sum(CASE WHEN client_id = $2 THEN 1 ELSE 0 END)::int AS decoy
           FROM ${tbl}`,
        [CLIENT_ID, DECOY_CLIENT_ID],
      );
      const { total, demo, decoy } = rows[0];
      if (total !== demo + decoy) {
        fail(`G5 ${tbl}: total=${total} demo=${demo} decoy=${decoy} — ${total - demo - decoy} orphan rows`);
      } else {
        ok(`G5 ${tbl}: ${demo} demo + ${decoy} decoy = ${total} total (no orphans)`);
      }
    }

    // --- §1.3 Structural checks ---
    console.log('\n[§1.3] Structural checks:');
    await client.query('SET ROLE mise_app');
    await client.query(`SELECT set_config('app.current_client_id', $1, false)`, [CLIENT_ID]);

    for (const tbl of FACT_TABLES) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM ${tbl} WHERE client_id = $1 AND source NOT IN ('seed', 'award_estimate')`,
        [CLIENT_ID],
      );
      if (rows[0].n > 0) fail(`§1.3 source ${tbl}: ${rows[0].n} rows with source not in ('seed','award_estimate')`);
      else ok(`§1.3 source ${tbl}: all rows have demo source ('seed' or 'award_estimate')`);
    }

    for (const tbl of [...FACT_TABLES, 'egm_machines', 'handover_notes']) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM ${tbl} WHERE client_id = $1 AND deleted_at IS NOT NULL`,
        [CLIENT_ID],
      );
      if (rows[0].n > 0) fail(`§1.3 deleted_at ${tbl}: ${rows[0].n} unexpected soft-deleted rows`);
      else ok(`§1.3 deleted_at ${tbl}: no unexpected soft-deletes`);
    }

    // Hourly reconciliation check: SUM(hourly) must equal daily for last 14d (§3.4)
    console.log('\n[§1.3] Hourly reconciliation check (SUM hourly = daily):');
    await client.query('RESET ROLE');
    const { rows: reconRows } = await client.query(
      `SELECT rd.venue_id, rd.business_date,
              rd.net_revenue_cents AS daily_net,
              COALESCE(SUM(rh.net_revenue_cents), 0)::bigint AS hourly_sum,
              rd.net_revenue_cents - COALESCE(SUM(rh.net_revenue_cents), 0) AS delta
         FROM revenue_daily rd
         LEFT JOIN revenue_hourly rh
           ON rh.client_id = rd.client_id
          AND rh.venue_id  = rd.venue_id
          AND rh.business_date = rd.business_date
          AND rh.source = 'seed'
        WHERE rd.client_id = $1
          AND rd.source    = 'seed'
          AND rd.business_date >= (CURRENT_DATE - INTERVAL '14 days')
        GROUP BY rd.venue_id, rd.business_date, rd.net_revenue_cents
       HAVING ABS(rd.net_revenue_cents - COALESCE(SUM(rh.net_revenue_cents), 0)) > 0`,
      [CLIENT_ID],
    );
    if (reconRows.length > 0) {
      for (const r of reconRows.slice(0, 5)) {
        fail(`§1.3 recon ${r.venue_id.slice(0, 8)} ${r.business_date}: daily=${r.daily_net} hourly_sum=${r.hourly_sum} delta=${r.delta}`);
      }
    } else {
      ok(`§1.3 reconciliation: SUM(hourly) = daily for all ${reconRows.length === 0 ? 'checked' : reconRows.length} rows`);
    }

  } finally {
    client.release();
  }

  console.log('\n========================================');
  console.log(`GATE RESULT: ${passed} PASSED / ${failed} FAILED`);
  console.log('========================================\n');

  if (failed > 0) {
    console.error('SEED ABORTED: isolation gate failed — this DB must not be used for demo');
    process.exit(1);
  }
  return { passed, failed };
}

// ============================================================
// Main
// ============================================================

export async function seedDemoV2() {
  const config = loadConfig();
  const pool = initDb(config);
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // 1. Base seed (client 001, venue 002, 28 primary staff)
  const base = await seedStewardDemo();
  if (base.skipped) {
    console.log('Base seed already present — extending');
  } else {
    console.log(`Base seed applied: ${base.staffCount} primary staff`);
  }
  const dutyMgrStaffId = base.idMap.get('STW-003')?.staffId;

  // 2. Decoy tenant — all rows written under DECOY_CLIENT_ID context (satisfies I2)
  // mise_app has INSERT on clients + venues; WITH CHECK passes when client_id matches context.
  console.log('Seeding decoy tenant…');
  await withClientContext(DECOY_CLIENT_ID, async (q) => {
    await q(
      `INSERT INTO clients (client_id, client_name, white_label_name, status)
       VALUES ($1, 'ZZ_ISOLATION_DECOY (do not demo)', 'DECOY', 'active')
       ON CONFLICT (client_id) DO NOTHING`,
      [DECOY_CLIENT_ID],
    );
    await q(
      `INSERT INTO venues (venue_id, client_id, venue_name, state, timezone)
       VALUES ($1, $2, 'Decoy Venue', 'QLD', 'Australia/Brisbane')
       ON CONFLICT (client_id, venue_id) DO NOTHING`,
      [DECOY_VENUE_ID, DECOY_CLIENT_ID],
    );
    for (const date of ['2026-01-01', '2026-01-02', '2026-01-03']) {
      await q(
        `INSERT INTO revenue_daily
           (client_id, venue_id, business_date, gross_revenue_cents, net_revenue_cents, transaction_count, source)
         VALUES ($1, $2, $3, 512000, 493000, 44, 'seed')
         ON CONFLICT (client_id, venue_id, business_date, source) DO NOTHING`,
        [DECOY_CLIENT_ID, DECOY_VENUE_ID, date],
      );
      await q(
        `INSERT INTO labour_actuals_daily
           (client_id, venue_id, business_date, worked_hours, labour_cost_cents, source)
         VALUES ($1, $2, $3, 32.5, 88000, 'seed')
         ON CONFLICT (client_id, venue_id, business_date, source) DO NOTHING`,
        [DECOY_CLIENT_ID, DECOY_VENUE_ID, date],
      );
    }
  });
  console.log('Decoy tenant seeded');

  // 3. Demo tenant extension (all writes under CLIENT_ID context — I2)
  console.log('Seeding demo tenant extension…');
  await withClientContext(CLIENT_ID, async (q) => {
    await seedVenues(q);
    await seedCluster(q);
    await seedDesktopPersonas(q, passwordHash);
    await seedSiblingStaff(q, passwordHash);
    if (dutyMgrStaffId) await seedHandoverNote(q, dutyMgrStaffId);
    await seedEgmMachines(q);
    await seedPnlSummary(q);
  });
  console.log('Structural fixtures done (venues, cluster, staff, EGMs, handover, P&L)');

  // Revenue and labour (90d daily + 14d hourly) — outside single context for
  // multi-venue iteration; each insert is already scoped to CLIENT_ID
  console.log('Seeding revenue daily (90d × 4 venues)…');
  await withClientContext(CLIENT_ID, seedRevenueDailyAll);
  console.log('Seeding revenue hourly (14d × 4 venues × 24h)…');
  await withClientContext(CLIENT_ID, seedRevenueHourlyAll);
  console.log('Seeding labour actuals (90d × 4 venues)…');
  await withClientContext(CLIENT_ID, seedLabourDailyAll);

  // 4. §1 isolation gate
  const gateResult = await runIsolationGate(pool);

  await pool.end();
  return gateResult;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemoV2()
    .then(({ passed, failed }) => {
      console.log(`\nDemo V2 seed complete. Gate: ${passed} passed / ${failed} failed.`);
      console.log(`Client: ${CLIENT_ID}`);
      console.log(`Primary venue: ${VENUE_002}`);
      console.log(`Sibling venues: ${VENUE_003}, ${VENUE_004}, ${VENUE_005}`);
      console.log(`Cluster: ${CLUSTER_ID}`);
      console.log(`Decoy client: ${DECOY_CLIENT_ID} (do not demo)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('seed-demo-v2 failed:', err.message);
      console.error(err.stack);
      process.exit(1);
    });
}
