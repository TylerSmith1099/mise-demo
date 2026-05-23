/**
 * Mock Revenue Intelligence adapter — The Steward Hotel (demo, FICTIONAL).
 * MIS-238.
 *
 * Returns revenue + labour data per department with all percentages COMPUTED
 * from the underlying input values — never hardcoded — so QA can verify:
 *   gaming: labourCost / (meterTurnover × 0.07) × 100
 *   others: labourCost / revenue × 100
 *
 * Gaming net revenue uses 7% of meter turnover (RTV). The meter figure is
 * stored as context only; the calculation path enforces RTV as the denominator.
 */

// ---------------------------------------------------------------------------
// Raw demo inputs (Saturday all-day service, ~3.5h into shift).
// All percentages are DERIVED below — never stored here.
// ---------------------------------------------------------------------------

const TODAY_LABOUR = {
  gaming:  378.00,   // 2 gaming attendants × 3.5h
  bar:    1840.00,   // 3 bar staff × varying shift lengths (includes prior-service)
  food:    838.00,   // 4 kitchen + FOH staff, lunch service
  retail:  200.00,   // 1 bottle shop attendant
};

const TODAY_REVENUE = {
  gaming:  { meterTurnover: 192_857 },  // netRTV = round(192857 × 0.07) = 13,500
  bar:     { net: 10_100 },
  food:    { net:  9_200 },
  retail:  { net:  2_400 },
};

// Prior week same day (last Saturday, same elapsed time) — for trend.
const PRIOR_LABOUR  = { gaming: 401.00, bar: 1530.00, food: 876.00, retail: 226.00 };
const PRIOR_REVENUE = {
  gaming:  { meterTurnover: 185_714 },  // netRTV = round(185714 × 0.07) = 13,000
  bar:     { net: 9_500 },
  food:    { net: 9_400 },
  retail:  { net: 2_405 },
};

// Shift window: Brisbane local time.
const SHIFT_START_HOUR = 11;
const SHIFT_START_MIN  = 30;
const SHIFT_TOTAL_HOURS = 12.5;  // 11:30 → 00:00

// Staff on shift per department with hourly rates (Hospitality Award 2020 blended).
const DEPT_STAFF = {
  gaming: [
    { name: 'Sarah Chen',     role: 'Gaming Attendant', hourlyRate: 28.40 },
    { name: 'Marcus Forsyth', role: 'Gaming Attendant', hourlyRate: 28.40 },
  ],
  bar: [
    { name: "Liam O'Connor", role: 'Bar Attendant',  hourlyRate: 28.40 },
    { name: 'Chloe Nguyen',  role: 'Bar Attendant',  hourlyRate: 28.40 },
    { name: 'Mateo Rossi',   role: 'Bar Shift Lead', hourlyRate: 36.20 },
  ],
  food: [
    { name: 'Gordon Mehta',  role: 'Head Chef',      hourlyRate: 42.00 },
    { name: 'Sokha Pich',    role: 'Kitchen Hand',   hourlyRate: 28.50 },
    { name: 'Ava Thompson',  role: 'Waiter',         hourlyRate: 30.80 },
    { name: 'Isla Murray',   role: 'Waiter',         hourlyRate: 30.80 },
  ],
  retail: [
    { name: 'Jordan Mills', role: 'Bottle Shop Attendant', hourlyRate: 28.40 },
  ],
};

// Benchmarks (product constants — spec section 4, confirmed, do not change).
const BENCHMARKS = {
  gaming: { type: 'upper', value: 3.0,  label: '≤3% net RTV' },
  bar:    { type: 'upper', value: 15.0, label: '≤15% benchmark' },
  food:   { type: 'range', lower: 8.0,  upper: 10.0, label: '8–10% benchmark' },
  retail: { type: 'upper', value: 10.0, label: '<10% benchmark' },
  fAndB:  { type: 'upper', value: 25.0, label: '<25% combined' },
};

// ---------------------------------------------------------------------------
// Computation helpers — the formulas that turn raw inputs into derived values.
// ---------------------------------------------------------------------------

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

// Gaming net revenue = meter turnover × 7% (RTV). Never the raw meter total.
function gamingNetRtv(meterTurnover) {
  return Math.round(meterTurnover * 0.07);
}

