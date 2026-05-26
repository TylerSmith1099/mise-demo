/**
 * Admin Desktop Homepage API (MIS-412)
 *
 * Routes (all behind authenticate() → requireAccess() → attachScope()):
 *
 *   GET /api/admin/homepage          — composable homepage payload
 *   GET /api/admin/shifts/on-floor   — live: who is clocked in now
 *   GET /api/admin/incidents         — filtered list (status/severity/date range)
 *   GET /api/admin/incidents/:id     — incident detail
 *   GET /api/admin/reports/queue     — draft/awaiting-signoff/escalated
 *   GET /api/admin/compliance/alerts — unacknowledged compliance events
 *   GET /api/admin/revenue/daily     — revenue actuals + variance (scheduled)
 *   GET /api/admin/labour/daily      — labour cost + budget variance (scheduled)
 *   GET /api/admin/data-freshness    — per-connection staleness indicators
 *   GET /api/admin/stream            — SSE: live incidents, floor, compliance
 *
 * Security model (two independent gates, both mandatory):
 *   Gate 1 — Client isolation: withClientContext() sets app.current_client_id
 *             from the verified JWT; RLS makes cross-client rows invisible.
 *   Gate 2 — Intra-client scope: attachScope() resolves the caller's authorised
 *             venue set. Every section query appends AND venue_id = ANY($venueIds).
 *             A venueId param not in scope returns 403, not empty.
 *
 * Architecture ref: Admin-Homepage-Architecture-V1.md §4, §5
 */

import { EventEmitter } from 'node:events';
import { Router } from 'express';
import { withClientContext } from '../db.js';
import { requireAccess } from '../permissions.js';
import { attachScope, isVenueInScope } from './scope.js';

// ---------------------------------------------------------------------------
// SSE event bus — in-process fan-out for live sections.
// MVP: single-process emitter. AU data residency is automatic (in-process).
// Scale path: replace with a pub/sub backed by AWS SNS/SQS (ap-southeast-*).
// ---------------------------------------------------------------------------
export const adminEventBus = new EventEmitter();
adminEventBus.setMaxListeners(500); // support up to 500 concurrent SSE connections

// Event names emitted by route handlers when data changes.
export const AdminEvent = Object.freeze({
  INCIDENT_NEW:       'incident:new',
  INCIDENT_UPDATED:   'incident:updated',
  STAFF_CLOCK_IN:     'staff:clock_in',
  STAFF_CLOCK_OUT:    'staff:clock_out',
  COMPLIANCE_ALERT:   'compliance:alert_new',
});

// ---------------------------------------------------------------------------
// Query helpers — all parameterised, all scoped to venueIds.
// ---------------------------------------------------------------------------

async function queryShiftsOnFloor(q, venueIds) {
  return q(
    `SELECT s.shift_id, s.venue_id, s.staff_id, s.role_name,
            s.shift_start AS start_time, s.shift_end AS end_time,
            s.clock_in_at, s.clock_out_at,
            s.status, TRIM(st.first_name || ' ' || st.last_name) AS full_name
       FROM shifts s
       LEFT JOIN staff st ON st.staff_id = s.staff_id AND st.client_id = s.client_id
      WHERE s.venue_id = ANY($1)
        AND s.status = 'active'
        AND s.clock_in_at IS NOT NULL
        AND s.clock_out_at IS NULL
        AND s.deleted_at IS NULL
      ORDER BY s.clock_in_at DESC`,
    [venueIds],
  ).then((r) => r.rows);
}

