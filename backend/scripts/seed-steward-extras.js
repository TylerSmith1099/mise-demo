/**
 * Steward Hotel demo extras seed — shifts, runsheet items, venue gaming config,
 * and pnl_summary for the seeded Steward Hotel account (MIS-253).
 *
 * Idempotent: skips if the venue already has shifts seeded.
 * Run after src/demo/seed.js which seeds staff/logins.
 *
 * DEMO_CLIENT_ID / DEMO_VENUE_ID must match values used by src/demo/seed.js.
 */

import { initDb, withClientContext, closeDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { daysFromNow } from '../src/integrations/mock/workforce.js';

const DEMO_CLIENT_ID = process.env.DEMO_CLIENT_ID || 'a0000000-0000-4000-8000-000000000001';
const DEMO_VENUE_ID  = process.env.DEMO_VENUE_ID  || 'a0000000-0000-4000-8000-000000000002';

// Brisbane local date anchored at boot (UTC+10, no DST).
const BASE_DATE = new Date(Date.now() + 10 * 3600 * 1000).toISOString().slice(0, 10);

function addDays(base, n) {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Return an ISO timestamp for Brisbane local time on (BASE_DATE + dayOffset) at hh:mm.
// dayOffset=1 with hh=0 gives midnight the next day (for overnight shifts).
function bne(dayOffset, hh, mm = 0) {
  const day = addDays(BASE_DATE, dayOffset);
  return `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+10:00`;
}

async function main() {
  const config = loadConfig();
  initDb(config);
  const clientId = DEMO_CLIENT_ID;
  const venueId  = DEMO_VENUE_ID;

  await withClientContext(clientId, async (q) => {
    // Always ensure venue config is correct — idempotent, runs on every boot.
    // venue_address is required by the first-aid emergency gate (MIS-391).
    await q(
      `UPDATE venues
          SET gaming_min_attendants = 2,
              egm_count             = 45,
              venue_address         = COALESCE(venue_address, '47 Caxton Street, Petrie Terrace QLD 4000')
        WHERE venue_id = $1`,
      [venueId],
    );

    // Retire any open gaming_understaffing events from a prior shift — they contain
    // a stale roster snapshot and will show wrong numbers after a reseed (MIS-304).
    await q(
      `UPDATE compliance_events SET deleted_at = NOW()
         WHERE venue_id = $1 AND event_type = 'gaming_understaffing'
           AND acknowledged_at IS NULL AND deleted_at IS NULL`,
      [venueId],
    );

    // Date-aware idempotency: skip only if today's (BASE_DATE, Brisbane) shifts exist.
    // If shifts exist but are from a prior calendar day, delete them and reseed for today.
    // This is the fix for the BASE_DATE drift bug (MIS-262 / MIS-78): the extras seed
    // previously skipped on any existing shifts, leaving yesterday's timestamps in the DB
    // and causing "0 on now" / empty gaming floor on day N+1.
    const tomorrow = addDays(BASE_DATE, 1);
    const { rows: todayCheck } = await q(
      `SELECT 1 FROM shifts WHERE venue_id = $1
       AND shift_start >= $2::timestamptz AND shift_start < $3::timestamptz
       AND deleted_at IS NULL LIMIT 1`,
      [venueId, `${BASE_DATE}T00:00:00+10:00`, `${tomorrow}T00:00:00+10:00`],
    );
    if (todayCheck.length) {
      console.log(`[extras-seed] today's shifts (${BASE_DATE}) already seeded — skipping`);
      return;
    }
    // No shifts for today → soft-delete stale data from a previous calendar day.
    // mise_app has SELECT/INSERT/UPDATE only (no DELETE); use deleted_at for purges.
    const { rowCount: rDeleted } = await q(
      `UPDATE runsheet_items SET deleted_at = NOW() WHERE client_id = $1 AND deleted_at IS NULL`,
      [clientId],
    );
    const { rowCount: sDeleted } = await q(
      `UPDATE shifts SET deleted_at = NOW() WHERE venue_id = $1 AND deleted_at IS NULL`,
      [venueId],
    );
    await q(
      `UPDATE pnl_summary SET deleted_at = NOW() WHERE venue_id = $1 AND deleted_at IS NULL`,
      [venueId],
    );
    if (sDeleted > 0) {
      console.log(`[extras-seed] soft-deleted ${sDeleted} stale shifts + ${rDeleted} runsheet items — reseeding for ${BASE_DATE}`);
    }

    // Look up all staff for this venue by email.
    const { rows: staffRows } = await q(
      `SELECT staff_id, email FROM staff WHERE venue_id = $1 AND deleted_at IS NULL`,
      [venueId],
    );
    const byEmail = Object.fromEntries(staffRows.map((r) => [r.email, r.staff_id]));

    function sid(email) {
      const id = byEmail[email];
      if (!id) throw new Error(`Staff not found: ${email} — ensure src/demo/seed.js ran first`);
      return id;
    }

    // Demo account staff IDs (deterministic emails from src/demo/seed.js).
    const dmId     = sid('dutymanager@steward.demo');  // James Kovacs
    const venMgrId = sid('manager@steward.demo');      // Rachel Drummond
    const sarahId  = sid('gaming@steward.demo');       // Sarah Chen (STW-011)
    const marcusId = sid('marcus.forsyth@steward.demo');   // Marcus Forsyth (RG lapsed)
    const liamId   = sid('liam.oconnor@steward.demo');
    const chloeId  = sid('chloe.nguyen@steward.demo');
    const mateoId  = sid('mateo.rossi@steward.demo');
    const gordonId = sid('gordon.mehta@steward.demo');
    const sokhaId  = sid('sokha.pich@steward.demo');
    const avaId    = sid('ava.thompson@steward.demo');
    const islaId   = sid('isla.murray@steward.demo');

    // Helper: insert a shift and return its shift_id.
    async function insertShift({ staffId, role, dept, dayOffset, startH, startM = 0, endH, endM = 0, status, rate, crossMidnight = false }) {
      const start = bne(dayOffset, startH, startM);
      const end   = crossMidnight ? bne(dayOffset + 1, endH, endM) : bne(dayOffset, endH, endM);
      const hours = crossMidnight
        ? (24 - startH - startM / 60) + endH + endM / 60
        : (endH - startH) + (endM - startM) / 60;
      const labour = Math.round(hours * rate * 100) / 100;
      const { rows } = await q(
        `INSERT INTO shifts (client_id, venue_id, staff_id, role_name, shift_start, shift_end,
                             status, source, department, hourly_rate, labour_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9,$10)
         RETURNING shift_id`,
        [clientId, venueId, staffId, role, start, end, status, dept, rate, labour],
      );
      return rows[0].shift_id;
    }

    // -------------------------------------------------------------------------
    // DAY 0 — TODAY: active shifts for demo (DM shift + gaming understaffing)
    // -------------------------------------------------------------------------

    // DM evening shift: 16:00–00:00 next day, active (runsheet attached below).
    const dmShiftId = await insertShift({
      staffId: dmId, role: 'Duty Manager', dept: 'management',
      dayOffset: 0, startH: 16, endH: 0, crossMidnight: true,
      status: 'active', rate: 41.50,
    });

    // Gaming floor tonight: Sarah Chen + Marcus Forsyth both active.
    // Two attendants ≥ venue min 2 → the understaffing check does NOT fire.
    // The Scene 3 hero is the RG-cert-lapse (Marcus's cert lapsed 3 days ago,
    // but he is still rostered on the floor — that is the compliance breach).
    await insertShift({
      staffId: sarahId, role: 'Gaming Attendant', dept: 'gaming',
      dayOffset: 0, startH: 11, startM: 30, endH: 23,
      status: 'active', rate: 28.40,
    });
    // Marcus Forsyth — RG cert lapsed, still on gaming floor (M030–M045).
    await insertShift({
      staffId: marcusId, role: 'Gaming Attendant', dept: 'gaming',
      dayOffset: 0, startH: 16, endH: 23,
      status: 'active', rate: 28.40,
    });

    // Lunch service shifts (completed)
    const lunchDone = [
      [liamId,   'Bar Attendant',        'beverage', 11, 30, 15, 0,  28.40],
      [gordonId, 'Head Chef',            'food',     10, 0,  15, 30, 42.00],
      [avaId,    'Waiter / Floor Staff', 'food',     11, 0,  15, 0,  30.80],
    ];
    for (const [staffId, role, dept, sh, sm, eh, em, rate] of lunchDone) {
      await insertShift({ staffId, role, dept, dayOffset: 0, startH: sh, startM: sm, endH: eh, endM: em, status: 'completed', rate });
    }

    // -------------------------------------------------------------------------
    // DAYS 1–6 — scheduled roster (Mon–Sun service windows)
    // -------------------------------------------------------------------------
    for (let day = 1; day <= 6; day++) {
      // Day-of-week for (BASE_DATE + day): Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6.
      const dow = (new Date(`${BASE_DATE}T12:00:00+10:00`).getDay() + day) % 7;
      const isWeekend = dow === 0 || dow >= 5; // Fri=5, Sat=6, Sun=0

      if (isWeekend) {
        // All-day service 11:30–20:30
        const allDay = [
          [sarahId,  'Gaming Attendant',       'gaming',    11, 30, 20, 30, 28.40],
          [marcusId, 'Gaming Attendant',        'gaming',    11, 30, 20, 30, 28.40],
          [liamId,   'Bar Attendant',           'beverage',  11, 30, 20, 30, 28.40],
          [chloeId,  'Bar Attendant',           'beverage',  11, 30, 20, 30, 28.40],
          [mateoId,  'Bar Attendant',           'beverage',  11, 30, 20, 30, 36.20],
          [gordonId, 'Head Chef',               'food',      10, 0,  20, 30, 42.00],
          [sokhaId,  'Kitchen Hand',            'food',      11, 0,  20, 30, 28.50],
          [avaId,    'Waiter / Floor Staff',    'food',      11, 30, 20, 30, 30.80],
          [islaId,   'Waiter / Floor Staff',    'food',      11, 30, 20, 30, 30.80],
          [dmId,     'Duty Manager',            'management',14, 0,  20, 30, 41.50],
        ];
        for (const [staffId, role, dept, sh, sm, eh, em, rate] of allDay) {
          await insertShift({ staffId, role, dept, dayOffset: day, startH: sh, startM: sm, endH: eh, endM: em, status: 'scheduled', rate });
        }
      } else {
        // Mon-Thu: Lunch 11:30–15:00 + Dinner 17:00–20:30
        const lunch = [
          [sarahId,  'Gaming Attendant',       'gaming',    11, 30, 15, 0,  28.40],
          [marcusId, 'Gaming Attendant',        'gaming',    11, 30, 15, 0,  28.40],
          [liamId,   'Bar Attendant',           'beverage',  11, 30, 15, 0,  28.40],
          [gordonId, 'Head Chef',               'food',      10, 0,  15, 30, 42.00],
          [avaId,    'Waiter / Floor Staff',    'food',      11, 30, 15, 0,  30.80],
        ];
        const dinner = [
          [marcusId, 'Gaming Attendant',        'gaming',    17, 0,  20, 30, 28.40],
          [chloeId,  'Bar Attendant',           'beverage',  17, 0,  20, 30, 28.40],
          [mateoId,  'Bar Attendant',           'beverage',  17, 0,  20, 30, 36.20],
          [sokhaId,  'Kitchen Hand',            'food',      17, 0,  20, 30, 28.50],
          [islaId,   'Waiter / Floor Staff',    'food',      17, 0,  20, 30, 30.80],
          [dmId,     'Duty Manager',            'management',16, 0,  21, 0,  41.50],
        ];
        for (const [staffId, role, dept, sh, sm, eh, em, rate] of [...lunch, ...dinner]) {
          await insertShift({ staffId, role, dept, dayOffset: day, startH: sh, startM: sm, endH: eh, endM: em, status: 'scheduled', rate });
        }
      }
    }

    // -------------------------------------------------------------------------
    // RUNSHEET — DM's active shift (day 0, Scene 2)
    // Two tasks pre-completed by DM to show real progress; rest pending.
    // -------------------------------------------------------------------------
    const marcusRgExpiry = daysFromNow(-3);
    const marcusRgDaysAgo = Math.round(
      (Date.now() - new Date(`${marcusRgExpiry}T00:00:00`).getTime()) / 86_400_000,
    );
    const runsheet = [
      // [task, due_by, category, completedAt | null]
      ['Floor walk + RSA signage check at open',                    '16:30', 'compliance',  bne(0, 16, 25)],
      ['Confirm a second gaming attendant or restrict the floor',   '17:00', 'gaming',      null],
      ['Follow-up outcome note on the 15:10 RSA refusal',           '18:00', 'compliance',  null],
      ['Confirm technician ETA for EGM fault',                      '18:30', 'gaming',      null],
      [`Start Marcus Forsyth RG renewal (cert lapsed ${marcusRgDaysAgo} days ago)`,  '19:00', 'compliance',  null],
      ['Bar float + till spot-check',                               '20:00', 'bar',         bne(0, 19, 58)],
      ['Bottle shop close & reconcile',                             '22:00', 'open_close',  null],
      ['Gaming room clean-down + lock-up',                          '23:45', 'open_close',  null],
    ];
    for (let i = 0; i < runsheet.length; i++) {
      const [task, due, category, completedAt] = runsheet[i];
      await q(
        `INSERT INTO runsheet_items
           (client_id, shift_id, task_description, due_by, category,
            completed_at, completed_by, item_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [clientId, dmShiftId, task, due, category, completedAt, completedAt ? dmId : null, i],
      );
    }

    // -------------------------------------------------------------------------
    // STAFF DEPARTMENT + SHIFT STATUS
    // shift-summary-api queries staff.department (gaming-floor cover) and
    // staff.shift_status (on_now count). Neither is set by src/demo/seed.js, so
    // we update them here after every (re-)seed.
    // -------------------------------------------------------------------------
    await q(`
      UPDATE staff SET department = CASE
        WHEN role_name ILIKE '%gaming%'                                         THEN 'gaming'
        WHEN role_name ILIKE '%bar%'                                            THEN 'beverage'
        WHEN role_name ILIKE '%chef%' OR role_name ILIKE '%kitchen%'
          OR role_name ILIKE '%waiter%' OR role_name ILIKE '%bistro%'
          OR role_name ILIKE '%function%'                                       THEN 'food'
        WHEN role_name ILIKE '%bottle%'                                         THEN 'bottle_shop'
        ELSE 'management'
      END
      WHERE venue_id = $1 AND deleted_at IS NULL`, [venueId]);

    // Mark tonight's active roster as 'on'; everyone else 'rostered'.
    await q(
      `UPDATE staff SET shift_status = 'rostered' WHERE venue_id = $1 AND deleted_at IS NULL`,
      [venueId],
    );
    await q(
      `UPDATE staff SET shift_status = 'on'
       WHERE staff_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [[dmId, sarahId, marcusId, liamId, chloeId, mateoId, gordonId, sokhaId, avaId, islaId]],
    );

    // -------------------------------------------------------------------------
    // PNL SUMMARY — 7 trading days (for Reports screen, Scene Venue Manager)
    // Gaming: NET RTV basis (never meter turnover). Bar and food over benchmark
    // so the reports screen shows actionable flags.
    // -------------------------------------------------------------------------
    const period = `${BASE_DATE.slice(0, 7)} (7-day)`;
    const pnl = [
      // [dept, revenue, labourCost, netGamingRevenue, meterTurnover]
      ['beverage',    42_000,  12_600,  null,    null],
      ['food',        86_000,  18_800,  null,    null],
      ['gaming',     126_000,  16_450, 126_000, 1_800_000],
      ['bottle_shop', 52_000,   8_500,  null,    null],
    ];
    let totRev = 0, totLab = 0;
    for (const [dept, rev, lab, ng, meter] of pnl) {
      totRev += rev;
      totLab += lab;
      await q(
        `INSERT INTO pnl_summary
           (client_id, venue_id, period_label, department,
            revenue, labour_cost, labour_pct, net_gaming_revenue, meter_turnover)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [clientId, venueId, period, dept, rev, lab,
          Math.round((lab / rev) * 1000) / 10,
          ng !== null ? ng : null,
          meter !== null ? meter : null],
      );
    }
    await q(
      `INSERT INTO pnl_summary
         (client_id, venue_id, period_label, department, revenue, labour_cost, labour_pct)
       VALUES ($1,$2,$3,'total',$4,$5,$6)`,
      [clientId, venueId, period, totRev, totLab,
        Math.round((totLab / totRev) * 1000) / 10],
    );

    // -------------------------------------------------------------------------
    // REVENUE_DAILY + LABOUR_ACTUALS_DAILY — 7 trading days of demo data for
    // the Admin Desktop Homepage KPIs (MIS-430). Uses ON CONFLICT DO NOTHING
    // so the seed is safe to re-run once migrations 024/025 land.
    // Graceful: if the tables don't exist yet, the seed skips this block.
    // -------------------------------------------------------------------------
    try {
      const revBase   = 482_000; // ~$4,820 today (net, cents)
      const forecastBase = 510_000; // ~$5,100 forecast
      const labHoursBase = 42.0;
      const labCostBase  = 117_600; // 42 hrs × ~$28/hr avg (cents)
      const labBudget    = 44.0;

      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const d = new Date(BASE_DATE);
        d.setDate(d.getDate() - dayOffset);
        const bizDate = d.toISOString().slice(0, 10);
        // Vary revenue ±8% day-to-day so the chart isn't flat.
        const factor = 1 + (Math.sin(dayOffset * 1.7) * 0.08);
        const netRev  = Math.round(revBase * factor);
        const grossRev = Math.round(netRev * 1.1);
        const forecast = Math.round(forecastBase * (1 + (Math.sin(dayOffset * 0.9) * 0.04)));

        await q(
          `INSERT INTO revenue_daily
             (client_id, venue_id, business_date,
              gross_revenue_cents, net_revenue_cents,
              forecast_revenue_cents, source, is_stale, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,'seed',false,NOW())
           ON CONFLICT (client_id, venue_id, business_date, source) DO NOTHING`,
          [clientId, venueId, bizDate, grossRev, netRev, forecast],
        );

        const labHrs  = +(labHoursBase + (Math.sin(dayOffset * 1.3) * 2.5)).toFixed(2);
        const labCost = Math.round(labCostBase * (labHrs / labHoursBase));
        const budgetCost = Math.round(labCostBase * (labBudget / labHoursBase));

        await q(
          `INSERT INTO labour_actuals_daily
             (client_id, venue_id, business_date,
              worked_hours, labour_cost_cents,
              budgeted_hours, budgeted_cost_cents,
              source, is_stale, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'seed',false,NOW())
           ON CONFLICT (client_id, venue_id, business_date, source) DO NOTHING`,
          [clientId, venueId, bizDate, labHrs, labCost, labBudget, budgetCost],
        );
      }
      console.log('[extras-seed] revenue_daily + labour_actuals_daily seeded (7 days)');
    } catch (revLabErr) {
      if (revLabErr.code === '42P01') {
        console.warn('[extras-seed] revenue_daily/labour_actuals_daily not yet migrated — skipping');
      } else {
        console.warn('[extras-seed] revenue/labour seed warning:', revLabErr.message);
      }
    }

    console.log(`[extras-seed] done — shifts, runsheet, pnl_summary seeded for venue ${venueId}`);
  });

  await closeDb();
}

main().catch(async (err) => {
  console.error('[extras-seed] failed:', err.message);
  try { await closeDb(); } catch {}
  process.exit(1);
});
