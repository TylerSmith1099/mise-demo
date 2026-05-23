// Compliance Monitor — MIS-44 / MIS-26 Demo Scene 3.
//
// Implements Check 4 (Gaming Understaffing) of the Compliance Monitor and the
// alert-delivery surface the mobile UI uses to show the Critical banner.
//
// FLOW
//   POST /api/compliance/activate            -> a Duty Manager "activates" the
//        monitor for their venue. After a 10-second delay we run Check 4 against
//        LIVE roster data and, if the gaming floor is short, write ONE Critical
//        `compliance_events` row (event_type `gaming_understaffing`). Idempotent:
//        re-activating, or an already-open unacknowledged alert, never duplicates.
//   GET  /api/compliance/alerts              -> the active (unacknowledged,
//        not-deleted) Critical alerts for the caller's venue. The UI polls this
//        and renders the red banner from whatever it returns.
//   POST /api/compliance/alerts/:eventId/ack -> dismiss requires a TYPED action
//        note (the logged acknowledgement). Persists acknowledged_at +
//        acknowledged_by to compliance_events and appends the note to the audit
//        description. A banner cannot be cleared any other way.
//
// ISOLATION: every query runs through withClientContext(req.auth.clientId, …);
// clientId / venueId / staffId all come from the VERIFIED token, never the body.
// The deferred Check-4 timer captures only those verified ids.

import { Router } from 'express';
import { withClientContext } from './db.js';

export const UNDERSTAFFING_EVENT_TYPE = 'gaming_understaffing';
// Demo trigger delay. Overridable for tests; the spec calls for ~10s.
export const ACTIVATION_DELAY_MS = Number(process.env.COMPLIANCE_DELAY_MS || 10000);

// In-flight activation timers, keyed by client:venue, so repeated activations
// during the delay window collapse to a single scheduled check (idempotent).
const pendingChecks = new Set();

/**
 * Check 4 — Gaming Understaffing. Runs against live roster data inside the
 * caller's client RLS context and, if the gaming floor is below the venue
 * minimum RIGHT NOW, writes a single Critical compliance_events row.
 *
 * Idempotent: if an unacknowledged Critical understaffing alert already exists
 * for the venue, it is returned as-is and nothing new is written.
 *
 * @returns the active alert row, or null if the floor is adequately staffed.
 */
