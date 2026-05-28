/**
 * seed-runsheet-scene2.js — Demo seed for the rebuilt run sheet (MIS-639 / MIS-626 W3).
 *
 * Seeds all 9 sections of the Scene 2 (duty manager shift handover) run sheet for
 * The Steward Hotel demo venue. Idempotent via ON CONFLICT clauses.
 *
 * DESIGN: uses dynamic staff lookup (no hardcoded staff_ids for existing demo staff)
 * so this seed coexists cleanly with seed-steward-extras.js.
 *
 * Demo credential: dutymanager@steward.demo / mise-demo-2026
 *
 * Run:  node scripts/seed-runsheet-scene2.js
 * Env:  DB_CONNECTION_STRING (required)
 *       DEMO_CLIENT_ID (default: a0000000-0000-4000-8000-000000000001)
 *       DEMO_VENUE_ID  (default: a0000000-0000-4000-8000-000000000002)
 */

import { initDb, withClientContext, closeDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';

const CLIENT_ID = process.env.DEMO_CLIENT_ID || 'a0000000-0000-4000-8000-000000000001';
const VENUE_ID  = process.env.DEMO_VENUE_ID  || 'a0000000-0000-4000-8000-000000000002';

// Brisbane AEST UTC+10 — deterministic demo date
const BASE_DATE = new Date(Date.now() + 10 * 3600 * 1000).toISOString().slice(0, 10);

function bne(dayOffset, hh, mm = 0) {
  const d = new Date(`${BASE_DATE}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  const day = d.toISOString().slice(0, 10);
  return `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+10:00`;
}

// Deterministic UUIDs for scene2-exclusive entities (staff not in steward-extras)
const IDS = {
  // New scene2 staff (non-conflicting emails)
  riley:   'a0000000-0013-4000-8000-000000000001', // Supervisor
  alex:    'a0000000-0013-4000-8000-000000000002', // Bar Till 1
  charlie: 'a0000000-0013-4000-8000-000000000003', // Bar Till 2
  sam:     'a0000000-0013-4000-8000-000000000004', // Sports Bar
  morgan:  'a0000000-0013-4000-8000-000000000005', // Floor
  kerry:   'a0000000-0013-4000-8000-000000000006', // Gaming Attendant 2
  pat:     'a0000000-0013-4000-8000-000000000007', // TAB / Keno
  liam:    'a0000000-0013-4000-8000-000000000008', // Head Chef
  zara:    'a0000000-0013-4000-8000-000000000009', // Sous Chef
  dana:    'a0000000-0013-4000-8000-000000000010', // Kitchen Hand
  eli:     'a0000000-0013-4000-8000-000000000011', // Glassie
  nina:    'a0000000-0013-4000-8000-000000000012', // Food Runner

  // Shifts for scene2-exclusive staff
  shift_sup:    'a0000000-0014-4000-8000-000000000001',
  shift_bar1:   'a0000000-0014-4000-8000-000000000002',
  shift_bar2:   'a0000000-0014-4000-8000-000000000003',
  shift_sbar:   'a0000000-0014-4000-8000-000000000004',
  shift_floor:  'a0000000-0014-4000-8000-000000000005',
  shift_ga2:    'a0000000-0014-4000-8000-000000000006',
  shift_tab:    'a0000000-0014-4000-8000-000000000007',
  shift_hchef:  'a0000000-0014-4000-8000-000000000008',
  shift_sous:   'a0000000-0014-4000-8000-000000000009',
  shift_kh:     'a0000000-0014-4000-8000-000000000010',
  shift_glass:  'a0000000-0014-4000-8000-000000000011',
  shift_fr:     'a0000000-0014-4000-8000-000000000012',

  // Sports
  sport_nrl:  'a0000000-0015-4000-8000-000000000001',
  sport_afl:  'a0000000-0015-4000-8000-000000000002',
  screen1:    'a0000000-0016-4000-8000-000000000001',
  screen2:    'a0000000-0016-4000-8000-000000000002',

  // Specials + 86
  special_brisket: 'a0000000-0017-4000-8000-000000000001',
  special_barra:   'a0000000-0017-4000-8000-000000000002',
  eighty6_cheese:  'a0000000-0018-4000-8000-000000000001',
  eighty6_stout:   'a0000000-0018-4000-8000-000000000002',

  // Incentive
  incentive_roast: 'a0000000-0019-4000-8000-000000000001',

  // Prior shift handover (yesterday's DM shift)
  prior_shift: 'a0000000-0014-4000-8000-000000000020',

  // Certs
  cert_marcus_rsg: 'a0000000-001a-4000-8000-000000000001',
  cert_kerry_rsg:  'a0000000-001a-4000-8000-000000000002',
};

async function main() {
  const config = loadConfig();
  initDb(config);

  await withClientContext(CLIENT_ID, async (q) => {
    console.log('[scene2-seed] seeding run sheet data for venue', VENUE_ID);

    // ── Lookup existing demo staff by email ──────────────────────────────
    // seed-steward-extras.js inserts the DM (dutymanager@steward.demo) and
    // marcus.forsyth@steward.demo. We look them up so our data references
    // the real staff_ids and doesn't conflict on email uniqueness.
    const { rows: existingStaff } = await q(
      `SELECT staff_id, email FROM staff
        WHERE venue_id = $1 AND deleted_at IS NULL`,
      [VENUE_ID],
    );
    const byEmail = Object.fromEntries(existingStaff.map((r) => [r.email, r.staff_id]));

    const dmId     = byEmail['dutymanager@steward.demo'];
    const marcusId = byEmail['marcus.forsyth@steward.demo'];

    if (!dmId) {
      console.warn('[scene2-seed] WARNING: dutymanager@steward.demo not found — seed-steward-extras.js may not have run yet');
    }

    // ── Venue roles ──────────────────────────────────────────────────────
    const roles = [
      ['Manager on Duty',    'management', false, false, 0],
      ['Supervisor',         'management', false, false, 1],
      ['Till 1',             'bar_foh',    false, true,  10],
      ['Till 2',             'bar_foh',    false, true,  11],
      ['Sports Bar',         'bar_foh',    false, true,  12],
      ['Floor',              'bar_foh',    false, true,  13],
      ['Food Runner',        'bar_foh',    false, false, 14],
      ['Glassie',            'bar_foh',    false, false, 15],
      ['Gaming Attendant',   'gaming',     true,  false, 20],
      ['TAB / Keno Operator','gaming',     false, false, 21],
      ['Head Chef',          'kitchen',    false, false, 30],
      ['Sous Chef',          'kitchen',    false, false, 31],
      ['Kitchen Hand',       'kitchen',    false, false, 32],
      ['Duty Manager',       'management', false, false, 2],
    ];
    for (const [label, area_group, is_rsg_required, is_rsa_required, sort_order] of roles) {
      await q(
        `INSERT INTO venue_roles (client_id, venue_id, label, area_group, is_rsg_required, is_rsa_required, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (venue_id, label) DO UPDATE
           SET area_group = EXCLUDED.area_group,
               is_rsg_required = EXCLUDED.is_rsg_required,
               is_rsa_required = EXCLUDED.is_rsa_required`,
        [CLIENT_ID, VENUE_ID, label, area_group, is_rsg_required, is_rsa_required, sort_order],
      );
    }
    console.log('[scene2-seed] venue roles seeded');

    // ── Weather cache ──────────────────────────────────────────────────────
    await q(
      `INSERT INTO weather_cache (client_id, venue_id, cached_date, temperature_c, condition_label, trade_note)
       VALUES ($1, $2, $3::date, $4, $5, $6)
       ON CONFLICT (venue_id, cached_date) DO UPDATE
         SET temperature_c = EXCLUDED.temperature_c,
             condition_label = EXCLUDED.condition_label`,
      [CLIENT_ID, VENUE_ID, BASE_DATE, 28.0, 'Partly Cloudy', 'Beer garden tradeable'],
    );
    console.log('[scene2-seed] weather cache seeded');

    // ── New scene2 staff (non-conflicting emails) ────────────────────────
    const newStaff = [
      [IDS.riley,   'Riley',   'Santos',  5, 'Supervisor',          'riley.santos@steward.demo'],
      [IDS.alex,    'Alex',    'Kim',     5, 'Till 1',              'alex.kim@steward.demo'],
      [IDS.charlie, 'Charlie', 'Nguyen',  5, 'Till 2',              'charlie.nguyen@steward.demo'],
      [IDS.sam,     'Sam',     'Okafor',  5, 'Sports Bar',          'sam.okafor@steward.demo'],
      [IDS.morgan,  'Morgan',  'Park',    5, 'Floor',               'morgan.park@steward.demo'],
      [IDS.kerry,   'Kerry',   'Walsh',   7, 'Gaming Attendant',    'kerry.walsh@steward.demo'],
      [IDS.pat,     'Pat',     'Liu',     7, 'TAB / Keno Operator', 'pat.liu@steward.demo'],
      [IDS.liam,    'Liam',    'Torres',  5, 'Head Chef',           'liam.torres@steward.demo'],
      [IDS.zara,    'Zara',    'Brown',   5, 'Sous Chef',           'zara.brown@steward.demo'],
      [IDS.dana,    'Dana',    'Jones',   5, 'Kitchen Hand',        'dana.jones@steward.demo'],
      [IDS.eli,     'Eli',     'Chen',    5, 'Glassie',             'eli.chen@steward.demo'],
      [IDS.nina,    'Nina',    'Patel',   5, 'Food Runner',         'nina.patel@steward.demo'],
    ];
    for (const [sid, fn, ln, tier, role, email] of newStaff) {
      await q(
        `INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name, email, role_tier, role_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (staff_id) DO UPDATE
           SET first_name = EXCLUDED.first_name,
               last_name  = EXCLUDED.last_name,
               role_tier  = EXCLUDED.role_tier,
               role_name  = EXCLUDED.role_name`,
        [sid, CLIENT_ID, VENUE_ID, fn, ln, email, tier, role],
      ).catch(() => {
        // If unique email constraint fires (seed ran before), just skip — staff already exists
      });
    }
    console.log('[scene2-seed] scene2 staff seeded');

    // ── Shifts for today ──────────────────────────────────────────────────
    const shiftData = [
      [IDS.shift_sup,   IDS.riley,   'Supervisor',          bne(0, 17), bne(1, 0)],
      [IDS.shift_bar1,  IDS.alex,    'Till 1',              bne(0, 16), bne(1, 0)],
      [IDS.shift_bar2,  IDS.charlie, 'Till 2',              bne(0, 17), bne(1, 1)],
      [IDS.shift_sbar,  IDS.sam,     'Sports Bar',          bne(0, 16), bne(1, 0)],
      [IDS.shift_floor, IDS.morgan,  'Floor',               bne(0, 17), bne(1, 0)],
      [IDS.shift_ga2,   IDS.kerry,   'Gaming Attendant',    bne(0, 18), bne(1, 0)],
      [IDS.shift_tab,   IDS.pat,     'TAB / Keno Operator', bne(0, 16), bne(1, 0)],
      [IDS.shift_hchef, IDS.liam,    'Head Chef',           bne(0, 14), bne(0, 23)],
      [IDS.shift_sous,  IDS.zara,    'Sous Chef',           bne(0, 14), bne(0, 23)],
      [IDS.shift_kh,    IDS.dana,    'Kitchen Hand',        bne(0, 16), bne(0, 23)],
      [IDS.shift_glass, IDS.eli,     'Glassie',             bne(0, 18), bne(1, 0)],
      [IDS.shift_fr,    IDS.nina,    'Food Runner',         bne(0, 17), bne(0, 23)],
    ];
    for (const [shid, stid, rname, sstart, send] of shiftData) {
      await q(
        `INSERT INTO shifts (shift_id, client_id, venue_id, staff_id, role_name, shift_start, shift_end, status, source)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, 'active', 'manual')
         ON CONFLICT (shift_id) DO UPDATE
           SET shift_start = EXCLUDED.shift_start, shift_end = EXCLUDED.shift_end, status = EXCLUDED.status`,
        [shid, CLIENT_ID, VENUE_ID, stid, rname, sstart, send],
      );
    }

    // MoD break 21:30–22:00 — need the DM's actual shift_id from today
    if (dmId) {
      const { rows: [dmShift] } = await q(
        `SELECT shift_id FROM shifts
          WHERE staff_id = $1 AND venue_id = $2
            AND shift_start >= $3::timestamptz
            AND shift_start < $3::timestamptz + INTERVAL '1 day'
            AND deleted_at IS NULL
          ORDER BY shift_start DESC LIMIT 1`,
        [dmId, VENUE_ID, `${BASE_DATE}T00:00:00+10:00`],
      );
      if (dmShift) {
        await q(
          `INSERT INTO roster_breaks (client_id, shift_id, break_start, break_end)
           VALUES ($1, $2, $3::timestamptz, $4::timestamptz)
           ON CONFLICT (shift_id, break_start) DO NOTHING`,
          [CLIENT_ID, dmShift.shift_id, bne(0, 21, 30), bne(0, 22, 0)],
        );
      }
    }
    console.log('[scene2-seed] shifts seeded');

    // ── Staff certifications ─────────────────────────────────────────────
    // certifications table (migration 003): cert_id, staff_id, cert_type, issued_at, expires_at, status
    // Marcus Forsyth: RSG expiring in 7 days (amber)
    const rsgExpiry7d = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const rsgOk1yr   = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const issued2yr   = new Date(Date.now() - 730 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    if (marcusId) {
      await q(
        `INSERT INTO certifications (cert_id, client_id, staff_id, cert_type, issued_at, expires_at, status)
         VALUES ($1, $2, $3, 'rsg', $4::timestamptz, $5::timestamptz, 'expiring_soon')
         ON CONFLICT (cert_id) DO UPDATE
           SET expires_at = EXCLUDED.expires_at, status = EXCLUDED.status`,
        [IDS.cert_marcus_rsg, CLIENT_ID, marcusId, issued2yr, rsgExpiry7d],
      );
    }
    // Kerry Walsh: RSG ok (1 year)
    await q(
      `INSERT INTO certifications (cert_id, client_id, staff_id, cert_type, issued_at, expires_at, status)
       VALUES ($1, $2, $3, 'rsg', $4::timestamptz, $5::timestamptz, 'current')
       ON CONFLICT (cert_id) DO UPDATE
         SET expires_at = EXCLUDED.expires_at, status = EXCLUDED.status`,
      [IDS.cert_kerry_rsg, CLIENT_ID, IDS.kerry, issued2yr, rsgOk1yr],
    );
    console.log('[scene2-seed] certifications seeded');

    // ── Sports events + screens ──────────────────────────────────────────
    await q(
      `INSERT INTO sports_events (event_id, client_id, venue_id, event_date, event_name, teams, competition, start_time, channel_label, is_sound_on, crowd_impact)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8::time, $9, $10, $11)
       ON CONFLICT (event_id) DO UPDATE
         SET event_name = EXCLUDED.event_name, teams = EXCLUDED.teams, is_sound_on = EXCLUDED.is_sound_on`,
      [IDS.sport_nrl, CLIENT_ID, VENUE_ID, BASE_DATE, 'NRL', 'Broncos vs Cowboys', 'NRL', '19:50', 'Fox Sports 502', true, 'high'],
    );
    await q(
      `INSERT INTO sports_events (event_id, client_id, venue_id, event_date, event_name, teams, competition, start_time, channel_label, is_sound_on, crowd_impact)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8::time, $9, $10, $11)
       ON CONFLICT (event_id) DO UPDATE
         SET event_name = EXCLUDED.event_name, teams = EXCLUDED.teams, is_sound_on = EXCLUDED.is_sound_on`,
      [IDS.sport_afl, CLIENT_ID, VENUE_ID, BASE_DATE, 'AFL', 'Brisbane Lions vs Gold Coast', 'AFL', '17:10', 'Fox Footy 504', false, 'medium'],
    );
    await q(
      `INSERT INTO venue_screens (screen_id, client_id, venue_id, screen_label, zone_label, current_event_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (venue_id, screen_label) DO UPDATE
         SET current_event_id = EXCLUDED.current_event_id`,
      [IDS.screen1, CLIENT_ID, VENUE_ID, 'Sports Bar Main', 'Sports Bar', IDS.sport_nrl],
    );
    await q(
      `INSERT INTO venue_screens (screen_id, client_id, venue_id, screen_label, zone_label, current_event_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (venue_id, screen_label) DO UPDATE
         SET current_event_id = EXCLUDED.current_event_id`,
      [IDS.screen2, CLIENT_ID, VENUE_ID, 'Sports Bar 2', 'Sports Bar', IDS.sport_afl],
    );
    console.log('[scene2-seed] sports events seeded');

    // ── Chef specials ────────────────────────────────────────────────────
    await q(
      `INSERT INTO chef_specials (special_id, client_id, venue_id, service_date, service, dish_name, description, price_cents, allergen_tags, available_count, is_pushed)
       VALUES ($1, $2, $3, $4::date, 'dinner', $5, $6, $7, $8::jsonb, $9, $10)
       ON CONFLICT (special_id) DO UPDATE
         SET dish_name = EXCLUDED.dish_name, available_count = EXCLUDED.available_count`,
      [IDS.special_brisket, CLIENT_ID, VENUE_ID, BASE_DATE,
       'Brisket Burger', 'Slow-smoked brisket, pickled jalapeños, brioche bun', 2800,
       '["GF"]', 12, true],
    );
    await q(
      `INSERT INTO chef_specials (special_id, client_id, venue_id, service_date, service, dish_name, description, price_cents, allergen_tags, available_count, is_pushed)
       VALUES ($1, $2, $3, $4::date, 'dinner', $5, $6, $7, $8::jsonb, $9, $10)
       ON CONFLICT (special_id) DO UPDATE
         SET dish_name = EXCLUDED.dish_name, available_count = EXCLUDED.available_count`,
      [IDS.special_barra, CLIENT_ID, VENUE_ID, BASE_DATE,
       'Pan-fried Barramundi', 'Lemon butter, capers, seasonal greens', 3400,
       '["DF"]', 8, false],
    );

    // ── 86 list ──────────────────────────────────────────────────────────
    await q(
      `INSERT INTO eighty_six_items (item_id, client_id, venue_id, service_date, category, item_name, reason)
       VALUES ($1, $2, $3, $4::date, 'kitchen', 'Cheese Platter', 'No brie delivery today')
       ON CONFLICT (item_id) DO NOTHING`,
      [IDS.eighty6_cheese, CLIENT_ID, VENUE_ID, BASE_DATE],
    );
    await q(
      `INSERT INTO eighty_six_items (item_id, client_id, venue_id, service_date, category, item_name, reason)
       VALUES ($1, $2, $3, $4::date, 'bar', 'Coopers Stout Tap', 'Keg blew at 6pm')
       ON CONFLICT (item_id) DO NOTHING`,
      [IDS.eighty6_stout, CLIENT_ID, VENUE_ID, BASE_DATE],
    );
    console.log('[scene2-seed] specials + 86 seeded');

    // ── Shift incentive ──────────────────────────────────────────────────
    await q(
      `INSERT INTO shift_incentives (incentive_id, client_id, venue_id, name, target_description, reward_description, active_from, active_to, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, true)
       ON CONFLICT (incentive_id) DO UPDATE
         SET name = EXCLUDED.name, is_active = true,
             active_from = EXCLUDED.active_from,
             active_to = EXCLUDED.active_to`,
      [IDS.incentive_roast, CLIENT_ID, VENUE_ID,
       'Sunday Roast Push',
       'Push table d\'hôte to every table — aim for 60% conversion tonight',
       '$50 gift card for highest conversion — tracked by till',
       bne(-1, 0), bne(3, 0)],
    );
    const leaderboard = [
      [IDS.alex,    7],
      [IDS.riley,   5],
      [IDS.charlie, 4],
    ];
    for (const [stid, score] of leaderboard) {
      await q(
        `INSERT INTO incentive_scores (client_id, incentive_id, staff_id, score)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (incentive_id, staff_id) DO UPDATE SET score = EXCLUDED.score`,
        [CLIENT_ID, IDS.incentive_roast, stid, score],
      );
    }
    console.log('[scene2-seed] incentive + leaderboard seeded');

    // ── Shift priorities + handover — need the DM's actual shift_id ──────
    if (dmId) {
      const { rows: [dmShift] } = await q(
        `SELECT shift_id FROM shifts
          WHERE staff_id = $1 AND venue_id = $2
            AND shift_start >= $3::timestamptz
            AND shift_start < $3::timestamptz + INTERVAL '1 day'
            AND deleted_at IS NULL
          ORDER BY shift_start DESC LIMIT 1`,
        [dmId, VENUE_ID, `${BASE_DATE}T00:00:00+10:00`],
      );
      if (dmShift) {
        const dmShiftId = dmShift.shift_id;
        await q(
          `INSERT INTO shift_priorities (client_id, venue_id, shift_id, priority_order, body)
           VALUES ($1, $2, $3, 1, $4), ($1, $2, $3, 2, $5)
           ON CONFLICT (shift_id, priority_order) DO UPDATE SET body = EXCLUDED.body`,
          [CLIENT_ID, VENUE_ID, dmShiftId,
           'New gaming promo starts 8pm — brief all GAs at 7:45pm',
           'Bachelorette party — Function Rm 2, arrives 9pm, check setup by 8:30pm'],
        );
      } else {
        console.warn('[scene2-seed] WARNING: no DM shift found for today — priorities/handover skipped');
      }
    }
    console.log('[scene2-seed] shift priorities seeded');

    // ── Budget targets (revenue_daily_budgets, migration 038) ─────────────
    const budgets = [
      ['gaming',       1800000],
      ['bar',           950000],
      ['food',         1400000],
      ['tab_keno',      280000],
      ['bottle_shop',   750000],
    ];
    for (const [channel, cents] of budgets) {
      await q(
        `INSERT INTO revenue_daily_budgets (client_id, venue_id, trade_date, channel, budget_cents)
         VALUES ($1, $2, $3::date, $4, $5)
         ON CONFLICT (client_id, venue_id, trade_date, channel) DO UPDATE
           SET budget_cents = EXCLUDED.budget_cents`,
        [CLIENT_ID, VENUE_ID, BASE_DATE, channel, cents],
      );
    }

    // Revenue actuals by channel (powers budget progress bars)
    // Using ~70% progress to show a live evening shift mid-trade
    const actuals = [
      ['gaming',       1350000], // ~75%
      ['bar',           610000], // ~64%
      ['food',          980000], // ~70%
      ['tab_keno',      185000], // ~66%
      ['bottle_shop',   530000], // ~71%
    ];
    for (const [channel, net] of actuals) {
      await q(
        `INSERT INTO revenue_daily (client_id, venue_id, business_date, gross_revenue_cents, net_revenue_cents, channel, source)
         VALUES ($1, $2, $3::date, $4, $4, $5, 'seed')
         ON CONFLICT ON CONSTRAINT revenue_daily_scope_channel_key DO UPDATE
           SET net_revenue_cents = EXCLUDED.net_revenue_cents,
               gross_revenue_cents = EXCLUDED.gross_revenue_cents,
               updated_at = now()`,
        [CLIENT_ID, VENUE_ID, BASE_DATE, net, channel],
      );
    }

    // Labour actuals for gaming labour % (12.4% of $18k net RTV = ~$2,232)
    await q(
      `INSERT INTO labour_actuals_daily (client_id, venue_id, business_date, worked_hours, labour_cost_cents, source)
       VALUES ($1, $2, $3::date, 76.5, 223200, 'seed')
       ON CONFLICT (client_id, venue_id, business_date, source) DO UPDATE
         SET labour_cost_cents = EXCLUDED.labour_cost_cents,
             worked_hours = EXCLUDED.worked_hours`,
      [CLIENT_ID, VENUE_ID, BASE_DATE],
    );
    console.log('[scene2-seed] budget targets seeded');

    // ── Prior shift handover note ─────────────────────────────────────────
    // Seed a prior shift and handover note so the incoming note section renders
    if (dmId) {
      const priorStart = bne(-1, 16, 0);
      const priorEnd   = bne(0, 0, 0);
      await q(
        `INSERT INTO shifts (shift_id, client_id, venue_id, staff_id, role_name, shift_start, shift_end, status, source)
         VALUES ($1, $2, $3, $4, 'Manager on Duty', $5::timestamptz, $6::timestamptz, 'completed', 'manual')
         ON CONFLICT (shift_id) DO NOTHING`,
        [IDS.prior_shift, CLIENT_ID, VENUE_ID, dmId, priorStart, priorEnd],
      );
      await q(
        `INSERT INTO shift_handover_notes (client_id, venue_id, shift_id, author_staff_id, body_text, tags, is_locked)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, true)
         ON CONFLICT (shift_id) DO UPDATE
           SET body_text = EXCLUDED.body_text, tags = EXCLUDED.tags, is_locked = true`,
        [CLIENT_ID, VENUE_ID, IDS.prior_shift, dmId,
         'EGM #34 went down at 9:15pm — tech called, expected tomorrow AM. Floor safe at $0.\n\nOne RG interaction: patron at machine 22, observed for 40 min, attendant approached, patron self-referred to Break Even. Incident logged (INC-2026-0524-01).\n\nBar fridge 2 running warm — check before service, call Cool Room Direct if still warm (0412 xxx xxx).',
         '["equipment_fault","patron_note","follow_up_required"]'],
      );
      console.log('[scene2-seed] prior handover note seeded');
    }

    console.log('[scene2-seed] ✓ all scene 2 run sheet data seeded');
    console.log('');
    console.log('Demo credential: dutymanager@steward.demo / mise-demo-2026');
  });

  await closeDb();
}

main().catch((err) => {
  console.error('[scene2-seed] ERROR:', err.message);
  process.exit(1);
});