async function queryIncidents(q, venueIds, { status, severity, from, to, limit = 100 }) {
  const conditions = [
    'ir.venue_id = ANY($1)',
    'ir.deleted_at IS NULL',
  ];
  const params = [venueIds];
  let idx = 2;

  if (status) {
    conditions.push(`ir.status = $${idx++}`);
    params.push(status);
  }
  if (severity) {
    conditions.push(`ir.severity_level = $${idx++}`);
    params.push(Number(severity));
  }
  if (from) {
    conditions.push(`ir.incident_at >= $${idx++}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`ir.incident_at <= $${idx++}`);
    params.push(to);
  }

  return q(
    `SELECT ir.incident_id, ir.incident_type, ir.severity_level, ir.status,
            ir.incident_at, ir.location_in_venue, ir.description, ir.created_at,
            ir.venue_id, TRIM(st.first_name || ' ' || st.last_name) AS reported_by_name
       FROM incident_reports ir
       LEFT JOIN staff st ON st.staff_id = ir.reported_by_staff_id
                          AND st.client_id = ir.client_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ir.incident_at DESC
      LIMIT ${Number.isFinite(limit) ? Math.min(limit, 500) : 100}`,
    params,
  ).then((r) => r.rows);
}

async function queryReportsQueue(q, venueIds) {
  return q(
    `SELECT ir.incident_id, ir.incident_type, ir.severity_level, ir.status,
            ir.incident_at, ir.venue_id,
            iro.obligation_type, iro.due_by,
            (iro.fulfilled_at IS NOT NULL) AS fulfilled
       FROM incident_reports ir
       LEFT JOIN incident_reporting_obligations iro ON iro.incident_id = ir.incident_id
                                                    AND iro.client_id = ir.client_id
      WHERE ir.venue_id = ANY($1)
        AND ir.status IN ('draft', 'submitted', 'escalated')
        AND ir.deleted_at IS NULL
      ORDER BY ir.incident_at DESC
      LIMIT 200`,
    [venueIds],
  ).then((r) => r.rows);
}

async function queryComplianceAlerts(q, venueIds) {
  return q(
    `SELECT event_id, venue_id, event_type, severity, description,
            created_at AS triggered_at,
            (acknowledged_at IS NOT NULL) AS acknowledged,
            acknowledged_at, acknowledged_by AS acknowledged_by_staff_id
       FROM compliance_events
      WHERE venue_id = ANY($1)
        AND acknowledged_at IS NULL
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 50`,
    [venueIds],
  ).then((r) => r.rows);
}

async function queryRevenue(q, venueIds, { from, to, venueId }) {
  const conditions = ['venue_id = ANY($1)', 'deleted_at IS NULL'];
  const params = [venueIds];
  let idx = 2;

  if (venueId) {
    conditions.push(`venue_id = $${idx++}`);
    params.push(venueId);
  }
  if (from) {
    conditions.push(`business_date >= $${idx++}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`business_date <= $${idx++}`);
    params.push(to);
  }

  return q(
    `SELECT revenue_id, venue_id, business_date,
            gross_revenue_cents, net_revenue_cents, transaction_count,
            forecast_revenue_cents, variance_cents, source, is_stale, synced_at
       FROM revenue_daily
      WHERE ${conditions.join(' AND ')}
      ORDER BY business_date DESC, venue_id
      LIMIT 500`,
    params,
  ).then((r) => r.rows);
}

async function queryLabour(q, venueIds, { from, to, venueId }) {
  const laConditions = ['la.venue_id = ANY($1)', 'la.deleted_at IS NULL'];
  const params = [venueIds];
  let idx = 2;

  if (venueId) {
    laConditions.push(`la.venue_id = $${idx++}`);
    params.push(venueId);
  }
  if (from) {
    laConditions.push(`la.business_date >= $${idx++}`);
    params.push(from);
  }
  if (to) {
    laConditions.push(`la.business_date <= $${idx++}`);
    params.push(to);
  }

  return q(
    `SELECT la.labour_id, la.venue_id, la.business_date,
            la.worked_hours, la.labour_cost_cents,
            la.budgeted_hours, la.budgeted_cost_cents,
            la.source, la.is_stale, la.synced_at,
            rd.net_revenue_cents
       FROM labour_actuals_daily la
       LEFT JOIN revenue_daily rd ON rd.venue_id = la.venue_id
                                  AND rd.business_date = la.business_date
                                  AND rd.client_id = la.client_id
                                  AND rd.deleted_at IS NULL
      WHERE ${laConditions.join(' AND ')}
      ORDER BY la.business_date DESC, la.venue_id
      LIMIT 500`,
    params,
  ).then((r) => r.rows);
}

