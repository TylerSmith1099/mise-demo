// Runsheet API — the shift task list behind the MIS-102 Runsheet tab (MIS-107).
//
//   GET  /api/runsheet                  -> the caller's current shift + its tasks:
//        { shiftDate, shiftLabel, items: [ { id, label, dueAt?, category?,
//          done, completedAt?, completedBy? } ] }
//   POST /api/runsheet/items/:id/check  -> { done } toggles a task. The server
//        stamps completedAt (now()) and completedBy (the verified staffId) on
//        completion, and clears them on un-check. Returns the reconciled row:
//        { id, done, completedAt, completedBy }.
//
// ISOLATION: every query runs through withClientContext(req.auth.clientId, ...),
// so a caller only ever sees/writes their own client's rows (RLS migration 005).
// staffId / venueId come from the VERIFIED token (req.auth), NEVER the body —
// in particular `completedBy` is the session's staffId, not a client-supplied
// value, so a caller can never attribute a completion to someone else.
//
// "Current shift": the caller's live shift (now() inside [shift_start, shift_end])
// if one exists, otherwise the shift whose start is closest to now. shiftLabel is
// derived from the local (venue-timezone) start hour: Morning / Afternoon / Evening.

import { Router } from 'express';
import { withClientContext } from './db.js';

// Local start hour -> a human shift label. Boundaries match the demo roster
// (day shifts open ~09:00, evening cover starts ~16:00).
function shiftLabelFromHour(hour) {
  if (hour == null) return null;
  if (hour < 12) return 'Morning';
  if (hour < 16) return 'Afternoon';
  return 'Evening';
}

// Find the caller's current shift (scoped to their client via RLS, their venue
// and staff_id via the verified token). Returns null when they have no shift.
async function currentShift(q, { staffId, venueId }) {
  return (
    await q(
      `SELECT sh.shift_id, sh.role_name, sh.shift_start, sh.shift_end, sh.status,
              v.timezone,
              EXTRACT(HOUR FROM sh.shift_start AT TIME ZONE v.timezone)::int AS local_start_hour
         FROM shifts sh
         JOIN venues v ON v.venue_id = sh.venue_id AND v.deleted_at IS NULL
        WHERE sh.staff_id = $1 AND sh.venue_id = $2 AND sh.deleted_at IS NULL
        ORDER BY (now() BETWEEN sh.shift_start AND sh.shift_end) DESC,
                 ABS(EXTRACT(EPOCH FROM (sh.shift_start - now())))
        LIMIT 1`,
      [staffId, venueId],
    )
  ).rows[0] || null;
}

// Build the runsheet payload for the caller inside an already-scoped query fn.
export async function buildRunsheet(q, { staffId, venueId }) {
  const shift = await currentShift(q, { staffId, venueId });
  if (!shift) return null;

  const items = (
    await q(
      // due_by is a local clock TIME; combine it with the shift's local date and
      // the venue timezone to produce a correct UTC instant for the UI.
      `SELECT ri.item_id,
              ri.task_description,
              CASE WHEN ri.due_by IS NULL THEN NULL
                   ELSE ((sh.shift_start AT TIME ZONE v.timezone)::date + ri.due_by)
                        AT TIME ZONE v.timezone
              END AS due_at,
              ri.category,
              ri.completed_at,
              NULLIF(TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')), '')
                AS completed_by_name
         FROM runsheet_items ri
         JOIN shifts sh ON sh.shift_id = ri.shift_id AND sh.deleted_at IS NULL
         JOIN venues v  ON v.venue_id = sh.venue_id AND v.deleted_at IS NULL
         LEFT JOIN staff s ON s.staff_id = ri.completed_by AND s.deleted_at IS NULL
        WHERE ri.shift_id = $1 AND ri.deleted_at IS NULL
        ORDER BY ri.item_order, ri.created_at`,
      [shift.shift_id],
    )
  ).rows.map((r) => ({
    id: r.item_id,
    label: r.task_description,
    dueAt: r.due_at || undefined,
    category: r.category || undefined,
    done: r.completed_at != null,
    completedAt: r.completed_at || undefined,
    completedBy: r.completed_by_name || undefined,
  }));

  return {
    shiftDate: shift.shift_start,
    shiftLabel: shiftLabelFromHour(shift.local_start_hour),
    items,
  };
}

// Toggle a runsheet item's completion. `done` decides direction; the WHO/WHEN are
// server-derived (staffId from the token, now() from the DB) — never the body.
// Returns null when the id doesn't resolve in the caller's client (RLS / bad id).
export async function setItemDone(q, { itemId, staffId, done }) {
  const row = (
    await q(
      `WITH upd AS (
         UPDATE runsheet_items
            SET completed_at = CASE WHEN $2 THEN now() ELSE NULL END,
                completed_by = CASE WHEN $2 THEN $3::uuid ELSE NULL END
          WHERE item_id = $1::uuid AND deleted_at IS NULL
          RETURNING item_id, completed_at, completed_by
       )
       SELECT upd.item_id, upd.completed_at,
              NULLIF(TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')), '')
                AS completed_by_name
         FROM upd
         LEFT JOIN staff s ON s.staff_id = upd.completed_by AND s.deleted_at IS NULL`,
      [itemId, done, staffId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    id: row.item_id,
    done: row.completed_at != null,
    completedAt: row.completed_at || null,
    completedBy: row.completed_by_name || null,
  };
}

export function runsheetRouter() {
  const router = Router();

  router.get('/runsheet', async (req, res, next) => {
    try {
      const { clientId, staffId, venueId } = req.auth;
      const sheet = await withClientContext(clientId, (q) =>
        buildRunsheet(q, { staffId, venueId }),
      );
      if (!sheet) return res.status(404).json({ error: 'no_current_shift' });
      res.json(sheet);
    } catch (err) {
      next(err);
    }
  });

  router.post('/runsheet/items/:id/check', async (req, res, next) => {
    try {
      const { clientId, staffId } = req.auth;
      const done = Boolean(req.body?.done);
      const result = await withClientContext(clientId, (q) =>
        setItemDone(q, { itemId: req.params.id, staffId, done }),
      );
      if (!result) return res.status(404).json({ error: 'item_not_found' });
      res.json(result);
    } catch (err) {
      // A malformed UUID is a client error, not a server fault.
      if (err && /invalid input syntax for type uuid/i.test(err.message || '')) {
        return res.status(404).json({ error: 'item_not_found' });
      }
      next(err);
    }
  });

  return router;
}
