/**
 * Mock Reservations adapter — The Steward Hotel (demo, FICTIONAL).
 * MIS-243 / WS5 5C.
 *
 * Supplies two weeks of reservation data so the walk-in prediction model
 * (R&D, MIS-241) has a prior-week reference to work from:
 *
 *   Prior week  — service history records (booked pax + mains served per
 *                 service category) used to derive walk-in ratios.
 *   Demo week   — Mon dinner, Fri all-day, Sat all-day with full booking
 *                 drilldown (VIP, occasion, dietary, table number).
 *
 * All dates are RELATIVE TO NOW so they never drift (lesson: MIS-78).
 * Saturday is always the Scene 2 demo day; the data anchors to the most
 * recently completed (or current) Saturday.
 *
 * Walk-in prediction model (per R&D spec MIS-241):
 *   - Three separate category histories: weekday_lunch, weekday_dinner,
 *     weekend_allday.
 *   - ratio = (mains_served − booked_pax) / booked_pax, floored at 0.
 *   - predicted_walkins = booked_pax × weighted_avg(ratios for category)
 *   - Range band: ±40% at 1 week (honest thin-data widening), ±25% at ≥8 weeks.
 *   - Always display as a range with tilde, never a hard number.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Date helpers — anchored to NOW, never hardcoded.
// ---------------------------------------------------------------------------
const NOW = new Date();

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function offsetDay(n) {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

// Nearest most-recently-completed Saturday (or today if Saturday).
// dow=0 (Sun) → -1; dow=1 (Mon) → -2; ... dow=6 (Sat) → 0.
const dow = NOW.getDay();
const demoSatOffset = dow === 6 ? 0 : -(dow + 1);

export const DEMO_SAT = offsetDay(demoSatOffset);          // Scene 2 demo day
export const DEMO_FRI = offsetDay(demoSatOffset - 1);      // Fri all-day
export const DEMO_MON = offsetDay(demoSatOffset - 5);      // Mon dinner

const PRIOR_SAT = offsetDay(demoSatOffset - 7);
const PRIOR_FRI = offsetDay(demoSatOffset - 8);
const PRIOR_MON = offsetDay(demoSatOffset - 12);

// ---------------------------------------------------------------------------
// Service catalogue — maps day-of-week to service windows.
// ---------------------------------------------------------------------------
export const SERVICE_WINDOWS = {
  weekday_lunch:  { label: 'Lunch',          open: '11:30', close: '15:00' },
  weekday_dinner: { label: 'Dinner',         open: '17:00', close: '20:30' },
  weekend_allday: { label: 'All-Day Dining', open: '11:30', close: '20:30' },
};

// ---------------------------------------------------------------------------
// Prior-week service history (reference data for walk-in ratio calculation).
// Friday/Saturday have the highest walk-in ratios; weekday lunch the lowest.
// ---------------------------------------------------------------------------
export const PRIOR_WEEK_HISTORY = [
  {
    date: PRIOR_MON,
    serviceCategory: 'weekday_lunch',
    serviceName: 'Lunch',
    bookedPax: 28,
    mainsServed: 32,
  },
  {
    date: PRIOR_MON,
    serviceCategory: 'weekday_dinner',
    serviceName: 'Dinner',
    bookedPax: 34,
    mainsServed: 41,
  },
  {
    date: PRIOR_FRI,
    serviceCategory: 'weekend_allday',
    serviceName: 'All-Day Dining',
    bookedPax: 78,
    mainsServed: 113,
  },
  {
    date: PRIOR_SAT,
    serviceCategory: 'weekend_allday',
    serviceName: 'All-Day Dining',
    bookedPax: 108,
    mainsServed: 156,
  },
];

// ---------------------------------------------------------------------------
// Walk-in prediction model (R&D spec MIS-241).
// ---------------------------------------------------------------------------

/**
 * Derive walk-in ratio records from history, grouped by service category.
 * Returns { [category]: [{ date, ratio, bookedPax, lowSignal }] }
 */
