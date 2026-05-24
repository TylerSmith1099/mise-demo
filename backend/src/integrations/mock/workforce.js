/**
 * Mock Workforce adapter — The Steward Hotel (demo venue, ENTIRELY FICTIONAL).
 * MIS-185.
 *
 * This is the SINGLE SOURCE OF TRUTH for the demo staff roster. compliance.js
 * and src/demo/seed.js import from here so certificate data can never drift
 * apart between the workforce view, the compliance register, and the seed.
 *
 * Returns data shaped like a Deputy API response (employees + rosters), so it
 * slots into the MIS-139 connector framework: a future DeputyConnector pointed
 * at a real account would return the same shape.
 *
 * All dates are computed RELATIVE TO THE LIVE DATE at call time — never
 * hardcoded and never anchored to module-load time — so the demo's
 * "expired 6 days ago" / "expiring in 9 days" relationships hold no matter
 * what day the demo runs or how long the server has been up (lesson: MIS-78
 * BASE_DATE drift silently broke Scene 3 as days passed; MIS-270 fixed the
 * same pattern for module-level NOW).
 */

// ---------------------------------------------------------------------------
// Date helpers — fresh on every call so cert windows and shift dates never
// drift while the server is running. Exported because compliance.js and the
// seed reuse the same helpers.
// ---------------------------------------------------------------------------

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
export function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export function monthsFromNow(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return isoDate(d);
}

// ---------------------------------------------------------------------------
// The 28 staff. Each is fully detailed. `flags` records the DELIBERATE gaps
// the demo relies on; compliance.js reads these to build the alert registers.
//
// cert windows:
//   rsaExpiry / rgExpiry / foodSafetyExpiry  — ISO date or null (= not held)
//   '__MISSING__'                            — role requires it but none on file
//
// buildStaff() is the FACTORY — call it fresh at runtime so cert dates and
// relative windows are always today-relative, not boot-time-relative.
// STAFF (the static export) is for the seed CLI which runs once per boot.
// ---------------------------------------------------------------------------

