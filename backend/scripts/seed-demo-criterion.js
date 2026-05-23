// =============================================================================
// MIS-26 Step 1 — Full product demo dataset for the Pinnacle Hotel Group
// client partition (The Criterion Hotel, Brisbane QLD).
//
// Builds a realistic, internally-consistent dataset that satisfies every demo
// criterion in MIS-26 / ceo-instructions.md:
//   * 13 staff across departments, employment type, RSA/RSG status, shift status
//   * one RSG cert expiring within 7 days (triggers Compliance Monitor Critical)
//   * a full 7-day costed roster, all departments covered each day
//   * one understaffed gaming evening shift TODAY (1 on floor, venue min 2)
//   * gaming weekly labour tracking ABOVE 12% of net gaming revenue (the DM flag)
//   * incident log: one RSA refusal (unacknowledged), one RG patron interaction,
//     one EGM malfunction
//   * a pre-seeded prior-shift handover note for the incoming Duty Manager
//   * 45 EGMs with varied weekly turnover (high vs low performers)
//   * a per-department monthly P&L with net gaming revenue separate from meter
//
// A second client ("Rival Taverns" / NSW) is seeded to keep the cross-client
// isolation story intact. All inserts run inside each client's RLS context.
//
// Run against a freshly-migrated DB:  node scripts/seed-demo-criterion.js
// =============================================================================

import { randomUUID } from 'node:crypto';
import { initDb, withClientContext, closeDb } from '../src/db.js';
import { hashPassword } from '../src/passwords.js';
import { loadConfig } from '../src/config.js';

// Brisbane is UTC+10 year-round (no DST). Build an ISO string with that offset
// so Postgres stores the correct UTC instant.
// Demo "today" — anchors ALL live timing: the active understaffed evening gaming
// shift (Scene 3), cert-expiry windows, and the handover note. It MUST track the
// real current date, or the seeded "tonight" shift drifts into the past and Scene 3
// stops firing (now() no longer falls inside the shift window). Defaults to the
// current Brisbane (UTC+10, no DST) calendar date; set MISE_DEMO_BASE_DATE=YYYY-MM-DD
// to pin it for a deterministic/dated demo.
const BASE_DATE = process.env.MISE_DEMO_BASE_DATE
  || new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString().slice(0, 10);