function buildRatioHistory(history) {
  const byCategory = {};
  for (const h of history) {
    const walkIns = Math.max(0, h.mainsServed - h.bookedPax);
    const ratio = h.bookedPax > 0 ? walkIns / h.bookedPax : 0;
    const lowSignal = h.mainsServed < h.bookedPax;
    const cat = h.serviceCategory;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ date: h.date, ratio, bookedPax: h.bookedPax, lowSignal });
  }
  return byCategory;
}

/**
 * Recency-weighted mean ratio for a category.
 * Weights: most-recent = 0.4, next = 0.3, then 0.2, then 0.1.
 * Renormalised to however many records exist.
 */
function weightedRatio(records) {
  if (!records || records.length === 0) return null;
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
  const baseWeights = [0.4, 0.3, 0.2, 0.1];
  const weights = baseWeights.slice(0, sorted.length);
  const sum = weights.reduce((a, b) => a + b, 0);
  let ratio = 0;
  for (let i = 0; i < sorted.length; i++) {
    ratio += (weights[i] / sum) * sorted[i].ratio;
  }
  return ratio;
}

/**
 * Confidence band by weeks of data. Wider band = more honest about thin data.
 * 1 week → ±40%, 2–3 weeks → ±32%, 4–7 weeks → ±28%, 8+ weeks → ±25%.
 */
function confidenceBand(weekCount) {
  if (weekCount <= 1) return 0.4;
  if (weekCount <= 3) return 0.32;
  if (weekCount <= 7) return 0.28;
  return 0.25;
}

function confidenceLabel(weekCount) {
  if (weekCount <= 1) return `Based on ${weekCount} week of data`;
  return `Based on ${weekCount} weeks of data`;
}

/**
 * Compute walk-in prediction for a service.
 * Returns { low, high, predicted, confidenceLabel, ratioUsed, weekCount }
 */
export function predictWalkIns(serviceCategory, currentBookedPax, history) {
  const ratioHistory = buildRatioHistory(history);
  const catRecords = ratioHistory[serviceCategory] || [];
  if (catRecords.length === 0) return null;

  const ratio = weightedRatio(catRecords);
  const weekCount = catRecords.length;
  const band = confidenceBand(weekCount);

  const predicted = currentBookedPax * ratio;
  const low = Math.max(0, Math.round(predicted * (1 - band)));
  let high = Math.round(predicted * (1 + band));
  if (low === high) high = low + 1;

  return {
    low,
    high,
    predicted: Math.round(predicted),
    confidenceLabel: confidenceLabel(weekCount),
    ratioUsed: Math.round(ratio * 1000) / 1000,
    weekCount,
  };
}

// ---------------------------------------------------------------------------
// Current demo week — full booking records.
// ---------------------------------------------------------------------------

// Individual booking record factory.
function booking(time, pax, guestName, { occasion = null, vip = false, dietary = [], table } = {}) {
  return {
    bookingId: randomUUID(),
    time,
    pax,
    guestName,
    occasion,
    vip,
    dietary,
    tableNumber: table,
  };
}

// Monday dinner — moderate (~40 pax, 7 bookings across 17:00–20:30).
const MON_DINNER_BOOKINGS = [
  booking('17:00', 4, 'Brennan table',      { table: 'T3' }),
  booking('17:30', 6, 'Williams family',    { occasion: 'Anniversary', table: 'T7', dietary: ['Gluten free x1'] }),
  booking('18:00', 4, 'Garcia, Marco',      { vip: true, table: 'T1' }),
  booking('18:30', 8, 'Park reunion',       { table: 'T10', dietary: ['Vegan x2'] }),
  booking('19:00', 4, 'Taylor couple',      { occasion: 'Birthday', table: 'T5' }),
  booking('19:30', 6, 'Anderson party',     { table: 'T8', dietary: ['Dairy free x1'] }),
  booking('20:00', 8, 'Chen corporate',     { table: 'T12' }),
];

