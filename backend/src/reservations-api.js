// Reservations API — surfaces ResDiary booking data for the run sheet (MIS-243).
//
//   GET /api/reservations          -> reservations for the demo Saturday (Scene 2)
//   GET /api/reservations/:date    -> reservations for a specific YYYY-MM-DD date
//
// Returns: { date, services: [{ serviceCategory, serviceName, window, totalBookedPax,
//   vipCount, walkInPrediction, timeSlots, bookings }] }
//
// Data comes from the mock reservations adapter (all roles see this — no role
// restriction per feature spec). Token validation via the outer authenticate
// middleware; client isolation is implicit (demo uses a single tenant).
//
// walkInPrediction shape:
//   { low, high, predicted, confidenceLabel, ratioUsed, weekCount }
// Display: "Expected walk-ins: ~{low}–{high} based on last week's trend ⓘ"

import { Router } from 'express';
import {
  getReservationsForDate,
  getDemoSaturdayReservations,
  DEMO_SAT,
} from './integrations/mock/reservations.js';

export function reservationsRouter() {
  const router = Router();

  // Default: return the demo Saturday (Scene 2 primary view).
  router.get('/reservations', (_req, res) => {
    const services = getDemoSaturdayReservations();
    res.json({ date: DEMO_SAT, services });
  });

  // Date-parameterised: allows Mon/Fri views without changing the default.
  router.get('/reservations/:date', (req, res) => {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'invalid_date_format' });
    }
    const services = getReservationsForDate(date);
    res.json({ date, services });
  });

  return router;
}