// Pure calendar-date arithmetic: add days to BASE_DATE without any timezone
// rollover (anchor at noon UTC so ±10h offsets never cross a date boundary).
function addDays(baseYmd, n) {
  const d = new Date(`${baseYmd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function bne(dayOffset, hh, mm = 0) {
  const day = addDays(BASE_DATE, dayOffset);
  const HH = String(hh).padStart(2, '0');
  const MM = String(mm).padStart(2, '0');
  return `${day}T${HH}:${MM}:00+10:00`; // Brisbane local time (UTC+10, no DST)
}
function dateOnly(dayOffset) {
  return addDays(BASE_DATE, dayOffset);
}
function daysFromNow(n) {
  const d = new Date(`${BASE_DATE}T12:00:00+10:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}

export async function seedCriterionDemo() {
  const defaultHash = await hashPassword('floor-1234');
  const dutyHash = await hashPassword('duty-5678');
  const venueHash = await hashPassword('venue-9012');

  const clientId = randomUUID();
  const venueId = randomUUID();

  // --- staff: [key, first, last, email, tier, role_name, dept, employ, rate, shiftStatus, hash]
  const staffDefs = [
    ['grace',  'Grace',  'Nguyen',  'grace@pinnacle.test',  7, 'Gaming Attendant', 'gaming',      'casual',    33.50, 'on',       defaultHash],
    ['marcus', 'Marcus', 'Polk',    'marcus@pinnacle.test', 7, 'Gaming Attendant', 'gaming',      'part_time', 31.20, 'rostered', defaultHash],
    ['hannah', 'Hannah', 'Yi',      'hannah@pinnacle.test', 7, 'Gaming Attendant', 'gaming',      'casual',    33.50, 'off',      defaultHash],
    ['ethan',  'Ethan',  'Ward',    'ethan@pinnacle.test',  7, 'Gaming Attendant', 'gaming',      'casual',    33.50, 'rostered', defaultHash],
    ['liam',   'Liam',   'Carter',  'liam@pinnacle.test',   7, 'Bar Attendant',    'beverage',    'casual',    32.10, 'on',       defaultHash],
    ['sophie', 'Sophie', 'Bell',    'sophie@pinnacle.test', 7, 'Bar Attendant',    'beverage',    'part_time', 30.40, 'rostered', defaultHash],
    ['olivia', 'Olivia', 'Grant',   'olivia@pinnacle.test', 6, 'Bar Supervisor',   'beverage',    'full_time', 36.00, 'on',       defaultHash],
    ['noah',   'Noah',   'Pearce',  'noah@pinnacle.test',   6, 'Chef',             'food',        'full_time', 38.20, 'on',       defaultHash],
    ['ava',    'Ava',    'Simmons', 'ava@pinnacle.test',    7, 'Bistro Attendant', 'food',        'casual',    30.90, 'rostered', defaultHash],
    ['jack',   'Jack',   'Mahoney', 'jack@pinnacle.test',   7, 'Bottle Shop Attendant', 'bottle_shop', 'casual', 31.00, 'off',    defaultHash],
    ['dan',    'Dan',    'Roberts', 'dan@pinnacle.test',    5, 'Duty Manager',     'management',  'full_time', 41.50, 'on',       dutyHash],
    ['mia',    'Mia',    'Fraser',  'mia@pinnacle.test',    5, 'Duty Manager',     'management',  'full_time', 41.50, 'off',      defaultHash],
    ['vera',   'Vera',   'Lawson',  'vera@pinnacle.test',   4, 'Venue Manager',    'management',  'full_time', 50.00, 'rostered', venueHash],
  ];

  const staff = {};
  for (const d of staffDefs) staff[d[0]] = randomUUID();

  await withClientContext(clientId, async (q) => {
    await q(
      `INSERT INTO clients (client_id, client_name, white_label_name)
       VALUES ($1, $2, $3)`,
      [clientId, 'Pinnacle Hotel Group', 'Pinnacle Assist'],
    );
    await q(
      `INSERT INTO venues (venue_id, client_id, venue_name, state, timezone,
                           gaming_min_attendants, egm_count)
       VALUES ($1, $2, 'The Criterion Hotel', 'QLD', 'Australia/Brisbane', 2, 45)`,
      [venueId, clientId],
    );

    // staff
    for (const d of staffDefs) {
      await q(
        `INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name,
                            email, role_tier, role_name, password_hash,
                            employment_type, base_hourly_rate, shift_status, department)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [staff[d[0]], clientId, venueId, d[1], d[2], d[3], d[4], d[5], d[10],
         d[7], d[8], d[9], d[6]],
      );
    }

    // --- certifications: RSA for all; RSG for gaming staff. -----------------
    // Marcus's RSG expires in 5 days -> Critical (within 7). Others current.
    const gamingKeys = ['grace', 'marcus', 'hannah', 'ethan'];
    for (const d of staffDefs) {
      // RSA for everyone
      const rsaExp = d[0] === 'hannah' ? 25 : 200 + Math.floor(Math.random() * 120);
      await q(
        `INSERT INTO certifications (client_id, staff_id, cert_type, issued_at, expires_at, status)
         VALUES ($1,$2,'RSA',$3,$4,$5)`,
        [clientId, staff[d[0]], daysFromNow(-700), daysFromNow(rsaExp),
         rsaExp <= 30 ? 'expiring_soon' : 'current'],
      );
    }
    for (const k of gamingKeys) {
      const exp = k === 'marcus' ? 5 : 180 + Math.floor(Math.random() * 120);
      await q(
        `INSERT INTO certifications (client_id, staff_id, cert_type, issued_at, expires_at, status)
         VALUES ($1,$2,'RSG',$3,$4,$5)`,
        [clientId, staff[k], daysFromNow(-360), daysFromNow(exp),
         exp <= 7 ? 'expiring_soon' : (exp <= 30 ? 'expiring_soon' : 'current')],
      );
    }

    // --- 7-day costed roster ------------------------------------------------
    // Weekly labour targets per department (net revenue basis). Gaming is
    // deliberately ABOVE 12% of $126k net gaming revenue to trigger the DM flag.
    const deptPlan = {
      gaming:      { staff: gamingKeys,                weeklyLabour: 16450, role: 'Gaming Attendant',  shiftsPerDay: 2 },
      beverage:    { staff: ['liam', 'sophie', 'olivia'], weeklyLabour: 12000, role: 'Bar Attendant',     shiftsPerDay: 2 },
      food:        { staff: ['noah', 'ava'],           weeklyLabour: 28000, role: 'Bistro/Kitchen',    shiftsPerDay: 2 },
      bottle_shop: { staff: ['jack'],                  weeklyLabour:  8500, role: 'Bottle Shop',       shiftsPerDay: 1 },
    };

    // Pre-compute shift count per dept so we can spread the weekly labour evenly.
    async function insertShift({ staffKey, dept, role, dayOffset, startH, endH, status, labourCost, rate }) {
      const shiftId = randomUUID();
      // handle shifts that cross midnight (endH < startH -> next day)
      const start = bne(dayOffset, startH);
      const end = endH <= startH ? bne(dayOffset + 1, endH) : bne(dayOffset, endH);
      await q(
        `INSERT INTO shifts (shift_id, client_id, venue_id, staff_id, role_name,
                             shift_start, shift_end, status, source,
                             department, hourly_rate, labour_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9,$10,$11)`,
        [shiftId, clientId, venueId, staff[staffKey], role, start, end, status,
         dept, rate, labourCost],
      );
      return shiftId;
    }

    for (const [dept, plan] of Object.entries(deptPlan)) {
      const totalShifts = plan.shiftsPerDay * 7;
      const perShift = Math.round((plan.weeklyLabour / totalShifts) * 100) / 100;
      let allocated = 0;
      let shiftIdx = 0;
      for (let day = 0; day < 7; day++) {
        for (let s = 0; s < plan.shiftsPerDay; s++) {
          shiftIdx++;
          const last = shiftIdx === totalShifts;
          const labour = last
            ? Math.round((plan.weeklyLabour - allocated) * 100) / 100
            : perShift;
          allocated += labour;
          const staffKey = plan.staff[(day + s) % plan.staff.length];
          const rate = staffDefs.find((x) => x[0] === staffKey)[8];
          // shift 0 = day (09-17), shift 1 = evening (17-01)
          const startH = s === 0 ? 9 : 17;
          const endH = s === 0 ? 17 : 1;
          // TODAY's (day 0) evening (s=1) gaming shift is the live, understaffed
          // one: only Grace on the floor, marked active. All other gaming staff
          // this evening are rostered/off (set above), so 1 < min 2.
          let status = 'scheduled';
          let useStaff = staffKey;
          if (day === 0 && dept === 'gaming') {
            status = s === 1 ? 'active' : 'completed';
            if (s === 1) useStaff = 'grace'; // single attendant -> understaffed
          } else if (day === 0 && s === 0) {
            status = 'completed';
          } else if (day === 0) {
            status = 'active';
          }
          await insertShift({
            staffKey: useStaff, dept, role: plan.role, dayOffset: day,
            startH, endH, status, labourCost: labour, rate,
          });
        }
      }
    }

    // Management shifts (DM cover) — not part of the 4 revenue-dept labour %.
    // Dan's evening DM shift is the live one; capture its id for the runsheet.
    const danShiftId = await insertShift({ staffKey: 'dan', dept: 'management', role: 'Duty Manager', dayOffset: 0, startH: 16, endH: 0, status: 'active', labourCost: 332, rate: 41.5 });
    await insertShift({ staffKey: 'vera', dept: 'management', role: 'Venue Manager', dayOffset: 1, startH: 9, endH: 17, status: 'scheduled', labourCost: 400, rate: 50 });

    // --- runsheet for Dan's live evening DM shift (Scene 2/3) ----------------
    // Calm, realistic evening tasks that mirror the handover (RSA follow-up,
    // gaming cover, EGM 32, Marcus RSG). due_by is local clock time on the shift.
    // The two early checks are pre-completed by Dan so the UI shows real progress;
    // completed_by is a real staff_id (never client-supplied at runtime).
    const runsheet = [
      // [task, due_by, category, doneAtHHMM | null]
      ['Floor walk + RSA signage check at open',                 '16:30', 'compliance',  '16:25'],
      ['Confirm a second gaming attendant or restrict the floor', '17:00', 'gaming',      null],
      ['Follow-up outcome note on the 15:10 RSA refusal',         '18:00', 'compliance',  null],
      ['Confirm technician ETA for EGM 32 (out of service)',      '18:30', 'gaming',      null],
      ['Start Marcus Polk RSG renewal (expires in 5 days)',       '19:00', 'compliance',  null],
      ['Bar float + till spot-check',                             '20:00', 'bar',         '19:58'],
      ['Bottle shop close & reconcile',                           '22:00', 'open_close',  null],
      ['Gaming room clean-down + lock-up',                        '23:45', 'open_close',  null],
    ];
    for (let i = 0; i < runsheet.length; i++) {
      const [task, due, category, doneAt] = runsheet[i];
      await q(
        `INSERT INTO runsheet_items (client_id, shift_id, task_description, due_by,
                                     category, completed_at, completed_by, item_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [clientId, danShiftId, task, due, category,
         doneAt ? bne(0, Number(doneAt.slice(0, 2)), Number(doneAt.slice(3))) : null,
         doneAt ? staff['dan'] : null, i],
      );
    }

    // --- incident log (compliance_events) -----------------------------------
    // 1) RSA refusal — logged this afternoon, NOT yet acknowledged (DM must see it).
    await q(
      `INSERT INTO compliance_events (client_id, venue_id, staff_id, event_type, severity, description, created_at)
       VALUES ($1,$2,$3,'rsa_refusal','warning',$4,$5)`,
      [clientId, venueId, staff['liam'],
       'RSA refusal — patron showing signs of intoxication refused further service at the main bar. Patron left without incident. Follow-up note outstanding.',
       bne(0, 15, 10)],
    );
    // 2) RG patron interaction — mandatory interaction, logged & resolved.
    await q(
      `INSERT INTO compliance_events (client_id, venue_id, staff_id, event_type, severity, description, created_at, acknowledged_at, acknowledged_by)
       VALUES ($1,$2,$3,'rg_patron_interaction','info',$4,$5,$6,$7)`,
      [clientId, venueId, staff['grace'],
       'Responsible Gambling patron interaction — attendant approached patron on EGM 14 after extended play; offered a break and water. Patron acknowledged, took a break.',
       bne(0, 13, 45), bne(0, 14, 0), staff['dan']],
    );
    // 3) EGM malfunction — machine suspended, technician called.
    await q(
      `INSERT INTO compliance_events (client_id, venue_id, staff_id, event_type, severity, description, created_at)
       VALUES ($1,$2,$3,'egm_malfunction','warning',$4,$5)`,
      [clientId, venueId, staff['hannah'],
       'EGM malfunction — machine 32 door-open alarm with door confirmed closed. Machine suspended and tagged out of service; gaming technician notified.',
       bne(0, 12, 20)],
    );

    // --- prior-shift handover note ------------------------------------------
    await q(
      `INSERT INTO handover_notes (client_id, venue_id, author_staff_id, from_role, to_role,
                                   shift_date, open_compliance_items, staffing_notes,
                                   incidents_summary, action_items, created_at)
       VALUES ($1,$2,$3,'Duty Manager (day)','Duty Manager (evening)',$4,$5,$6,$7,$8,$9)`,
      [clientId, venueId, staff['mia'], dateOnly(0),
       '• RSA refusal at 15:10 still needs a follow-up outcome note.\n• EGM 32 suspended (door alarm) — technician ETA not yet confirmed.\n• Marcus Polk RSG expires in 5 days — cannot work gaming past expiry without renewal.',
       'Evening gaming cover is light — only Grace confirmed on the floor for the 17:00 shift; venue minimum is 2 for 45 machines. Chase a second gaming attendant or pull cover.',
       'RG interaction on EGM 14 resolved (patron took a break). RSA refusal at the main bar — patron left, no escalation. EGM 32 out of service.',
       '1. Get a follow-up note on the RSA refusal.\n2. Roster a second gaming attendant for tonight or restrict floor.\n3. Confirm technician for EGM 32.\n4. Start Marcus RSG renewal.',
       bne(0, 15, 30)],
    );

    // --- 45 EGMs with varied weekly turnover --------------------------------
    const games = ['Dragon Link', 'Lightning Link', 'Mr Cashman', '5 Dragons', 'Buffalo Gold',
      'Wild Panda', 'Pompeii', 'Indian Dreaming', 'Where\'s the Gold', 'Tiki Torch',
      'Big Ben', 'Queen of the Nile', 'More Chilli', 'Cash Express', 'Sun & Moon'];
    for (let n = 1; n <= 45; n++) {
      // Spread turnover: a handful of strong performers, a long tail of weak ones.
      let turnover;
      if (n <= 5) turnover = 58000 + Math.floor(Math.random() * 12000);      // stars
      else if (n <= 20) turnover = 34000 + Math.floor(Math.random() * 14000); // solid
      else if (n <= 38) turnover = 16000 + Math.floor(Math.random() * 12000); // mid
      else turnover = 4000 + Math.floor(Math.random() * 7000);                // underperformers
      const status = n === 32 ? 'suspended' : 'active'; // matches the malfunction incident
      await q(
        `INSERT INTO egm_machines (client_id, venue_id, machine_number, game_name, weekly_turnover, status)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [clientId, venueId, n, games[(n - 1) % games.length], turnover, status],
      );
    }

    // --- P&L summary (monthly; ~4.33 weeks) ---------------------------------
    // Net revenue basis. Gaming row carries net gaming revenue + meter turnover.
    // Labour % uses net_gaming_revenue (RTV net, ~$126k/wk) — NEVER meter
    // (~$1.8M/wk). meter_turnover is stored only as context. See scripts/README.md.
    const W = 4.33;
    const pnl = [
      // dept,        weeklyRev, weeklyLabour, netGaming, meter
      ['beverage',    40000,  12000,  null,   null],
      ['food',        80000,  28000,  null,   null],
      ['gaming',      126000, 16450,  126000, 1800000],
      ['bottle_shop', 50000,  8500,   null,   null],
    ];
    let totRev = 0, totLab = 0;
    for (const [dept, wr, wl, ng, meter] of pnl) {
      const rev = Math.round(wr * W);
      const lab = Math.round(wl * W);
      totRev += rev; totLab += lab;
      await q(
        `INSERT INTO pnl_summary (client_id, venue_id, period_label, department,
                                  revenue, labour_cost, labour_pct, net_gaming_revenue, meter_turnover)
         VALUES ($1,$2,'2026-05 (monthly)',$3,$4,$5,$6,$7,$8)`,
        [clientId, venueId, dept, rev, lab, Math.round((lab / rev) * 1000) / 10,
         ng === null ? null : Math.round(ng * W),
         meter === null ? null : Math.round(meter * W)],
      );
    }
    await q(
      `INSERT INTO pnl_summary (client_id, venue_id, period_label, department,
                                revenue, labour_cost, labour_pct)
       VALUES ($1,$2,'2026-05 (monthly)','total',$3,$4,$5)`,
      [clientId, venueId, totRev, totLab, Math.round((totLab / totRev) * 1000) / 10],
    );
  });

  // --- isolation client (separate tenant, NSW) -------------------------------
  const rival = { clientId: randomUUID(), venueId: randomUUID(), staff: randomUUID() };
  const rivalHash = await hashPassword('other-0000');
  await withClientContext(rival.clientId, async (q) => {
    await q(`INSERT INTO clients (client_id, client_name, white_label_name) VALUES ($1,'Rival Taverns','Rival Assist')`, [rival.clientId]);
    await q(`INSERT INTO venues (venue_id, client_id, venue_name, state, timezone, gaming_min_attendants, egm_count)
             VALUES ($1,$2,'The Other Pub','NSW','Australia/Sydney',1,20)`, [rival.venueId, rival.clientId]);
    await q(`INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name, email, role_tier, role_name, password_hash, employment_type, base_hourly_rate, shift_status, department)
             VALUES ($1,$2,$3,'Otto','Other','otto@rival.test',5,'Duty Manager',$4,'full_time',41.5,'on','management')`,
      [rival.staff, rival.clientId, rival.venueId, rivalHash]);
  });

  return { clientId, venueId, staff };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  initDb(config);
  seedCriterionDemo()
    .then(async (ids) => {
      console.log('seeded Pinnacle/Criterion client:', ids.clientId);
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('seed failed:', err.message);
      try { await closeDb(); } catch {}
      process.exit(1);
    });
}