export async function runUnderstaffingCheck({ clientId, venueId }) {
  return withClientContext(clientId, async (q) => {
    const { rows: vrows } = await q(
      `SELECT venue_name, state, timezone, gaming_min_attendants, egm_count
         FROM venues WHERE venue_id = $1 AND deleted_at IS NULL`,
      [venueId],
    );
    const venue = vrows[0];
    if (!venue) return null;

    // Attendants on the gaming floor right now: active gaming shifts whose
    // window spans the current instant.
    const { rows: shiftRows } = await q(
      `SELECT s.shift_id, s.shift_start, s.shift_end,
              st.first_name, st.last_name
         FROM shifts s
         JOIN staff st ON st.staff_id = s.staff_id AND st.deleted_at IS NULL
        WHERE s.venue_id = $1
          AND s.department = 'gaming'
          AND s.status = 'active'
          AND s.deleted_at IS NULL
          AND now() BETWEEN s.shift_start AND s.shift_end
        ORDER BY s.shift_start`,
      [venueId],
    );

    const onFloor = shiftRows.length;
    const minAttendants = venue.gaming_min_attendants;
    const shortBy = minAttendants - onFloor;
    if (shortBy <= 0) return null; // adequately staffed — no alert

    // Idempotency: reuse an already-open Critical understaffing alert.
    const { rows: existing } = await q(
      `SELECT event_id, event_type, severity, description, created_at, acknowledged_at
         FROM compliance_events
        WHERE venue_id = $1 AND event_type = $2 AND severity = 'critical'
          AND acknowledged_at IS NULL AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [venueId, UNDERSTAFFING_EVENT_TYPE],
    );
    if (existing.length) return existing[0];

    const tz = venue.timezone || 'Australia/Brisbane';
    // shiftRows may be empty (nobody on the floor at all) — guard the time read so
    // a fully-empty floor still fires a clean Critical alert instead of throwing.
    const startTime = shiftRows.length
      ? new Date(shiftRows[0].shift_start).toLocaleTimeString('en-AU', {
          hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
        })
      : null;
    const names = shiftRows.map((r) => `${r.first_name} ${r.last_name}`).join(', ') || 'nobody';
    const plural = onFloor === 1 ? 'attendant' : 'attendants';
    const whenClause = startTime ? ` (from ${startTime})` : '';

    const description =
      `Gaming floor understaffed — tonight's gaming evening shift${whenClause} ` +
      `has ${onFloor} ${plural} on the floor (${names}) but the ${venue.egm_count}-machine ` +
      `floor requires a minimum of ${minAttendants}. ${shortBy} short. ` +
      `Roster a second gaming attendant or restrict the floor.`;

    const { rows: ins } = await q(
      `INSERT INTO compliance_events
         (client_id, venue_id, staff_id, event_type, severity, description)
       VALUES ($1, $2, NULL, $3, 'critical', $4)
       RETURNING event_id, event_type, severity, description, created_at, acknowledged_at`,
      [clientId, venueId, UNDERSTAFFING_EVENT_TYPE, description],
    );
    return ins[0];
  });
}

function toAlert(row) {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    severity: row.severity,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function complianceRouter({ delayMs = ACTIVATION_DELAY_MS } = {}) {
  const router = Router();

  // ---- POST /compliance/activate : arm the 10s Check-4 trigger -------------
  router.post('/compliance/activate', (req, res) => {
    const { clientId, venueId } = req.auth;
    const key = `${clientId}:${venueId}`;
    if (!pendingChecks.has(key)) {
      pendingChecks.add(key);
      const timer = setTimeout(() => {
        runUnderstaffingCheck({ clientId, venueId })
          .catch((err) => console.error('[compliance-monitor] check failed:', err.message))
          .finally(() => pendingChecks.delete(key));
      }, delayMs);
      // Don't keep the event loop (or a test process) alive on this timer.
      timer.unref?.();
    }
    res.json({ activated: true, checkInSeconds: Math.round(delayMs / 1000) });
  });

  // ---- GET /compliance/alerts : active Critical alerts for the venue -------
  router.get('/compliance/alerts', async (req, res, next) => {
    try {
      const { clientId, venueId } = req.auth;
      const rows = await withClientContext(clientId, async (q) => {
        const { rows } = await q(
          `SELECT event_id, event_type, severity, description, created_at
             FROM compliance_events
            WHERE venue_id = $1
              AND severity = 'critical'
              AND acknowledged_at IS NULL
              AND deleted_at IS NULL
            ORDER BY created_at DESC`,
          [venueId],
        );
        return rows;
      });
      res.json({ alerts: rows.map(toAlert) });
    } catch (err) {
      next(err);
    }
  });

  // ---- POST /compliance/alerts/:eventId/ack : typed acknowledgement --------
  router.post('/compliance/alerts/:eventId/ack', async (req, res, next) => {
    try {
      const { clientId, staffId } = req.auth;
      const { eventId } = req.params;
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
      if (note.length < 3) {
        return res.status(400).json({ error: 'acknowledgement_note_required' });
      }
      const updated = await withClientContext(clientId, async (q) => {
        const { rows } = await q(
          `UPDATE compliance_events
              SET acknowledged_at = now(),
                  acknowledged_by = $2,
                  description = description || E'\n\n— Acknowledged action: ' || $3
            WHERE event_id = $1
              AND acknowledged_at IS NULL
              AND deleted_at IS NULL
            RETURNING event_id, acknowledged_at, acknowledged_by`,
          [eventId, staffId, note],
        );
        return rows[0] || null;
      });
      if (!updated) {
        return res.status(404).json({ error: 'alert_not_found_or_already_acknowledged' });
      }
      res.json({
        acknowledged: true,
        eventId: updated.event_id,
        acknowledgedAt: updated.acknowledged_at,
        acknowledgedBy: updated.acknowledged_by,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