/** Build the 28-person staff list with dates relative to RIGHT NOW (MIS-270). */
export function buildStaff() {
  return [
    // --- Management ---------------------------------------------------------
    s('STW-001', 'Rachel',  'Drummond', 'Venue Manager',           4, 'FT',
      { rsa: monthsFromNow(20), rg: monthsFromNow(20), phone: '0407 112 884' }),
    s('STW-002', 'Aaron',   'Whitfield', 'Assistant Venue Manager', 4, 'FT',
      { rsa: monthsFromNow(15), rg: monthsFromNow(15), phone: '0408 220 113' }),

    // --- Duty Managers / MOD (3) -------------------------------------------
    s('STW-003', 'James',   'Kovacs',   'Duty Manager',            5, 'FT',
      { rsa: monthsFromNow(11), rg: monthsFromNow(11), phone: '0412 556 901',
        onShiftTonight: true }),
    s('STW-004', 'Priya',   'Naidoo',   'Duty Manager',            5, 'FT',
      { rsa: monthsFromNow(8), rg: monthsFromNow(8), phone: '0413 778 220',
        // Fair Work flag: double shift, no break logged.
        fairWorkFlag: 'Rostered double shift (10:00–02:00 then 09:00 next day) with no break logged' }),
    s('STW-005', 'Connor',  'Bligh',    'Duty Manager',            5, 'PT',
      { rsa: monthsFromNow(6), rg: monthsFromNow(6), phone: '0414 009 551' }),

    // --- Bar Attendants (5) -------------------------------------------------
    s('STW-006', 'Liam',    "O'Connor", 'Bar Attendant',           7, 'PT',
      // CRITICAL: RSA expired 6 days ago.
      { rsa: daysFromNow(-6), phone: '0415 330 887', onShiftTonight: true }),
    s('STW-007', 'Chloe',   'Nguyen',   'Bar Attendant',           7, 'CAS',
      // CRITICAL: RSA expired yesterday.
      { rsa: daysFromNow(-1), phone: '0416 442 119', onShiftTonight: true }),
    s('STW-008', 'Mateo',   'Rossi',    'Bar Attendant',           7, 'PT',
      { rsa: monthsFromNow(9), phone: '0417 661 230', onShiftTonight: true }),
    s('STW-009', 'Holly',   'Fraser',   'Bar Attendant',           7, 'CAS',
      { rsa: monthsFromNow(13), phone: '0418 552 770' }),
    s('STW-010', 'Daniel',  'Okafor',   'Bar Attendant',           7, 'PT',
      { rsa: monthsFromNow(4), phone: '0419 883 441' }),

    // --- Gaming Attendants (4) ---------------------------------------------
    s('STW-011', 'Sarah',   'Chen',     'Gaming Attendant',        7, 'FT',
      // Demo login (gaming@steward.demo). Clean certs. Machine 14 area.
      { rsa: monthsFromNow(14), rg: monthsFromNow(14), phone: '0420 114 558',
        onShiftTonight: true, floorArea: 'Gaming — M001–M015' }),
    s('STW-012', 'Marcus',  'Forsyth',  'Gaming Attendant',        7, 'FT',
      // CRITICAL BREACH: RG lapsed 3 days ago, rostered on the gaming floor tonight.
      { rsa: monthsFromNow(10), rg: daysFromNow(-3), phone: '0421 667 092',
        onShiftTonight: true, floorArea: 'Gaming — M030–M045' }),
    s('STW-013', 'Bianca',  'Lombardi', 'Gaming Attendant',        7, 'PT',
      { rsa: monthsFromNow(7), rg: monthsFromNow(7), phone: '0422 330 614' }),
    s('STW-014', 'Tom',     'Hargreave','Gaming Attendant',        7, 'CAS',
      { rsa: monthsFromNow(5), rg: monthsFromNow(5), phone: '0423 905 277' }),

    // --- Waiters / Floor (3) -----------------------------------------------
    s('STW-015', 'Ava',     'Thompson', 'Waiter / Floor Staff',    7, 'CAS',
      // WARNING: RSA expiring in 9 days.
      { rsa: daysFromNow(9), phone: '0424 118 553', onShiftTonight: true }),
    s('STW-016', 'Noah',    'Petrov',   'Waiter / Floor Staff',    7, 'PT',
      { rsa: monthsFromNow(12), phone: '0425 660 901' }),
    s('STW-017', 'Isla',    'Murray',   'Waiter / Floor Staff',    7, 'CAS',
      { rsa: monthsFromNow(3), phone: '0426 774 338', onShiftTonight: true }),

    // --- Kitchen (3) --------------------------------------------------------
    s('STW-018', 'Gordon',  'Mehta',    'Head Chef',               7, 'FT',
      { foodSafety: monthsFromNow(10), phone: '0427 991 220', onShiftTonight: true }),
    s('STW-019', 'Sokha',   'Pich',     'Kitchen Hand',            7, 'CAS',
      // WARNING: food safety certificate expired.
      { foodSafety: daysFromNow(-12), phone: '0428 220 667', onShiftTonight: true }),
    s('STW-020', 'Reza',    'Aziz',     'Kitchen Hand',            7, 'PT',
      { foodSafety: monthsFromNow(8), phone: '0429 553 118' }),

    // --- TAB / Keno (2) -----------------------------------------------------
    s('STW-021', 'Wayne',   'Dempsey',  'TAB/Keno Operator',       7, 'PT',
      { rsa: monthsFromNow(6), phone: '0430 117 449' }),
    s('STW-022', 'Grace',   'Sullivan', 'TAB/Keno Operator',       7, 'CAS',
      { rsa: monthsFromNow(16), phone: '0431 882 005' }),

    // --- Security (2) -------------------------------------------------------
    s('STW-023', 'Boris',   'Volkov',   'Security',                7, 'PT',
      { rsa: monthsFromNow(9), phone: '0432 660 773' }),
    s('STW-024', 'Sam',     'Atkinson', 'Security',                7, 'CAS',
      { rsa: monthsFromNow(11), phone: '0433 119 558' }),

    // --- Cleaners (2) -------------------------------------------------------
    s('STW-025', 'Maria',   'Goncalves','Cleaner',                 7, 'PT',
      { phone: '0434 770 226' }),
    s('STW-026', 'Pedro',   'Alves',    'Cleaner',                 7, 'CAS',
      { phone: '0435 663 901' }),

    // --- Functions (1) ------------------------------------------------------
    s('STW-027', 'Lauren',  'Beck',     'Functions Coordinator',   7, 'FT',
      { rsa: monthsFromNow(18), phone: '0436 220 884' }),

    // --- Bottle Shop / Retail (1) — covers the retail revenue stream; makes 28
    s('STW-028', 'Jordan',  'Mills',    'Bottle Shop Attendant',   7, 'CAS',
      // GAP: role serves packaged liquor and requires an RSA, but none is on file.
      { rsa: '__MISSING__', phone: '0437 558 110' }),
  ];
}

// Static export kept for src/demo/seed.js (runs once as a CLI — stale dates fine).
export const STAFF = buildStaff();

/**
 * Build a staff record. Keeps the table above readable; `extra` carries certs,
 * contact, shift flags, and the deliberate compliance gaps.
 */
