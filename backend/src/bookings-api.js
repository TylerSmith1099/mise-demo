// Bookings API — MIS-642.
//
//   GET /api/bookings              -> today's bookings (Brisbane)
//   GET /api/bookings/:date        -> bookings for YYYY-MM-DD
//   GET /api/bookings/week         -> bookings for the current 7-day window
//
// All roles. Client + venue scoped via JWT (RLS enforces isolation).
// Returns bookings grouped by service_window, ordered by slot_time.
//
// Shape:
//   { date, from?, to?, services: [{ window, label, bookings: [{ ... }] }] }

import { Router } from 'express';
import { withClientContext } from './db.js';

const WINDOW_LABELS = {
  breakfast: 'Breakfast',
  lunch:     'Lunch',
  dinner:    'Dinner',
  bar:       'Bar',
  function:  'Function',
};

const WINDOW_ORDER = ['breakfast', 'lunch', 'dinner', 'bar', 'function'];

// Brisbane today (UTC+10, no DST offset)
function brisToday() {
  return new Date(Date.now() + 10 * 3_600_000).toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function groupByWindow(rows) {
  const map = {};
  for (const row of rows) {
    if (!map[row.service_window]) map[row.service_window] = [];
    map[row.service_window].push({
      bookingId:     row.booking_id,
      guestName:     row.guest_name,
      partySize:     Number(row.party_size),
      slotTime:      row.slot_time?.slice(0, 5) ?? null,
      status:        row.status,
      isVip:         Boolean(row.is_vip),
      notes:         row.notes || null,
    });
  }
  return WINDOW_ORDER
    .filter((w) => map[w])
    .map((w) => ({
      window:   w,
      label:    WINDOW_LABELS[w] || w,
      bookings: map[w],
    }));
}

async function queryBookings(q, venueId, fromDate, toDate) {
  const { rows } = await q(
    `SELECT booking_id, service_window, slot_time, party_size,
            guest_name, status, is_vip, notes, booking_date
       FROM bookings
      WHERE venue_id = $1
        AND booking_date >= $2
        AND booking_date <= $3
        AND deleted_at IS NULL
      ORDER BY booking_date, slot_time`,
    [venueId, fromDate, toDate],
  );
  return rows;
}

export function bookingsRouter() {
  const router = Router();

  // Today's bookings
  router.get('/bookings', async (req, res, next) => {
    try {
      const { clientId, venueId } = req.auth;
      const today = brisToday();
      const rows = await withClientContext(clientId, (q) =>
        queryBookings(q, venueId, today, today),
      );
      res.json({ date: today, services: groupByWindow(rows) });
    } catch (err) {
      next(err);
    }
  });

  // Current week (today + next 6 days)
  router.get('/bookings/week', async (req, res, next) => {
    try {
      const { clientId, venueId } = req.auth;
      const from = brisToday();
      const to   = addDays(from, 6);
      const rows = await withClientContext(clientId, (q) =>
        queryBookings(q, venueId, from, to),
      );
      // Group by date first, then by window within each date
      const byDate = {};
      for (const row of rows) {
        const d = row.booking_date instanceof Date
          ? row.booking_date.toISOString().slice(0, 10)
          : String(row.booking_date).slice(0, 10);
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(row);
      }
      const days = Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, dayRows]) => ({ date, services: groupByWindow(dayRows) }));
      res.json({ from, to, days });
    } catch (err) {
      next(err);
    }
  });

  // Specific date — must come AFTER /bookings/week to avoid 'week' matching :date
  router.get('/bookings/:date', async (req, res, next) => {
    try {
      const { date } = req.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'invalid_date_format' });
      }
      const { clientId, venueId } = req.auth;
      const rows = await withClientContext(clientId, (q) =>
        queryBookings(q, venueId, date, date),
      );
      res.json({ date, services: groupByWindow(rows) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