// Friday all-day — busy (~90 pax, 14 bookings, peak 12:00–13:30 + 18:00–19:30).
const FRI_ALLDAY_BOOKINGS = [
  booking('11:30', 4,  'Murphy, Kate',       { table: 'T4' }),
  booking('12:00', 10, 'Li family',          { table: 'T9', dietary: ['Gluten free x1'] }),
  booking('12:00', 6,  'Nguyen party',       { vip: true, table: 'T1' }),
  booking('12:30', 8,  'Rodriguez reunion',  { table: 'T6', dietary: ['Vegan x2'] }),
  booking('13:00', 6,  'Walsh group',        { occasion: 'Anniversary', table: 'T11' }),
  booking('13:30', 4,  'Kim couple',         { table: 'T3', dietary: ['Dairy free x1'] }),
  booking('14:00', 4,  'Brown table',        { occasion: 'Birthday', table: 'T8' }),
  booking('17:00', 4,  'Scott family',       { table: 'T5' }),
  booking('18:00', 6,  'Thompson party',     { table: 'T12' }),
  booking('18:30', 10, 'Evans group',        { table: 'T7' }),
  booking('18:30', 6,  'Patel, Raj',         { vip: true, table: 'T2' }),
  booking('19:00', 10, 'Collins birthday',   { occasion: 'Birthday', table: 'T15', dietary: ['Gluten free x2'] }),
  booking('19:30', 6,  'Stewart party',      { table: 'T10' }),
  booking('20:00', 6,  'Chan family',        { table: 'T14', dietary: ['Vegan x1'] }),
  // Fri: 4+10+6+8+6+4+4+4+6+10+6+10+6+6 = 90 pax, 14 bookings. Walk-in target ~24–56.
];

// Saturday all-day — busiest (~120 pax, 15 bookings).
// 7pm table-of-12 birthday is the largest single booking.
// Peak: 12:00–13:00 and 18:30–20:00.
const SAT_ALLDAY_BOOKINGS = [
  booking('11:30', 6,  'Mitchell party',     { table: 'T3', dietary: ['Gluten free x1'] }),
  booking('12:00', 12, 'Chen family',        { table: 'T8' }),
  booking('12:00', 4,  'Kowalski, Sarah',    { vip: true, table: 'T12' }),
  booking('12:00', 16, 'Harrison reunion',   { table: 'T5', dietary: ['Vegan x2'] }),
  booking('12:30', 4,  "O'Brien, Thomas",    { occasion: 'Anniversary', table: 'T2' }),
  booking('13:00', 10, 'Nakamura group',     { table: 'T9', dietary: ['Dairy free x1'] }),
  booking('14:00', 8,  'Singh party',        { table: 'T11', dietary: ['Gluten free x1'] }),
  booking('17:30', 4,  'Thompson, Emma',     { table: 'T4' }),
  booking('18:00', 10, 'Johansson group',    { table: 'T7' }),
  booking('18:30', 10, 'Patel family',       { table: 'T10' }),
  booking('18:30', 6,  'McCarthy, James',    { vip: true, table: 'T1' }),
  booking('19:00', 12, 'Henderson birthday', { occasion: 'Birthday', table: 'T15', dietary: ['Gluten free x2'] }),
  booking('19:00', 8,  'Zhao, Lin',          { table: 'T16' }),
  booking('19:30', 6,  'Flynn, Rachel',      { table: 'T14', dietary: ['Vegan x1'] }),
  booking('20:00', 4,  'Davis party',        { table: 'T13' }),
  // Sat: 6+12+4+16+4+10+8+4+10+10+6+12+8+6+4 = 120 pax, 15 bookings.
];

/**
 * Group bookings into 30-minute time slots.
 * Slots are labelled by slot start (e.g. "12:00", "12:30") and contain the
 * bookings whose time falls in [slotStart, slotStart+30min).
 */