// Labour % = labourCost / revenue × 100. Returns null if revenue is zero/null.
function labourPct(labourCost, revenue) {
  if (!revenue || revenue <= 0) return null;
  return round1((labourCost / revenue) * 100);
}

// Status from percentage vs benchmark thresholds.
function computeStatus(pct, benchmark) {
  if (pct == null) return 'unavailable';
  const { type, value, lower, upper } = benchmark;
  if (type === 'range') {
    // Food: below 8% → AMBER "understaffed risk"
    if (pct < lower) return 'amber';
    if (pct <= upper) return 'green';
    if (pct <= upper + 2) return 'amber';
    return 'red';
  }
  if (pct <= value) return 'green';
  if (pct <= value + 2) return 'amber';
  return 'red';
}

// Shift elapsed time in Brisbane local hours.
function elapsedShiftHours() {
  const now = new Date();
  const bne = new Date(now.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' }));
  const shiftStart = new Date(bne);
  shiftStart.setHours(SHIFT_START_HOUR, SHIFT_START_MIN, 0, 0);
  const ms = bne - shiftStart;
  if (ms < 0) return 0;
  return Math.min(ms / 3_600_000, SHIFT_TOTAL_HOURS);
}

// Hours remaining in shift for each staff member.
function staffWithHoursRemaining(staffArr) {
  const elapsed = elapsedShiftHours();
  const remaining = round1(Math.max(SHIFT_TOTAL_HOURS - elapsed, 0));
  return staffArr.map((s) => ({ ...s, hoursRemaining: remaining }));
}

// "To reach benchmark" drill-down calculation for over-benchmark departments.
function drillDownCalc(labourCost, revenue, benchmarkUpper) {
  const elapsed = Math.max(elapsedShiftHours(), 0.25); // guard div/0
  const projectedRevenue = round2(revenue * (SHIFT_TOTAL_HOURS / elapsed));
  const maxAllowable = round2(projectedRevenue * (benchmarkUpper / 100));
  const maxRemainingSpend = round2(Math.max(maxAllowable - labourCost, 0));
  return { maxRemainingSpend, projectedRevenue };
}

// ---------------------------------------------------------------------------
// Main export.
// ---------------------------------------------------------------------------

export function getRevenueIntelligence() {
  const elapsed = elapsedShiftHours();
  const earlyShift = elapsed < 0.5;

  // Gaming ----------------------------------------------------------------
  const gamingNetRevenue     = gamingNetRtv(TODAY_REVENUE.gaming.meterTurnover);
  const priorGamingNetRevenue = gamingNetRtv(PRIOR_REVENUE.gaming.meterTurnover);
  const gamingPct            = gamingNetRevenue > 0 ? labourPct(TODAY_LABOUR.gaming, gamingNetRevenue) : null;
  const priorGamingPct       = priorGamingNetRevenue > 0 ? labourPct(PRIOR_LABOUR.gaming, priorGamingNetRevenue) : null;
  const gamingStatus         = earlyShift ? 'early' : computeStatus(gamingPct, BENCHMARKS.gaming);
  const gamingBurnRate       = round2(DEPT_STAFF.gaming.reduce((s, x) => s + x.hourlyRate, 0));

  // Bar -------------------------------------------------------------------
  const barPct     = labourPct(TODAY_LABOUR.bar, TODAY_REVENUE.bar.net);
  const priorBarPct = labourPct(PRIOR_LABOUR.bar, PRIOR_REVENUE.bar.net);
  const barStatus  = earlyShift ? 'early' : computeStatus(barPct, BENCHMARKS.bar);
  const barBurnRate = round2(DEPT_STAFF.bar.reduce((s, x) => s + x.hourlyRate, 0));
  const barDrillDown = (barStatus === 'red' || barStatus === 'amber')
    ? { ...drillDownCalc(TODAY_LABOUR.bar, TODAY_REVENUE.bar.net, BENCHMARKS.bar.value), currentBurnRatePerHour: barBurnRate }
    : null;

  // Food ------------------------------------------------------------------
  const foodPct      = labourPct(TODAY_LABOUR.food, TODAY_REVENUE.food.net);
  const priorFoodPct = labourPct(PRIOR_LABOUR.food, PRIOR_REVENUE.food.net);
  const foodStatus   = earlyShift ? 'early' : computeStatus(foodPct, BENCHMARKS.food);

  // Retail ----------------------------------------------------------------
  const retailPct      = labourPct(TODAY_LABOUR.retail, TODAY_REVENUE.retail.net);
  const priorRetailPct = labourPct(PRIOR_LABOUR.retail, PRIOR_REVENUE.retail.net);
  const retailStatus   = earlyShift ? 'early' : computeStatus(retailPct, BENCHMARKS.retail);

  // F&B Combined ----------------------------------------------------------
  const fAndBLabour  = TODAY_LABOUR.bar + TODAY_LABOUR.food;
  const fAndBRevenue = TODAY_REVENUE.bar.net + TODAY_REVENUE.food.net;
  const fAndBPct     = labourPct(fAndBLabour, fAndBRevenue);
  const fAndBStatus  = earlyShift ? 'early' : computeStatus(fAndBPct, BENCHMARKS.fAndB);
  const priorFAndBLabour  = PRIOR_LABOUR.bar + PRIOR_LABOUR.food;
  const priorFAndBRevenue = PRIOR_REVENUE.bar.net + PRIOR_REVENUE.food.net;
  const priorFAndBPct     = labourPct(priorFAndBLabour, priorFAndBRevenue);

  function trend(current, prior) {
    if (current == null || prior == null) return null;
    return { priorPct: prior, delta: round1(current - prior), priorLabel: 'last Saturday' };
  }

  const now = new Date().toISOString();

  return {
    generatedAt: now,
    venue: 'The Steward Hotel',
    service: 'Saturday All-Day',
    departments: [
      {
        id: 'gaming',
        label: 'Gaming',
        labourCost: TODAY_LABOUR.gaming,
        revenue: gamingNetRevenue,
        meterTurnover: TODAY_REVENUE.gaming.meterTurnover,
        revenueLabel: `Net RTV (7% of $${TODAY_REVENUE.gaming.meterTurnover.toLocaleString()} meter)`,
        labourPct: gamingPct,
        benchmark: BENCHMARKS.gaming,
        status: gamingStatus,
        trend: trend(gamingPct, priorGamingPct),
        staffOnShift: staffWithHoursRemaining(DEPT_STAFF.gaming),
        drillDown: null,
      },
      {
        id: 'bar',
        label: 'Bar / Beverage',
        labourCost: TODAY_LABOUR.bar,
        revenue: TODAY_REVENUE.bar.net,
        meterTurnover: null,
        revenueLabel: null,
        labourPct: barPct,
        benchmark: BENCHMARKS.bar,
        status: barStatus,
        trend: trend(barPct, priorBarPct),
        staffOnShift: staffWithHoursRemaining(DEPT_STAFF.bar),
        drillDown: barDrillDown,
      },
      {
        id: 'food',
        label: 'Food (FOH)',
        labourCost: TODAY_LABOUR.food,
        revenue: TODAY_REVENUE.food.net,
        meterTurnover: null,
        revenueLabel: null,
        labourPct: foodPct,
        benchmark: BENCHMARKS.food,
        status: foodStatus,
        trend: trend(foodPct, priorFoodPct),
        staffOnShift: staffWithHoursRemaining(DEPT_STAFF.food),
        drillDown: null,
      },
      {
        id: 'retail',
        label: 'Retail',
        labourCost: TODAY_LABOUR.retail,
        revenue: TODAY_REVENUE.retail.net,
        meterTurnover: null,
        revenueLabel: null,
        labourPct: retailPct,
        benchmark: BENCHMARKS.retail,
        status: retailStatus,
        trend: trend(retailPct, priorRetailPct),
        staffOnShift: staffWithHoursRemaining(DEPT_STAFF.retail),
        drillDown: null,
      },
    ],
    combined: {
      fAndB: {
        labourCost: fAndBLabour,
        revenue: fAndBRevenue,
        labourPct: fAndBPct,
        benchmark: BENCHMARKS.fAndB,
        status: fAndBStatus,
        trend: trend(fAndBPct, priorFAndBPct),
      },
    },
    dataStatus: {
      posConnected: true,
      humanforceConnected: true,
      lastSync: now,
    },
  };
}