function s(externalId, firstName, lastName, role, roleTier, employmentType, extra = {}) {
  return {
    externalStaffId: externalId,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    role,
    roleTier,
    employmentType, // FT | PT | CAS
    contactNumber: extra.phone || null,
    certifications: {
      rsa: extra.rsa ?? null,                 // ISO date | '__MISSING__' | null
      rg: extra.rg ?? null,                   // gaming/duty only
      foodSafety: extra.foodSafety ?? null,   // kitchen only
    },
    flags: {
      onShiftTonight: extra.onShiftTonight === true,
      floorArea: extra.floorArea || null,
      fairWorkFlag: extra.fairWorkFlag || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Current shift — tonight. 10 on across floor/bar/gaming/kitchen.
// One called in sick, gap unfilled. Marcus Forsyth (lapsed RG) is on the floor.
// ---------------------------------------------------------------------------
const SHIFT_START = '17:00';
const SHIFT_END = '02:00';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function getCurrentShift() {
  const now = new Date();
  const allStaff = buildStaff();
  const onShift = allStaff.filter((p) => p.flags.onShiftTonight);
  const marcus = allStaff.find((p) => p.externalStaffId === 'STW-012');
  const marcusRgDaysAgo = marcus?.certifications.rg
    ? Math.round((now - new Date(`${marcus.certifications.rg}T00:00:00`)) / 86_400_000)
    : 3;
  return {
    venue: 'The Steward Hotel',
    dayOfWeek: DAY_NAMES[now.getDay()],
    shiftDate: isoDate(now),
    shiftStart: SHIFT_START,
    shiftEnd: SHIFT_END,
    rosteredCount: onShift.length,
    breakSchedule: '30-min meal break staggered 20:00–22:00; 10-min breaks each 4h block',
    staff: onShift.map((p) => ({
      externalStaffId: p.externalStaffId,
      name: p.fullName,
      role: p.role,
      floorAllocation: p.flags.floorArea || defaultArea(p.role),
      start: SHIFT_START,
      end: SHIFT_END,
    })),
    gaps: [
      {
        type: 'sick_call_unfilled',
        severity: 'warning',
        detail: `Holly Fraser (Bar Attendant) called in sick at 16:10. Replacement not yet rostered — bar running one short for ${DAY_NAMES[now.getDay()]} peak.`,
        externalStaffId: 'STW-009',
      },
      {
        type: 'rg_lapsed_on_floor',
        severity: 'critical',
        detail: `Marcus Forsyth (Gaming Attendant) is rostered on the gaming floor (M030–M045) but his RG certification lapsed ${marcusRgDaysAgo} days ago.`,
        externalStaffId: 'STW-012',
      },
    ],
  };
}

function defaultArea(role) {
  if (role.includes('Bar')) return 'Main bar';
  if (role.includes('Gaming')) return 'Gaming room';
  if (role.includes('Waiter')) return 'Bistro floor';
  if (role.includes('Chef') || role.includes('Kitchen')) return 'Kitchen';
  if (role.includes('Security')) return 'Front entry';
  return 'Floating';
}

// ---------------------------------------------------------------------------
// Upcoming 7-day roster. Realistic coverage; Sunday lunch is deliberately
// understaffed (2 rostered, venue minimum is 3).
// ---------------------------------------------------------------------------
export const VENUE_MIN_STAFF = 3;

export function getWeekRoster() {
  // Coverage counts per day for the lunch and night blocks. Sunday lunch = 2.
  const plan = [
    { day: 'Monday',    lunch: 4, night: 7 },
    { day: 'Tuesday',   lunch: 4, night: 7 },
    { day: 'Wednesday', lunch: 5, night: 8 },
    { day: 'Thursday',  lunch: 5, night: 9 },
    { day: 'Friday',    lunch: 6, night: 10 },
    { day: 'Saturday',  lunch: 7, night: 11 },
    { day: 'Sunday',    lunch: 2, night: 6 }, // UNDERSTAFFED lunch
  ];
  return plan.map((p, i) => ({
    day: p.day,
    date: daysFromNow(i),
    blocks: [
      {
        block: 'lunch',
        window: '10:00–16:00',
        rostered: p.lunch,
        understaffed: p.lunch < VENUE_MIN_STAFF,
        minimum: VENUE_MIN_STAFF,
      },
      {
        block: 'night',
        window: '16:00–close',
        rostered: p.night,
        understaffed: p.night < VENUE_MIN_STAFF,
        minimum: VENUE_MIN_STAFF,
      },
    ],
  }));
}

/** Deputy-shaped employee + roster payload for the connector framework. */
export function getDeputyShapedResponse() {
  return {
    employees: STAFF.map((p) => ({
      Id: p.externalStaffId,
      DisplayName: p.fullName,
      FirstName: p.firstName,
      LastName: p.lastName,
      Role: p.role,
      EmploymentType: p.employmentType,
      Mobile: p.contactNumber,
      Active: true,
    })),
    rosters: getCurrentShift().staff.map((r) => ({
      Id: `ROS-${r.externalStaffId}`,
      Employee: r.externalStaffId,
      StartTime: `${getCurrentShift().shiftDate}T${r.start}:00+10:00`,
      EndTime: `${daysFromNow(1)}T${r.end}:00+10:00`,
      OperationalUnitName: r.floorAllocation,
      Open: false,
    })),
  };
}
