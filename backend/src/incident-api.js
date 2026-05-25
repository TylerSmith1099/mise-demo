// incident-api.js — Incident reporting matrix API.
//
// Routes (all behind authenticate()):
//   GET  /api/incidents            — list incidents for venue (role-filtered)
//   GET  /api/incidents/:id        — incident detail with obligations + notifications
//   POST /api/incidents            — create a draft incident report
//   POST /api/incidents/:id/submit — submit draft → triggers obligation + notification rows
//
// Role access:
//   Tier 7 (Gaming Attendant): own incidents only
//   Tier 5 (Duty Manager):     all incidents for their venue
//   Tier 4 (Venue Manager):    all incidents for their venue
//
// AUSTRAC tipping-off rule: SMR fields are hidden at all tiers below Compliance Officer.
// Compliance Officer is not an MVP login tier (not in JWT tier map), so SMR content
// is not surfaced in this build. The obligation row IS created (audit trail), but
// the conditionalFields for austrac are not returned to any current MVP role.
//
// Medical emergency first-aid conditional block is gated behind MEDICAL_FIRST_AID_GATE.

import { Router } from 'express';
import { withClientContext } from './db.js';
import { requireTier } from './permissions.js';
import {
  getRouting,
  getObligationTypes,
  getNotificationRoles,
  calcDueBy,
  isConfirmLegal,
  SEVERITY_LABELS,
  SEVERITY_COLOURS,
  OBLIGATION_LABELS,
  NOTIFICATION_ROLE_LABELS,
  INCIDENT_TYPE_LABELS,
  MEDICAL_FIRST_AID_GATE,
} from './incident-matrix.js';

// Tiers that may access incident endpoints.
const INCIDENT_TIERS = [4, 5, 7];