async function queryDataFreshness(q, venueIds) {
  return q(
    // integration_connections are client-scoped (no venue_id column); RLS already
    // confines rows to the caller's client. venueIds is unused here by design.
    `SELECT ic.id, ic.vendor, ic.status,
            ic.last_synced_at, ic.last_sync_status,
            ic.is_stale, ic.stale_since, ic.stale_reason
       FROM integration_connections ic
      WHERE ic.status != 'disconnected'
        AND ic.deleted_at IS NULL
      ORDER BY ic.vendor`,
    [],
  ).then((r) => r.rows);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function adminHomepageRouter() {
  const router = Router();

  // Middleware chain for all admin routes: authenticate (in app.js) → requireAccess → attachScope.
  // requireAccess for the composable homepage; individual section endpoints use their own resource key.
  const adminGuard = [requireAccess('admin-homepage'), attachScope];
  const revenueGuard = [requireAccess('admin-revenue'), attachScope];
  const labourGuard = [requireAccess('admin-labour'), attachScope];
  const incidentGuard = [requireAccess('admin-incidents'), attachScope];
  const streamGuard = [requireAccess('admin-stream'), attachScope];

  // ---- GET /api/admin/homepage (composable, single request) -----------------
  router.get('/admin/homepage', adminGuard, async (req, res, next) => {
    try {
      const { clientId } = req.auth;
      const { venueIds } = req.scope;

      // NB: every query runs on the SAME RLS-scoped connection `q`. node-postgres
      // cannot execute concurrent queries on one client, so these MUST be awaited
      // sequentially — Promise.all here would race the single connection and throw.
      const data = await withClientContext(clientId, async (q) => {
        const shiftsOnFloor   = await queryShiftsOnFloor(q, venueIds);
        const incidents       = await queryIncidents(q, venueIds, { limit: 20 });
        const reportsQueue    = await queryReportsQueue(q, venueIds);
        const complianceAlerts = await queryComplianceAlerts(q, venueIds);
        const revenue         = await queryRevenue(q, venueIds, { from: sevenDaysAgo(), to: today() });
        const labour          = await queryLabour(q, venueIds, { from: sevenDaysAgo(), to: today() });
        const dataFreshness   = await queryDataFreshness(q, venueIds);
        return { shiftsOnFloor, incidents, reportsQueue, complianceAlerts,
                 revenue, labour, dataFreshness };
      });

      res.json({
        scope: { venueIds },
        shiftSummary: {
          onFloorNow: data.shiftsOnFloor.length,
          shifts: data.shiftsOnFloor,
        },
        incidents: data.incidents,
        reports: data.reportsQueue,
        compliance: data.complianceAlerts,
        revenue: data.revenue,
        labour: data.labour,
        dataFreshness: data.dataFreshness,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- GET /api/admin/shifts/on-floor ---------------------------------------
  router.get('/admin/shifts/on-floor', adminGuard, async (req, res, next) => {
    try {
      const { clientId } = req.auth;
      const { venueIds } = req.scope;

      const shifts = await withClientContext(clientId, (q) =>
        queryShiftsOnFloor(q, venueIds),
      );

      res.json({ venueIds, shifts, asOf: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });

  // ---- GET /api/admin/incidents ---------------------------------------------
  router.get('/admin/incidents', incidentGuard, async (req, res, next) => {
    try {
      const { clientId } = req.auth;
      const { venueIds } = req.scope;
      const { status, severity, from, to } = req.query;

      const incidents = await withClientContext(clientId, (q) =>
        queryIncidents(q, venueIds, { status, severity, from, to }),
      );

      res.json({ venueIds, incidents });
    } catch (err) {
      next(err);
    }
  });

  // ---- GET /api/admin/incidents/:id ----------------------------------------
  router.get('/admin/incidents/:id', incidentGuard, async (req, res, next) => {
    try {
      const { clientId } = req.auth;
      const { venueIds } = req.scope;
      const { id } = req.params;

      const result = await withClientContext(clientId, async (q) => {
        const qResult = await q(
          `SELECT ir.*, TRIM(st.first_name || ' ' || st.last_name) AS reported_by_name
             FROM incident_reports ir
             LEFT JOIN staff st ON st.staff_id = ir.reported_by_staff_id
                                AND st.client_id = ir.client_id
            WHERE ir.incident_id = $1
              AND ir.venue_id = ANY($2)
              AND ir.deleted_at IS NULL`,
          [id, venueIds],
        );
        if (qResult.rows.length === 0) return null;
        const incident = qResult.rows[0];

        // Sequential: same single RLS-scoped connection, no concurrent queries.
        const obligations = await q(
          `SELECT * FROM incident_reporting_obligations WHERE incident_id = $1`,
          [id],
        ).then((r) => r.rows);
        const notifications = await q(
          `SELECT * FROM incident_notifications WHERE incident_id = $1`,
          [id],
        ).then((r) => r.rows);

        return { ...incident, obligations, notifications };
      });

      if (!result) {
        // venueId not in scope → 403; not found at all → 404.
        return res.status(403).json({ error: 'forbidden' });
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ---- GET /api/admin/reports/queue ----------------------------------------
  router.get('/admin/reports/queue', incidentGuard, async (req, res, next) => {
    try {
      const { clientId } = req.auth;
      const { venueIds } = req.scope;

      const reports = await withClientContext(clientId, (q) =>
        queryReportsQueue(q, venueIds),
      );

      res.json({ venueIds, reports });
    } catch (err) {
      next(err);
    }
  });

  // ---- GET /api/admin/compliance/alerts -------------------------------------
  router.get('/admin/compliance/alerts', adminGuard, async (req, res, next) => {
    try {
      const { clientId } = req.auth;
      const { venueIds } = req.scope;

      const alerts = await withClientContext(clientId, (q) =>
        queryComplianceAlerts(q, venueIds),
      );

      res.json({ venueIds, alerts });
    } catch (err) {
      next(err);
    }
  });

  // ---- GET /api/admin/revenue/daily ----------------------------------------
  router.get('/admin/revenue/daily', revenueGuard, async (req, res, next) => {
    try {
      const { clientId } = req.auth;
      const { venueIds } = req.scope;
      const { from, to, venueId } = req.query;

      // If venueId param given, it must be within scope.
      if (venueId && !isVenueInScope(req.scope, venueId)) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const revenue = await withClientContext(clientId, (q) =>
        queryRevenue(q, venueIds, { from, to, venueId }),
      );

      res.json({ venueIds, revenue });
    } catch (err) {
      next(err);
    }
  });

  // ---- GET /api/admin/labour/daily -----------------------------------------
  router.get('/admin/labour/daily', labourGuard, async (req, res, next) => {
    try {
      const { clientId } = req.auth;
      const { venueIds } = req.scope;
      const { from, to, venueId } = req.query;

      if (venueId && !isVenueInScope(req.scope, venueId)) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const labour = await withClientContext(clientId, (q) =>
        queryLabour(q, venueIds, { from, to, venueId }),
      );

      res.json({ venueIds, labour });
    } catch (err) {
      next(err);
    }
  });

  // ---- GET /api/admin/data-freshness ----------------------------------------
  router.get('/admin/data-freshness', adminGuard, async (req, res, next) => {
    try {
      const { clientId } = req.auth;
      const { venueIds } = req.scope;

      const connections = await withClientContext(clientId, (q) =>
        queryDataFreshness(q, venueIds),
      );

      res.json({ venueIds, connections, asOf: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });

  // ---- GET /api/admin/stream (SSE) ------------------------------------------
  // Live channel: incidents, staff clock-in/out, compliance alerts.
  // Revenue + labour do NOT stream — they refresh on the sync cadence (§4.2).
  //
  // Isolation: each connection is scope-bound at connect time. Server-side
  // fan-out checks venueIds before writing each event to this connection.
  // An event for venue X is never serialised to a connection not scoped to X.
  router.get('/admin/stream', streamGuard, (req, res) => {
    const { clientId } = req.auth;
    const { venueIds } = req.scope;
    const venueSet = new Set(venueIds);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering

    // Send initial heartbeat so the client knows the stream is live.
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId, venueIds })}\n\n`);

    // Fan-out handler: only forward events scoped to this connection's venues and client.
    const onEvent = (event) => {
      // Hard isolation: clientId must match.
      if (event.clientId !== clientId) return;
      // Scope check: venueId must be in this connection's resolved set.
      if (event.venueId && !venueSet.has(event.venueId)) return;

      const payload = JSON.stringify(event);
      res.write(`event: ${event.type}\ndata: ${payload}\n\n`);
    };

    adminEventBus.on('event', onEvent);

    // Send a keepalive comment every 30s so proxies don't close idle connections.
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      adminEventBus.off('event', onEvent);
    });
  });

  // ---- GET /api/admin/group-overview (MIS-467) --------------------------------
  // Estate-level roll-up: per-venue summary for all venues in the caller's scope.
  // Returns a group summary strip + venue rows array suitable for the GroupOverview UI.
  // For demo tenants with a single venue, DEMO_GROUP_VENUES=1 augments with mock extras.
  router.get('/admin/group-overview', adminGuard, async (req, res, next) => {
    try {
      const { clientId } = req.auth;
      const { venueIds } = req.scope;

      // Fetch venue names + per-venue metrics in one DB context.
      const raw = await withClientContext(clientId, async (q) => {
        const venueRows = await q(
          `SELECT venue_id, venue_name FROM venues
            WHERE venue_id = ANY($1) AND deleted_at IS NULL`,
          [venueIds],
        ).then((r) => r.rows);

        const revenue = await queryRevenue(q, venueIds, { from: sevenDaysAgo(), to: today() });
        const labour  = await queryLabour(q, venueIds, { from: sevenDaysAgo(), to: today() });
        const compliance = await q(
          `SELECT venue_id, severity, COUNT(*) AS cnt
             FROM compliance_events
            WHERE venue_id = ANY($1) AND acknowledged_at IS NULL AND deleted_at IS NULL
            GROUP BY venue_id, severity`,
          [venueIds],
        ).then((r) => r.rows);
        const incidents = await q(
          `SELECT venue_id, severity_level, COUNT(*) AS cnt
             FROM incident_reports
            WHERE venue_id = ANY($1)
              AND status IN ('active','open')
              AND deleted_at IS NULL
            GROUP BY venue_id, severity_level`,
          [venueIds],
        ).then((r) => r.rows);

        return { venueRows, revenue, labour, compliance, incidents };
      });

      const venues = buildGroupVenueRows(raw, venueIds);

      // Demo mode: augment single-venue scope with mock additional venues for credible demo.
      const demoExtras = process.env.DEMO_GROUP_VENUES === '1' && venues.length < 3
        ? DEMO_GROUP_EXTRAS.slice(0, 3 - venues.length)
        : [];
      const allVenues = [...venues, ...demoExtras];

      const summary = buildGroupSummary(allVenues);

      res.json({ summary, venues: allVenues, generatedAt: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Publish helper — called by other route handlers when data changes.
// ---------------------------------------------------------------------------

/**
 * Publish an event to the SSE fan-out bus.
 * Only events for live sections: incidents, staff clock, compliance alerts.
 *
 * @param {{ type: string, clientId: string, venueId: string, [key: string]: any }} event
 */
export function publishAdminEvent(event) {
  adminEventBus.emit('event', { ...event, publishedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

function sevenDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Group overview helpers (MIS-467)
// ---------------------------------------------------------------------------

function buildGroupVenueRows({ venueRows, revenue, labour, compliance, incidents }, venueIds) {
  return venueIds.map((venueId) => {
    const info = venueRows.find((v) => v.venue_id === venueId);

    // Weekly revenue sum.
    const revRows = revenue.filter((r) => r.venue_id === venueId);
    const weeklyRevCents = revRows.reduce((s, r) => s + (r.net_revenue_cents || 0), 0);
    const weeklyForecastCents = revRows.reduce((s, r) => s + (r.forecast_revenue_cents || 0), 0);
    const revDeltaPct = weeklyForecastCents > 0
      ? Math.round(((weeklyRevCents - weeklyForecastCents) / weeklyForecastCents) * 100)
      : null;

    // Labour: most recent day.
    const labRows = labour.filter((l) => l.venue_id === venueId).sort((a, b) =>
      (b.business_date || '').localeCompare(a.business_date || ''),
    );
    const todayLab = labRows[0] || null;
    const labStatus = !todayLab ? 'no-data'
      : todayLab.worked_hours > (todayLab.budgeted_hours || Infinity) ? 'over-target'
      : 'on-target';
    const labOverHours = todayLab?.budgeted_hours
      ? Math.max(0, (todayLab.worked_hours || 0) - todayLab.budgeted_hours)
      : 0;

    // Compliance.
    const compRows = compliance.filter((c) => c.venue_id === venueId);
    const compCount = compRows.reduce((s, c) => s + Number(c.cnt), 0);
    const highSeverity = compRows.some((c) => c.severity === 'critical') ? 'critical'
      : compRows.length > 0 ? 'warning' : null;

    // Active critical incidents.
    const incRows = incidents.filter((i) => i.venue_id === venueId);
    const criticalFlags = incRows
      .filter((i) => Number(i.severity_level) >= 3)
      .reduce((s, i) => s + Number(i.cnt), 0);
    const openIncidents = incRows.reduce((s, i) => s + Number(i.cnt), 0);

    // Overall status.
    const hasCriticalCompliance = highSeverity === 'critical';
    const hasCriticalIncident = criticalFlags > 0;
    const status = hasCriticalCompliance || hasCriticalIncident ? 'critical'
      : compCount > 0 || labStatus === 'over-target' ? 'attention'
      : 'clear';

    return {
      venueId,
      venueName: info?.venue_name || venueId,
      status,
      weeklyRevenueCents: weeklyRevCents,
      weeklyRevenueDeltaPct: revDeltaPct,
      complianceAlertCount: compCount,
      complianceHighestSeverity: highSeverity,
      labourStatus: labStatus,
      labourOverHours: labOverHours,
      activeCriticalFlags: criticalFlags,
      openIncidentCount: openIncidents,
    };
  });
}

function buildGroupSummary(venues) {
  const totalRevCents = venues.reduce((s, v) => s + (v.weeklyRevenueCents || 0), 0);
  const openComplianceCount = venues.reduce((s, v) => s + (v.complianceAlertCount || 0), 0);
  const venuesInRed = venues.filter((v) => v.status === 'critical').length;
  const overTarget = venues.filter((v) => v.labourStatus === 'over-target').length;
  const onTarget   = venues.filter((v) => v.labourStatus === 'on-target').length;
  return {
    totalRevenueCents: totalRevCents,
    openComplianceCount,
    venuesInRed,
    labourSummary: {
      onTarget,
      overTarget,
      noData: venues.length - onTarget - overTarget,
    },
  };
}

// Demo extras — realistic mock venues to show a credible multi-venue group when
// DEMO_GROUP_VENUES=1 and the real scope only contains one venue.
const DEMO_GROUP_EXTRAS = [
  {
    venueId: 'demo-venue-b',
    venueName: 'The Caxton Arms',
    status: 'critical',
    weeklyRevenueCents: 312800,
    weeklyRevenueDeltaPct: -8,
    complianceAlertCount: 2,
    complianceHighestSeverity: 'critical',
    labourStatus: 'over-target',
    labourOverHours: 4.5,
    activeCriticalFlags: 1,
    openIncidentCount: 2,
  },
  {
    venueId: 'demo-venue-c',
    venueName: 'The Paddington Arms',
    status: 'attention',
    weeklyRevenueCents: 198400,
    weeklyRevenueDeltaPct: 2,
    complianceAlertCount: 1,
    complianceHighestSeverity: 'warning',
    labourStatus: 'on-target',
    labourOverHours: 0,
    activeCriticalFlags: 0,
    openIncidentCount: 0,
  },
  {
    venueId: 'demo-venue-d',
    venueName: 'The Fortitude Valley Club',
    status: 'clear',
    weeklyRevenueCents: 267500,
    weeklyRevenueDeltaPct: 5,
    complianceAlertCount: 0,
    complianceHighestSeverity: null,
    labourStatus: 'on-target',
    labourOverHours: 0,
    activeCriticalFlags: 0,
    openIncidentCount: 0,
  },
];