function toTimeSlots(bookings, windowOpen, windowClose) {
  // Build slot keys for the full service window.
  const slots = {};
  const [oh, om] = windowOpen.split(':').map(Number);
  const [ch, cm] = windowClose.split(':').map(Number);
  let cur = oh * 60 + om;
  const end = ch * 60 + cm;
  while (cur < end) {
    const hh = String(Math.floor(cur / 60)).padStart(2, '0');
    const mm = String(cur % 60).padStart(2, '0');
    slots[`${hh}:${mm}`] = [];
    cur += 30;
  }

  for (const b of bookings) {
    const [bh, bm] = b.time.split(':').map(Number);
    const bMin = bh * 60 + bm;
    // Bucket into slot: floor to nearest 30-min boundary.
    const slotMin = Math.floor(bMin / 30) * 30;
    const sh = String(Math.floor(slotMin / 60)).padStart(2, '0');
    const sm = String(slotMin % 60).padStart(2, '0');
    const key = `${sh}:${sm}`;
    if (slots[key]) slots[key].push(b);
  }

  return Object.entries(slots)
    .map(([time, bkgs]) => ({
      time,
      pax: bkgs.reduce((s, b) => s + b.pax, 0),
      bookingCount: bkgs.length,
      bookings: bkgs,
    }))
    .filter((s) => s.bookingCount > 0 || true); // keep empty slots for the bar chart
}

/**
 * Build a full day record from a set of bookings + service metadata.
 */
function buildDayRecord(date, serviceCategory, bookings) {
  const win = SERVICE_WINDOWS[serviceCategory];
  const totalBookedPax = bookings.reduce((s, b) => s + b.pax, 0);
  const vipCount = bookings.filter((b) => b.vip).length;
  const walkIn = predictWalkIns(serviceCategory, totalBookedPax, PRIOR_WEEK_HISTORY);
  const timeSlots = toTimeSlots(bookings, win.open, win.close);

  return {
    date,
    serviceCategory,
    serviceName: win.label,
    window: `${win.open}–${win.close}`,
    windowOpen: win.open,
    windowClose: win.close,
    totalBookedPax,
    vipCount,
    walkInPrediction: walkIn,
    timeSlots,
    bookings,
  };
}

// ---------------------------------------------------------------------------
// Demo week data — keyed by ISO date string.
// ---------------------------------------------------------------------------
const DEMO_WEEK_DATA = {
  [DEMO_MON]: [
    buildDayRecord(DEMO_MON, 'weekday_dinner', MON_DINNER_BOOKINGS),
  ],
  [DEMO_FRI]: [
    buildDayRecord(DEMO_FRI, 'weekend_allday', FRI_ALLDAY_BOOKINGS),
  ],
  [DEMO_SAT]: [
    buildDayRecord(DEMO_SAT, 'weekend_allday', SAT_ALLDAY_BOOKINGS),
  ],
};

/**
 * Get reservations for a given ISO date.
 * Returns an array of service records (may be empty for unmodelled dates).
 */
export function getReservationsForDate(date) {
  return DEMO_WEEK_DATA[date] || [];
}

/**
 * Get the demo Saturday's full reservation data.
 * This is the Scene 2 primary view.
 */
export function getDemoSaturdayReservations() {
  return DEMO_WEEK_DATA[DEMO_SAT];
}

/**
 * Summary of seeded data — used by seed.js console output and CEO-Log.
 */
export function getReservationsSeedSummary() {
  const days = Object.entries(DEMO_WEEK_DATA).map(([date, services]) => ({
    date,
    services: services.map((s) => ({
      category: s.serviceCategory,
      bookings: s.bookings.length,
      pax: s.totalBookedPax,
      vips: s.vipCount,
      walkInPrediction: s.walkInPrediction
        ? `~${s.walkInPrediction.low}–${s.walkInPrediction.high}`
        : 'n/a',
    })),
  }));

  return {
    priorWeekHistoryRecords: PRIOR_WEEK_HISTORY.length,
    demoWeekDays: days,
    demoDates: { mon: DEMO_MON, fri: DEMO_FRI, sat: DEMO_SAT },
    priorDates: { fri: PRIOR_FRI, sat: PRIOR_SAT },
  };
}
