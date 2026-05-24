/**
 * Mock POS / Transaction adapter — The Steward Hotel (demo, FICTIONAL).
 * MIS-185.
 *
 * Returns data shaped like a Bepoz reporting response. Figures are
 * self-consistent with the venue revenue profile in the sprint spec:
 *   Beverages $100k/wk · Food $60k/wk · Gaming turnover $1.8M/wk · Retail $15k/wk
 *
 * Gaming RTV is NOT a fixed rate — it varies by day/time. Today (Friday peak)
 * is modelled at 12.4%, giving NGR ≈ turnover × RTV.
 *
 * Times are anchored to the live date so "clearance overdue by 3+ hours" /
 * "last cash-up 2.5 hours ago" stay true whenever the demo runs.
 */

import { isoDate } from './workforce.js';

// Fresh on each call — never anchored to module load time (MIS-270).
function hoursAgo(h) {
  const d = new Date();
  d.setMinutes(d.getMinutes() - Math.round(h * 60));
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Weekly revenue, broken into daily figures. Fri/Sat highest, Mon lowest.
// Totals: bev 100,000 · food 60,000 · retail 15,000.
// ---------------------------------------------------------------------------
export const WEEKLY_REVENUE = {
  beverages: { total: 100_000, daily: {
    Monday: 8_000, Tuesday: 9_000, Wednesday: 11_000, Thursday: 14_000,
    Friday: 22_000, Saturday: 22_000, Sunday: 14_000 } },
  food: { total: 60_000, daily: {
    Monday: 5_000, Tuesday: 5_500, Wednesday: 7_000, Thursday: 8_500,
    Friday: 14_000, Saturday: 14_000, Sunday: 6_000 } },
  retail: { total: 15_000, daily: {
    Monday: 1_500, Tuesday: 1_500, Wednesday: 1_500, Thursday: 1_500,
    Friday: 3_000, Saturday: 3_000, Sunday: 3_000 } },
};

// ---------------------------------------------------------------------------
// Gaming room — 45 machines, M001–M045. 38 active, 4 idle, 3 fault.
// Clearance: M001–M035 green (<2h), M036–M042 amber (>3h overdue),
// M043–M045 fault (n/a). Faults: M012, M027, M041.
// ---------------------------------------------------------------------------
const FAULT_MACHINES = ['M012', 'M027', 'M041'];
const IDLE_MACHINES = ['M008', 'M019', 'M033', 'M044'];

export function getGamingMachines() {
  const machines = [];
  for (let i = 1; i <= 45; i++) {
    const id = `M${String(i).padStart(3, '0')}`;
    let status = 'active';
    if (FAULT_MACHINES.includes(id)) status = 'fault';
    else if (IDLE_MACHINES.includes(id)) status = 'idle';

    let clearance;
    if (i >= 43) clearance = { state: 'not_applicable', reason: 'fault', lastClearance: null };
    else if (i >= 36) clearance = { state: 'amber', overdueHours: 3.5, lastClearance: hoursAgo(3.5) };
    else clearance = { state: 'green', lastClearance: hoursAgo(1.2) };

    machines.push({ machineId: id, status, clearance });
  }
  return {
    venue: 'The Steward Hotel',
    machineCount: 45,
    summary: {
      active: machines.filter((m) => m.status === 'active').length, // 38
      idle: machines.filter((m) => m.status === 'idle').length,     // 4
      fault: machines.filter((m) => m.status === 'fault').length,   // 3
      faultMachines: FAULT_MACHINES,
      clearanceAmber: machines.filter((m) => m.clearance.state === 'amber').map((m) => m.machineId),
    },
    machines,
  };
}

// ---------------------------------------------------------------------------
// Gaming turnover / RTV / NGR for today (Friday, peak).
// ---------------------------------------------------------------------------
export function getGamingFinancials() {
  const turnoverToday = 285_000;     // matches ~$1.8M/wk, evening peak
  const rtvToday = 0.124;            // 12.4% — within evening peak 11–14% band
  return {
    date: isoDate(new Date()),
    dayOfWeek: new Date().toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'Australia/Brisbane' }),
    turnoverToday,
    rtvToday,
    rtvPctDisplay: '12.4%',
    ngrToday: Math.round(turnoverToday * rtvToday), // ≈ 35,340
    rtvModelNote:
      'RTV is variable, not fixed. Mon–Thu daytime 8–10%, Fri–Sat peak 11–14%, Sun 7–9%.',
    weeklyTurnover: 1_800_000,
  };
}

// ---------------------------------------------------------------------------
// Today's trading summary — hourly beverage ramp, covers, tabs, top sellers.
// ---------------------------------------------------------------------------
export function getTradingSummary() {
  // Friday ramp 10:00 → 23:00. Slow open, lunch bump, evening peak 19:00–23:00.
  const hourlyBeverage = [
    { hour: '10:00', revenue: 180 }, { hour: '11:00', revenue: 340 },
    { hour: '12:00', revenue: 920 }, { hour: '13:00', revenue: 1_180 },
    { hour: '14:00', revenue: 760 }, { hour: '15:00', revenue: 540 },
    { hour: '16:00', revenue: 980 }, { hour: '17:00', revenue: 1_640 },
    { hour: '18:00', revenue: 2_120 }, { hour: '19:00', revenue: 2_980 },
    { hour: '20:00', revenue: 3_240 }, { hour: '21:00', revenue: 3_010 },
    { hour: '22:00', revenue: 2_760 }, { hour: '23:00', revenue: 1_550 },
  ];
  return {
    venue: 'The Steward Hotel',
    date: isoDate(new Date()),
    dayOfWeek: new Date().toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'Australia/Brisbane' }),
    hourlyBeverage,
    beverageToDate: hourlyBeverage.reduce((a, h) => a + h.revenue, 0),
    covers: { lunch: 45, dinner: 90 },
    openTabs: 14,
    topSellers: [
      { rank: 1, product: 'Schooner — House Lager' },
      { rank: 2, product: 'House Red (glass)' },
      { rank: 3, product: 'Chicken Parma' },
      { rank: 4, product: 'Beef Burger' },
      { rank: 5, product: 'House Bourbon' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Cash management.
// ---------------------------------------------------------------------------
export function getCashManagement() {
  const dayName = new Date().toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'Australia/Brisbane' });
  return {
    venue: 'The Steward Hotel',
    openingFloat: { bar: 2_500, gaming: 5_000 },
    currentTill: { bar: 8_240, gaming: 12_660 },
    lastCashUp: {
      at: hoursAgo(2.5),
      note: `Last cash-up 6pm — 2.5 hours ago. Overdue for a ${dayName} night.`,
      overdue: true,
    },
    variance: {
      bar: { amount: 4.2, status: 'acceptable' },
      gaming: { amount: -12.8, status: 'within_tolerance_flagged' },
    },
  };
}

/** One call assembling the whole POS picture for the demo routes. */
export function getPosSummary() {
  return {
    revenue: WEEKLY_REVENUE,
    gamingFinancials: getGamingFinancials(),
    trading: getTradingSummary(),
    cash: getCashManagement(),
  };
}