export function incidentRouter() {
  const router = Router();

  // ---- List incidents -------------------------------------------------------
  router.get('/incidents', requireTier(INCIDENT_TIERS), async (req, res, next) => {
    try {
      const { clientId, venueId, staffId, roleTier } = req.auth;

      const rows = await withClientContext(clientId, (q) => {
        // Tier 7: own incidents only.
        if (roleTier === 7) {
          return q(
            `SELECT incident_id, incident_type, severity_level, status,
                    incident_at, location_in_venue, description, created_at
               FROM incident_reports
              WHERE venue_id = $1
                AND reported_by_staff_id = $2
                AND deleted_at IS NULL
              ORDER BY incident_at DESC
              LIMIT 50`,
            [venueId, staffId],
          ).then((r) => r.rows);
        }
        // Tier 4/5: full venue view.
        return q(
          `SELECT ir.incident_id, ir.incident_type, ir.severity_level, ir.status,
                  ir.incident_at, ir.location_in_venue, ir.description, ir.created_at,
                  s.full_name AS reported_by_name
             FROM incident_reports ir
             LEFT JOIN staff s ON s.staff_id = ir.reported_by_staff_id
                               AND s.client_id = ir.client_id
            WHERE ir.venue_id = $1
              AND ir.deleted_at IS NULL
            ORDER BY ir.incident_at DESC
            LIMIT 100`,
          [venueId],
        ).then((r) => r.rows);
      });

      const incidents = rows.map((r) => ({
        incidentId:      r.incident_id,
        incidentType:    r.incident_type,
        incidentLabel:   INCIDENT_TYPE_LABELS[r.incident_type] || r.incident_type,
        severityLevel:   r.severity_level,
        severityLabel:   SEVERITY_LABELS[r.severity_level],
        severityColour:  SEVERITY_COLOURS[r.severity_level],
        status:          r.status,
        incidentAt:      r.incident_at,
        locationInVenue: r.location_in_venue,
        description:     r.description,
        reportedByName:  r.reported_by_name || null,
        createdAt:       r.created_at,
        // Routing summary for list view.
        routing: buildRoutingSummary(r.incident_type),
      }));

      res.json({ incidents });
    } catch (err) {
      next(err);
    }
  });

  // ---- Get incident detail --------------------------------------------------
  router.get('/incidents/:id', requireTier(INCIDENT_TIERS), async (req, res, next) => {
    try {
      const { clientId, venueId, staffId, roleTier } = req.auth;
      const { id } = req.params;

      const [report, obligations, notifications] = await withClientContext(clientId, (q) =>
        Promise.all([
          // Core report — enforce own-only for tier 7.
          q(
            `SELECT ir.*,
                    rs.full_name AS reported_by_name,
                    dm.full_name AS duty_manager_name
               FROM incident_reports ir
               LEFT JOIN staff rs ON rs.staff_id = ir.reported_by_staff_id AND rs.client_id = ir.client_id
               LEFT JOIN staff dm ON dm.staff_id = ir.duty_manager_staff_id AND dm.client_id = ir.client_id
              WHERE ir.incident_id = $1
                AND ir.venue_id = $2
                AND ir.deleted_at IS NULL
                ${roleTier === 7 ? 'AND ir.reported_by_staff_id = $3' : ''}`,
            roleTier === 7 ? [id, venueId, staffId] : [id, venueId],
          ).then((r) => r.rows[0] || null),

          q(
            `SELECT obligation_id, obligation_type, due_by, fulfilled_at, reference_number, notes, created_at
               FROM incident_reporting_obligations
              WHERE incident_id = $1
              ORDER BY created_at`,
            [id],
          ).then((r) => r.rows),

          q(
            `SELECT n.notification_id, n.notification_role, n.notification_method,
                    n.sent_at, n.acknowledged_at,
                    s.full_name AS notified_name
               FROM incident_notifications n
               LEFT JOIN staff s ON s.staff_id = n.notified_staff_id AND s.client_id = n.client_id
              WHERE n.incident_id = $1
              ORDER BY n.sent_at`,
            [id],
          ).then((r) => r.rows),
        ]),
      );

      if (!report) return res.status(404).json({ error: 'not_found' });

      res.json(formatDetail(report, obligations, notifications, roleTier));
    } catch (err) {
      next(err);
    }
  });

  // ---- Create draft incident -----------------------------------------------
  router.post('/incidents', requireTier(INCIDENT_TIERS), async (req, res, next) => {
    try {
      const { clientId, venueId, staffId, roleTier } = req.auth;
      const {
        incident_type,
        incident_at,
        location_in_venue,
        description,
        immediate_action_taken,
        patron_description,
        witnesses,
        police_called = false,
        police_reference,
        ambulance_called = false,
        ambulance_reference,
        injuries_or_damage,
        triage_conversation_id,
        triage_answers,
      } = req.body || {};

      if (!incident_type) return res.status(400).json({ error: 'incident_type required' });
      if (!location_in_venue) return res.status(400).json({ error: 'location_in_venue required' });
      if (!description) return res.status(400).json({ error: 'description required' });
      if (!immediate_action_taken) return res.status(400).json({ error: 'immediate_action_taken required' });

      let routing;
      try {
        routing = getRouting(incident_type);
      } catch {
        return res.status(400).json({ error: 'invalid incident_type' });
      }

      const incidentAt = incident_at ? new Date(incident_at).toISOString() : new Date().toISOString();

      const row = await withClientContext(clientId, (q) =>
        q(
          `INSERT INTO incident_reports (
              client_id, venue_id, reported_by_staff_id,
              incident_type, severity_level,
              incident_at, location_in_venue,
              description, immediate_action_taken,
              patron_description, witnesses, injuries_or_damage,
              police_called, police_reference,
              ambulance_called, ambulance_reference,
              triage_conversation_id, triage_answers,
              status
           ) VALUES (
              $1, $2, $3,
              $4, $5,
              $6, $7,
              $8, $9,
              $10, $11, $12,
              $13, $14,
              $15, $16,
              $17, $18,
              'draft'
           )
           RETURNING incident_id, incident_type, severity_level, status, incident_at`,
          [
            clientId, venueId, staffId,
            incident_type, routing.severityLevel,
            incidentAt, location_in_venue,
            description, immediate_action_taken,
            patron_description || null, witnesses || null, injuries_or_damage || null,
            police_called, police_reference || null,
            ambulance_called, ambulance_reference || null,
            triage_conversation_id || null,
            triage_answers ? JSON.stringify(triage_answers) : null,
          ],
        ).then((r) => r.rows[0]),
      );

      // For L4 incidents: draft is immediately flagged / notifications fire now
      // (spec: "draft reports from L4 incidents are pushed to Venue Manager
      //  immediately on classification — not waiting for staff submission").
      if (routing.severityLevel === 4) {
        await fireNotifications(clientId, venueId, row.incident_id, incident_type);
      }

      res.status(201).json({
        incidentId:    row.incident_id,
        incidentType:  row.incident_type,
        severityLevel: row.severity_level,
        severityLabel: SEVERITY_LABELS[row.severity_level],
        status:        row.status,
        incidentAt:    row.incident_at,
        routing:       buildRoutingSummary(incident_type),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- Submit draft --------------------------------------------------------
  router.post('/incidents/:id/submit', requireTier(INCIDENT_TIERS), async (req, res, next) => {
    try {
      const { clientId, venueId, staffId, roleTier } = req.auth;
      const { id } = req.params;

      const report = await withClientContext(clientId, (q) =>
        q(
          `SELECT incident_id, incident_type, severity_level, status, reported_by_staff_id
             FROM incident_reports
            WHERE incident_id = $1 AND venue_id = $2 AND deleted_at IS NULL`,
          [id, venueId],
        ).then((r) => r.rows[0] || null),
      );

      if (!report) return res.status(404).json({ error: 'not_found' });
      if (report.status !== 'draft') return res.status(409).json({ error: 'already_submitted' });

      // Tier 7 can only submit their own reports.
      if (roleTier === 7 && report.reported_by_staff_id !== staffId) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const now = new Date().toISOString();

      // Stamp submitted_at.
      await withClientContext(clientId, (q) =>
        q(
          `UPDATE incident_reports
              SET status = 'submitted', submitted_at = $1
            WHERE incident_id = $2`,
          [now, id],
        ),
      );

      // Create obligation rows (if not already created for L4 on-creation path).
      await createObligations(clientId, id, report.incident_type, now);

      // Fire notifications (idempotent — won't duplicate for L4 which fires on create).
      if (report.severity_level < 4) {
        await fireNotifications(clientId, venueId, id, report.incident_type);
      }

      res.json({ incidentId: id, status: 'submitted', submittedAt: now });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers

function buildRoutingSummary(incidentType) {
  const routing = getRouting(incidentType);
  const obligationTypes = getObligationTypes(incidentType);

  return {
    severityLevel:  routing.severityLevel,
    severityLabel:  SEVERITY_LABELS[routing.severityLevel],
    severityColour: SEVERITY_COLOURS[routing.severityLevel],
    policeFirst:    routing.policeFirst,
    medicalGate:    routing.medicalGate && !MEDICAL_FIRST_AID_GATE,
    obligations: obligationTypes.map((type) => ({
      type,
      label:        OBLIGATION_LABELS[type] || type,
      confirmLegal: isConfirmLegal(incidentType, type),
      dueDays:      type === 'austrac_ttr' ? 10 : type === 'austrac_smr' ? 3 : null,
    })),
    notifications: routing.notifications.map((role) => ({
      role,
      label: NOTIFICATION_ROLE_LABELS[role] || role,
    })),
    conditionalFields: routing.conditionalFields,
  };
}

function formatDetail(report, obligations, notifications, roleTier) {
  const routing = buildRoutingSummary(report.incident_type);

  // AUSTRAC tipping-off rule: hide SMR obligation content from non-Compliance Officer.
  // MVP roles (4, 5, 7) do not include Compliance Officer — SMR obligation is
  // listed as "Compliance review in progress" at all current MVP tiers.
  const safeObligations = obligations.map((o) => {
    if (o.obligation_type === 'austrac_smr') {
      return {
        obligationId:    o.obligation_id,
        type:            o.obligation_type,
        label:           'Compliance review in progress',
        confirmLegal:    false,
        austracHidden:   true,
        fulfilledAt:     o.fulfilled_at,
        dueBy:           o.due_by,
      };
    }
    return {
      obligationId:  o.obligation_id,
      type:          o.obligation_type,
      label:         OBLIGATION_LABELS[o.obligation_type] || o.obligation_type,
      confirmLegal:  isConfirmLegal(report.incident_type, o.obligation_type),
      fulfilledAt:   o.fulfilled_at,
      referenceNumber: o.reference_number,
      notes:         o.notes,
      dueBy:         o.due_by,
    };
  });

  return {
    incidentId:           report.incident_id,
    incidentType:         report.incident_type,
    incidentLabel:        INCIDENT_TYPE_LABELS[report.incident_type] || report.incident_type,
    severityLevel:        report.severity_level,
    severityLabel:        SEVERITY_LABELS[report.severity_level],
    severityColour:       SEVERITY_COLOURS[report.severity_level],
    status:               report.status,
    incidentAt:           report.incident_at,
    locationInVenue:      report.location_in_venue,
    reportedByName:       report.reported_by_name || null,
    dutyManagerName:      report.duty_manager_name || null,
    description:          report.description,
    immediateActionTaken: report.immediate_action_taken,
    patronDescription:    report.patron_description,
    witnesses:            report.witnesses,
    injuriesOrDamage:     report.injuries_or_damage,
    policeCalled:         report.police_called,
    policeReference:      report.police_reference,
    ambulanceCalled:      report.ambulance_called,
    ambulanceReference:   report.ambulance_reference,
    submittedAt:          report.submitted_at,
    acknowledgedAt:       report.acknowledged_at,
    createdAt:            report.created_at,
    routing,
    obligations:          safeObligations,
    notifications:        notifications.map((n) => ({
      notificationId:   n.notification_id,
      role:             n.notification_role,
      roleLabel:        NOTIFICATION_ROLE_LABELS[n.notification_role] || n.notification_role,
      method:           n.notification_method,
      sentAt:           n.sent_at,
      acknowledgedAt:   n.acknowledged_at,
      notifiedName:     n.notified_name || null,
    })),
  };
}

async function createObligations(clientId, incidentId, incidentType, submittedAt) {
  const types = getObligationTypes(incidentType);
  if (!types.length) return;

  await withClientContext(clientId, async (q) => {
    for (const type of types) {
      const dueBy = calcDueBy(type, submittedAt);
      await q(
        `INSERT INTO incident_reporting_obligations
            (incident_id, client_id, obligation_type, due_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (incident_id, obligation_type) DO NOTHING`,
        [incidentId, clientId, type, dueBy],
      );
    }
  });
}

async function fireNotifications(clientId, venueId, incidentId, incidentType) {
  const roles = getNotificationRoles(incidentType);
  if (!roles.length) return;

  await withClientContext(clientId, async (q) => {
    for (const role of roles) {
      // Resolve to a staff_id if any staff member holds this role at the venue.
      const staffRow = await q(
        `SELECT staff_id FROM staff
          WHERE client_id = $1 AND venue_id = $2
            AND role_name = $3 AND deleted_at IS NULL
          LIMIT 1`,
        [clientId, venueId, role],
      ).then((r) => r.rows[0] || null);

      await q(
        `INSERT INTO incident_notifications
            (incident_id, client_id, notification_role, notified_staff_id, notification_method)
         VALUES ($1, $2, $3, $4, 'in_app')
         ON CONFLICT DO NOTHING`,
        [incidentId, clientId, role, staffRow?.staff_id || null],
      );
    }
  });
}
