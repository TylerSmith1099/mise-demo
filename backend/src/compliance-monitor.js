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
import {
  getRgRegister,
  getActiveInspection,
  getVenueCompliance,
} from './integrations/mock/compliance.js';

export const UNDERSTAFFING_EVENT_TYPE = 'gaming_understaffing';

// Register-derived alert event types (MIS-201, Scene 3). These are the
// additional alerts the Compliance Monitor emits alongside the live
// understaffing check so all of Scene 3 auto-fires on Duty Manager login.
export const RG_CERT_LAPSED_EVENT_TYPE = 'rg_cert_lapsed_on_floor';
export const INSPECTION_EVENT_TYPE = 'compliance_inspection_in_progress';
export const LICENCE_RENEWAL_EVENT_TYPE = 'liquor_licence_renewal_due';

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

// Idempotently insert one Critical/Warning compliance event for `venue` unless
// an unacknowledged one of the same event_type already exists. Runs inside the
// caller's RLS context (`q` is already client-scoped). staff_id is left NULL —
// the responsible staff member is named in the human-readable description, which
// avoids coupling to the demo's per-boot random staff UUIDs.
async function upsertEvent(q, { clientId, venueId, eventType, severity, description }) {
  const { rows: existing } = await q(
    `SELECT event_id, event_type, severity, description, created_at
       FROM compliance_events
      WHERE venue_id = $1 AND event_type = $2
        AND acknowledged_at IS NULL AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [venueId, eventType],
  );
  if (existing.length) {
    // Refresh description so cert dates / days counts stay current when the
    // row was first inserted on a prior calendar day (MIS-270).
    await q(
      `UPDATE compliance_events SET description = $2 WHERE event_id = $1`,
      [existing[0].event_id, description],
    );
    return { ...existing[0], description };
  }
  const { rows: ins } = await q(
    `INSERT INTO compliance_events
       (client_id, venue_id, staff_id, event_type, severity, description)
     VALUES ($1, $2, NULL, $3, $4, $5)
     RETURNING event_id, event_type, severity, description, created_at`,
    [clientId, venueId, eventType, severity, description],
  );
  return ins[0];
}

/**
 * Generate the register-derived Scene 3 alerts — RG certification lapsed on the
 * gaming floor, an inspection in progress, and the liquor-licence renewal due —
 * from the compliance register (the demo's single source of truth) and persist
 * them as compliance_events for the caller's venue. Idempotent per event_type,
 * so re-activation never duplicates. These are real, acknowledgeable rows, so
 * the must-ack banner flow (POST /compliance/alerts/:id/ack) works unchanged.
 *
 * @returns {Promise<Array>} the events that now exist for the venue.
 */
export async function generateRegisterAlerts({ clientId, venueId }) {
  return withClientContext(clientId, async (q) => {
    const out = [];

    // 1) RG certification lapsed for a staff member rostered on the gaming floor.
    const rgLapsed = getRgRegister().filter((r) => r.status === 'expired' && r.onGamingFloor);
    for (const r of rgLapsed) {
      out.push(
        await upsertEvent(q, {
          clientId, venueId,
          eventType: RG_CERT_LAPSED_EVENT_TYPE,
          severity: 'critical',
          description:
            `RG certification lapsed — ${r.name} (${r.role}) RG cert expired ${r.expiryDate} ` +
            `but is rostered on the gaming floor. Remove from the gaming floor ` +
            `immediately and arrange renewal.`,
        }),
      );
    }

    // 2) Compliance inspection in progress.
    const insp = getActiveInspection();
    if (insp.inProgress) {
      const arrived = new Date(insp.inspectorArrivedAt).toLocaleTimeString('en-AU', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Brisbane',
      });
      const requested = (insp.requested || []).join(' and ');
      out.push(
        await upsertEvent(q, {
          clientId, venueId,
          eventType: INSPECTION_EVENT_TYPE,
          severity: 'critical',
          description:
            `Compliance inspection in progress — inspector on site since ${arrived} ` +
            `(${insp.arrivedMinutesAgo}+ min) and has requested the ${requested}. ` +
            `Duty Manager action required.`,
        }),
      );
    }

    // 3) Liquor licence renewal due (amber).
    const venue = getVenueCompliance();
    if (venue.liquorLicence?.status === 'amber') {
      out.push(
        await upsertEvent(q, {
          clientId, venueId,
          eventType: LICENCE_RENEWAL_EVENT_TYPE,
          severity: 'warning',
          description:
            `Liquor licence renewal due — licence is amber and expires ${venue.liquorLicence.expiry}. ` +
            `Renewal process should already be underway.`,
        }),
      );
    }

    return out;
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

  // ---- POST /compliance/activate : emit Scene 3 alerts + arm Check-4 -------
  // The register-derived alerts (RG lapsed on floor, inspection in progress,
  // licence renewal) are emitted IMMEDIATELY so they surface on the Duty
  // Manager's first poll after login. The live understaffing check keeps its
  // deliberate ~10s "monitor detected it" beat.
  router.post('/compliance/activate', async (req, res, next) => {
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
    try {
      await generateRegisterAlerts({ clientId, venueId });
    } catch (err) {
      // Never fail activation on the register-alert path — the understaffing
      // timer and the alerts poll still proceed.
      console.error('[compliance-monitor] register alerts failed:', err.message);
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
              AND severity IN ('critical', 'warning')
              AND acknowledged_at IS NULL
              AND deleted_at IS NULL
            ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,
                     CASE event_type WHEN 'rg_cert_lapsed_on_floor' THEN 0 ELSE 1 END,
                     created_at DESC`,
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
