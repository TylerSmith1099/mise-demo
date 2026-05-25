/**
 * Admin Reporting & Filtering API (MIS-429)
 *
 * POST /api/admin/reports/query  — filter query, single endpoint for mobile + desktop
 * POST /api/admin/reports/export — PDF (branded) or CSV (raw) export with audit row
 *
 * Security model (MIS-426 §3.1, §3.2):
 *   Gate 1 — Client isolation (RLS, automatic): withClientContext sets
 *             app.current_client_id from verified JWT; cross-client rows invisible.
 *   Gate 2 — Intra-client scope: resolveScope() → venueIds set. Client body can
 *             only narrow within this set; anything outside → 403, not empty.
 *   Gate 3 — Role time-scope: DM (tier 5) maxLookbackDays=7 clamp on range.from.
 *             Clamped requests get meta.scopeClamped=true; they are not rejected.
 *   Gate 4 — Export tier gate: admin-reports-export excludes tier 5 (DM cannot export).
 *
 * AUSTRAC SMR exclusion (MIS-426 §4 / MIS-432):
 *   The metric allow-list does not include SMR/AUSTRAC metrics. incident_count
 *   reads incident_reports (general incidents); compliance_events is not exposed.
 *   If an AUSTRAC reporting surface is ever added, it must be a distinct
 *   access-gated resource and must not fold into this endpoint.
 *   SMR-flagged data exclusion lives here in the shared query path, per CTO
 *   instruction (MIS-429 comment 3f2336a6): when MIS-432 SMR role flag lands,
 *   add AND NOT can_export_smr-gated rows to shared queries before they reach
 *   the export layer.
 */

import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { withClientContext } from '../db.js';
import { requireAccess } from '../permissions.js';
import { attachScope, isVenueInScope } from './scope.js';

// ---------------------------------------------------------------------------
// Metric allow-list — maps the enum to a fixed SQL expression.
// Never interpolate metric into SQL string — use this map only.
// ---------------------------------------------------------------------------

const METRIC_DEFS = Object.freeze({
  revenue: {
    label: 'Net Revenue', unit: 'cents',
    table: 'revenue_daily', col: 'net_revenue_cents', partiallyEstimated: false,
  },
  labour_cost: {
    label: 'Labour Cost', unit: 'cents',
    table: 'labour_actuals_daily', col: 'labour_cost_cents', partiallyEstimated: true,
  },
  labour_pct: {
    label: 'Labour % of Revenue', unit: 'pct',
    derived: true, partiallyEstimated: true,
  },
  transactions: {
    label: 'Transaction Count', unit: 'count',
    table: 'revenue_daily', col: 'transaction_count', partiallyEstimated: false,
  },
  incident_count: {
    label: 'Incident Count', unit: 'count',
    table: 'incident_reports', partiallyEstimated: false,
  },
});

const VALID_GRAINS = new Set(['hour', 'day', 'week', 'month', 'quarter', 'year']);

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function isoDate(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

function diffDays(fromStr, toStr) {
  return Math.round(
    (new Date(toStr + 'T00:00:00Z') - new Date(fromStr + 'T00:00:00Z')) / 86_400_000,
  );
}

function today() {
  return isoDate(new Date());
}

// Weekday-aligned YoY shift: −364 days = −52 weeks so day-of-week is preserved.
function weekdayAlignedYoY(dateStr) {
  return addDays(dateStr, -364);
}

// ---------------------------------------------------------------------------
// Down-sampling: bucket-average over ≤maxBuckets equal-width buckets.
// Approved by CTO (MIS-429 comment 31a43b8d): bucket-average at ≤90 point cap.
// ---------------------------------------------------------------------------

function bucketAverage(points, maxBuckets) {
  if (points.length <= maxBuckets) return points;
  const size = Math.ceil(points.length / maxBuckets);
  const result = [];
  for (let i = 0; i < points.length; i += size) {
    const slice = points.slice(i, i + size);
    const sum = slice.reduce((acc, p) => acc + (p.v ?? 0), 0);
    result.push({ t: slice[0].t, v: Math.round(sum / slice.length) });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Primary metric queries
// ---------------------------------------------------------------------------

async function queryRevenueDayGrain(q, venueIds, fromDate, toDate, grain) {
  const trunc = grain === 'day' ? null : grain; // date_trunc arg
  let sql, rows;

  if (!trunc) {
    rows = await q(
      `SELECT business_date::text AS t,
              SUM(net_revenue_cents)::bigint AS v,
              bool_or(is_stale) AS is_stale
         FROM revenue_daily
        WHERE venue_id = ANY($1)
          AND business_date BETWEEN $2 AND $3
          AND deleted_at IS NULL
        GROUP BY business_date
        ORDER BY business_date`,
      [venueIds, fromDate, toDate],
    ).then((r) => r.rows);
  } else {
    rows = await q(
      `SELECT date_trunc($4, business_date)::date::text AS t,
              SUM(net_revenue_cents)::bigint AS v,
              bool_or(is_stale) AS is_stale
         FROM revenue_daily
        WHERE venue_id = ANY($1)
          AND business_date BETWEEN $2 AND $3
          AND deleted_at IS NULL
        GROUP BY date_trunc($4, business_date)
        ORDER BY 1`,
      [venueIds, fromDate, toDate, trunc],
    ).then((r) => r.rows);
  }

  return {
    points: rows.map((r) => ({ t: r.t, v: Number(r.v) })),
    isStale: rows.some((r) => r.is_stale),
    partlyEstimated: false,
  };
}

async function queryLabourCostDayGrain(q, venueIds, fromDate, toDate, grain) {
  const trunc = grain === 'day' ? null : grain;
  let rows;

  if (!trunc) {
    rows = await q(
      `SELECT business_date::text AS t,
              SUM(labour_cost_cents)::bigint AS v,
              bool_or(is_stale) AS is_stale,
              bool_or(source = 'award_estimate') AS partly_estimated
         FROM labour_actuals_daily
        WHERE venue_id = ANY($1)
          AND business_date BETWEEN $2 AND $3
          AND deleted_at IS NULL
        GROUP BY business_date
        ORDER BY business_date`,
      [venueIds, fromDate, toDate],
    ).then((r) => r.rows);
  } else {
    rows = await q(
      `SELECT date_trunc($4, business_date)::date::text AS t,
              SUM(labour_cost_cents)::bigint AS v,
              bool_or(is_stale) AS is_stale,
              bool_or(source = 'award_estimate') AS partly_estimated
         FROM labour_actuals_daily
        WHERE venue_id = ANY($1)
          AND business_date BETWEEN $2 AND $3
          AND deleted_at IS NULL
        GROUP BY date_trunc($4, business_date)
        ORDER BY 1`,
      [venueIds, fromDate, toDate, trunc],
    ).then((r) => r.rows);
  }

  return {
    points: rows.map((r) => ({ t: r.t, v: Number(r.v) })),
    isStale: rows.some((r) => r.is_stale),
    partlyEstimated: rows.some((r) => r.partly_estimated),
  };
}

async function queryLabourPctDayGrain(q, venueIds, fromDate, toDate, grain) {
  const trunc = grain === 'day' ? null : grain;
  let rows;

  if (!trunc) {
    rows = await q(
      `SELECT la.business_date::text AS t,
              CASE WHEN SUM(rd.net_revenue_cents) > 0
                   THEN ROUND(SUM(la.labour_cost_cents) * 100.0 / SUM(rd.net_revenue_cents), 2)
                   ELSE NULL END AS v,
              bool_or(la.is_stale OR rd.is_stale) AS is_stale,
              bool_or(la.source = 'award_estimate') AS partly_estimated
         FROM labour_actuals_daily la
         JOIN revenue_daily rd
           ON rd.venue_id = la.venue_id
          AND rd.business_date = la.business_date
          AND rd.client_id = la.client_id
          AND rd.deleted_at IS NULL
        WHERE la.venue_id = ANY($1)
          AND la.business_date BETWEEN $2 AND $3
          AND la.deleted_at IS NULL
        GROUP BY la.business_date
        ORDER BY la.business_date`,
      [venueIds, fromDate, toDate],
    ).then((r) => r.rows);
  } else {
    rows = await q(
      `SELECT date_trunc($4, la.business_date)::date::text AS t,
              CASE WHEN SUM(rd.net_revenue_cents) > 0
                   THEN ROUND(SUM(la.labour_cost_cents) * 100.0 / SUM(rd.net_revenue_cents), 2)
                   ELSE NULL END AS v,
              bool_or(la.is_stale OR rd.is_stale) AS is_stale,
              bool_or(la.source = 'award_estimate') AS partly_estimated
         FROM labour_actuals_daily la
         JOIN revenue_daily rd
           ON rd.venue_id = la.venue_id
          AND rd.business_date = la.business_date
          AND rd.client_id = la.client_id
          AND rd.deleted_at IS NULL
        WHERE la.venue_id = ANY($1)
          AND la.business_date BETWEEN $2 AND $3
          AND la.deleted_at IS NULL
        GROUP BY date_trunc($4, la.business_date)
        ORDER BY 1`,
      [venueIds, fromDate, toDate, trunc],
    ).then((r) => r.rows);
  }

  return {
    points: rows.map((r) => ({ t: r.t, v: r.v !== null ? Number(r.v) : null })),
    isStale: rows.some((r) => r.is_stale),
    partlyEstimated: rows.some((r) => r.partly_estimated),
  };
}

async function queryTransactionsDayGrain(q, venueIds, fromDate, toDate, grain) {
  const trunc = grain === 'day' ? null : grain;
  let rows;

  if (!trunc) {
    rows = await q(
      `SELECT business_date::text AS t,
              SUM(transaction_count)::bigint AS v,
              bool_or(is_stale) AS is_stale
         FROM revenue_daily
        WHERE venue_id = ANY($1)
          AND business_date BETWEEN $2 AND $3
          AND deleted_at IS NULL
        GROUP BY business_date
        ORDER BY business_date`,
      [venueIds, fromDate, toDate],
    ).then((r) => r.rows);
  } else {
    rows = await q(
      `SELECT date_trunc($4, business_date)::date::text AS t,
              SUM(transaction_count)::bigint AS v,
              bool_or(is_stale) AS is_stale
         FROM revenue_daily
        WHERE venue_id = ANY($1)
          AND business_date BETWEEN $2 AND $3
          AND deleted_at IS NULL
        GROUP BY date_trunc($4, business_date)
        ORDER BY 1`,
      [venueIds, fromDate, toDate, trunc],
    ).then((r) => r.rows);
  }

  return {
    points: rows.map((r) => ({ t: r.t, v: Number(r.v) })),
    isStale: rows.some((r) => r.is_stale),
    partlyEstimated: false,
  };
}

async function queryIncidentCountDayGrain(q, venueIds, fromDate, toDate, grain) {
  const trunc = grain === 'day' ? null : grain;
  const fromTs = fromDate + 'T00:00:00+10:00'; // Brisbane
  const toTs   = toDate   + 'T23:59:59+10:00';
  let rows;

  if (!trunc) {
    rows = await q(
      `SELECT (incident_at AT TIME ZONE 'Australia/Brisbane')::date::text AS t,
              COUNT(*)::bigint AS v
         FROM incident_reports
        WHERE venue_id = ANY($1)
          AND incident_at BETWEEN $2::timestamptz AND $3::timestamptz
          AND deleted_at IS NULL
        GROUP BY (incident_at AT TIME ZONE 'Australia/Brisbane')::date
        ORDER BY 1`,
      [venueIds, fromTs, toTs],
    ).then((r) => r.rows);
  } else {
    rows = await q(
      `SELECT date_trunc($4, (incident_at AT TIME ZONE 'Australia/Brisbane')::date)::text AS t,
              COUNT(*)::bigint AS v
         FROM incident_reports
        WHERE venue_id = ANY($1)
          AND incident_at BETWEEN $2::timestamptz AND $3::timestamptz
          AND deleted_at IS NULL
        GROUP BY date_trunc($4, (incident_at AT TIME ZONE 'Australia/Brisbane')::date)
        ORDER BY 1`,
      [venueIds, fromTs, toTs, trunc],
    ).then((r) => r.rows);
  }

  return {
    points: rows.map((r) => ({ t: r.t, v: Number(r.v) })),
    isStale: false,
    partlyEstimated: false,
  };
}

async function queryRevenueHourGrain(q, venueIds, fromDate, toDate) {
  const rows = await q(
    `SELECT business_date::text AS date,
            hour_local AS hour,
            SUM(net_revenue_cents)::bigint AS v,
            bool_or(is_stale) AS is_stale
       FROM revenue_hourly
      WHERE venue_id = ANY($1)
        AND business_date BETWEEN $2 AND $3
        AND deleted_at IS NULL
      GROUP BY business_date, hour_local
      ORDER BY business_date, hour_local`,
    [venueIds, fromDate, toDate],
  ).then((r) => r.rows);

  return {
    points: rows.map((r) => ({ t: `${r.date}T${String(r.hour).padStart(2, '0')}:00`, v: Number(r.v) })),
    isStale: rows.some((r) => r.is_stale),
    partlyEstimated: false,
  };
}

// Rolling-6-weeks query from MIS-426 §1.3.
// Returns series[0..5], each a 7-point weekday array (0=Mon..6=Sun).
async function queryRolling6Weeks(q, venueIds, anchorDate) {
  const rows = await q(
    `WITH anchored AS (
       SELECT
         venue_id,
         floor(($2::date - business_date) / 7)::int      AS week_offset,
         extract(isodow FROM business_date)::int - 1      AS weekday,
         net_revenue_cents
       FROM revenue_daily
      WHERE venue_id = ANY($1)
        AND business_date BETWEEN ($2::date - INTERVAL '41 days') AND $2::date
        AND deleted_at IS NULL
     )
     SELECT week_offset, weekday, SUM(net_revenue_cents)::bigint AS net_cents
       FROM anchored
      GROUP BY week_offset, weekday
      ORDER BY week_offset, weekday`,
    [venueIds, anchorDate],
  ).then((r) => r.rows);

  // Build 6 series (week_offset 0..5), each 7 points.
  const seriesMap = {};
  for (const r of rows) {
    const wo = r.week_offset;
    if (wo < 0 || wo > 5) continue;
    if (!seriesMap[wo]) seriesMap[wo] = new Array(7).fill(null);
    seriesMap[wo][r.weekday] = Number(r.net_cents);
  }
  const series = [];
  for (let wo = 0; wo <= 5; wo++) {
    series.push({
      weekOffset: wo,
      label: wo === 0 ? 'This week' : `${wo} week${wo > 1 ? 's' : ''} ago`,
      points: seriesMap[wo] || new Array(7).fill(null),
    });
  }
  return series;
}

// ---------------------------------------------------------------------------
// Dispatch to the right query based on metric + grain
// ---------------------------------------------------------------------------

async function runMetricQuery(q, metric, grain, venueIds, fromDate, toDate) {
  if (grain === 'hour') {
    if (metric !== 'revenue') {
      return { points: [], isStale: false, partlyEstimated: false, unavailable: true };
    }
    return queryRevenueHourGrain(q, venueIds, fromDate, toDate);
  }

  switch (metric) {
    case 'revenue':       return queryRevenueDayGrain(q, venueIds, fromDate, toDate, grain);
    case 'labour_cost':   return queryLabourCostDayGrain(q, venueIds, fromDate, toDate, grain);
    case 'labour_pct':    return queryLabourPctDayGrain(q, venueIds, fromDate, toDate, grain);
    case 'transactions':  return queryTransactionsDayGrain(q, venueIds, fromDate, toDate, grain);
    case 'incident_count':return queryIncidentCountDayGrain(q, venueIds, fromDate, toDate, grain);
    default: throw new Error('unknown metric: ' + metric);
  }
}

// ---------------------------------------------------------------------------
// Comparison-range derivation (MIS-426 §1.4)
// ---------------------------------------------------------------------------

function deriveComparisonRange(primaryFrom, primaryTo, mode, alignment) {
  const len = diffDays(primaryFrom, primaryTo);

  if (mode === 'previous_year') {
    const shift = alignment === 'calendar' ? -365 : -364;
    return {
      from: addDays(primaryFrom, shift),
      to:   addDays(primaryTo,   shift),
    };
  }

  if (mode === 'previous_period') {
    // Shift by the window length, rounded to whole weeks if window is week-multiple.
    const shiftDays = len % 7 === 0 ? -(len) : -(len + 1);
    return {
      from: addDays(primaryFrom, shiftDays),
      to:   addDays(primaryTo,   shiftDays),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Scope intersection helper
// ---------------------------------------------------------------------------

function intersectVenueIds(requested, resolved) {
  if (!requested || requested.length === 0) return resolved;
  const resolvedSet = new Set(resolved);
  const intersection = requested.filter((id) => resolvedSet.has(id));
  return intersection;
}

// Determine scope kind from resolved venueIds vs. the full resolved set.
function scopeKind(requestedVenueIds, resolvedVenueIds) {
  if (!requestedVenueIds || requestedVenueIds.length === 0) {
    return resolvedVenueIds.length === 1 ? 'venue' : 'group';
  }
  if (requestedVenueIds.length === 1) return 'venue';
  if (requestedVenueIds.length < resolvedVenueIds.length) return 'cluster';
  return 'group';
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function reportingRouter() {
  const router = Router();

  const queryGuard  = [requireAccess('admin-reports'),        attachScope];
  const exportGuard = [requireAccess('admin-reports-export'), attachScope];

  // ---- POST /api/admin/reports/query ----------------------------------------
  router.post('/admin/reports/query', queryGuard, async (req, res, next) => {
    try {
      const { clientId, roleTier } = req.auth;
      const { venueIds: resolvedVenueIds, maxLookbackDays } = req.scope;

      const {
        metric = 'revenue',
        grain  = 'day',
        range,
        comparison = { mode: 'none' },
        scope: requestedScope,
        view = 'desktop',
      } = req.body || {};

      // Validate metric.
      if (!METRIC_DEFS[metric]) {
        return res.status(400).json({ error: 'invalid_metric', allowed: Object.keys(METRIC_DEFS) });
      }
      if (!VALID_GRAINS.has(grain)) {
        return res.status(400).json({ error: 'invalid_grain', allowed: [...VALID_GRAINS] });
      }

      // Resolve range (defaults per view: MIS-426 §2.3).
      const todayStr = today();
      let fromDate = range?.from || (view === 'mobile' ? addDays(todayStr, -7)  : addDays(todayStr, -28));
      let toDate   = range?.to   || todayStr;

      // DM time-scope clamp (MIS-426 §3.2): never 403, but flag meta.scopeClamped.
      let scopeClamped = false;
      if (maxLookbackDays !== null) {
        const clampFrom = addDays(todayStr, -maxLookbackDays);
        if (fromDate < clampFrom) {
          fromDate = clampFrom;
          scopeClamped = true;
        }
        if (toDate > todayStr) {
          toDate = todayStr;
        }
      }

      // Validate range order.
      if (fromDate > toDate) {
        return res.status(400).json({ error: 'invalid_range', detail: 'range.from must be ≤ range.to' });
      }

      // Resolve venue scope: intersect client body with JWT-derived set.
      const requestedVenueIds = requestedScope?.venueIds || null;
      const effectiveVenueIds = intersectVenueIds(requestedVenueIds, resolvedVenueIds);

      // Any requested venue not in the resolved set → 403.
      if (requestedVenueIds) {
        const resolvedSet = new Set(resolvedVenueIds);
        for (const id of requestedVenueIds) {
          if (!resolvedSet.has(id)) {
            return res.status(403).json({ error: 'forbidden', detail: 'venue not in scope' });
          }
        }
      }

      if (effectiveVenueIds.length === 0) {
        return res.status(400).json({ error: 'no_venues_in_scope' });
      }

      // Bucket count guard: prevent unbounded scans.
      const span = diffDays(fromDate, toDate);
      const MAX_SPAN_DAYS = grain === 'hour' ? 7 : 3650;
      if (span > MAX_SPAN_DAYS) {
        return res.status(400).json({
          error: 'range_too_wide',
          detail: `${grain} grain supports up to ${MAX_SPAN_DAYS} days`,
        });
      }

      const isMobile   = view === 'mobile';
      const MAX_POINTS = isMobile ? 90 : 500;

      // Rolling-6-weeks mode: different response shape.
      if (comparison?.mode === 'rolling_weeks') {
        const anchorDate = toDate;
        const series = await withClientContext(clientId, (q) =>
          queryRolling6Weeks(q, effectiveVenueIds, anchorDate),
        );

        return res.json({
          meta: {
            metric, grain: 'day',
            range: { from: addDays(anchorDate, -41), to: anchorDate },
            comparison: { mode: 'rolling_weeks', anchorDate },
            scope: { kind: scopeKind(requestedVenueIds, resolvedVenueIds), venueCount: effectiveVenueIds.length },
            currency: 'AUD', unit: 'cents',
            dataAsOf: new Date().toISOString(),
            isStale: false, partlyEstimated: false,
            scopeClamped,
          },
          series,
        });
      }

      // Standard two-series query.
      const comparisonMode = comparison?.mode || 'none';
      const comparisonAlignment = comparison?.alignment || 'weekday';

      let primary, comparisonResult = null, comparisonRange = null;

      await withClientContext(clientId, async (q) => {
        // Primary query.
        primary = await runMetricQuery(q, metric, grain, effectiveVenueIds, fromDate, toDate);

        // Comparison query (sequential — same RLS connection).
        if (comparisonMode !== 'none') {
          comparisonRange = deriveComparisonRange(fromDate, toDate, comparisonMode, comparisonAlignment);
          if (comparisonRange) {
            comparisonResult = await runMetricQuery(
              q, metric, grain, effectiveVenueIds, comparisonRange.from, comparisonRange.to,
            );
          }
        }
      });

      // Down-sample for mobile (bucket-average, ≤90 points).
      const primaryPoints = isMobile ? bucketAverage(primary.points, MAX_POINTS) : primary.points;
      const compPoints = comparisonResult && isMobile
        ? bucketAverage(comparisonResult.points, MAX_POINTS)
        : comparisonResult?.points || null;

      const comparisonLabel = comparisonMode === 'previous_year'
        ? `Same period last year (${comparisonAlignment}-aligned)`
        : comparisonMode === 'previous_period'
        ? `Previous period`
        : null;

      const response = {
        meta: {
          metric, grain,
          range: { from: fromDate, to: toDate },
          comparison: comparisonRange
            ? { mode: comparisonMode, alignment: comparisonAlignment, comparisonRange, dataAvailable: (compPoints?.length ?? 0) > 0 }
            : { mode: 'none' },
          scope: { kind: scopeKind(requestedVenueIds, resolvedVenueIds), venueCount: effectiveVenueIds.length },
          currency: 'AUD', unit: METRIC_DEFS[metric].unit,
          dataAsOf: new Date().toISOString(),
          isStale: primary.isStale || (comparisonResult?.isStale ?? false),
          partlyEstimated: primary.partlyEstimated || (comparisonResult?.partlyEstimated ?? false),
          scopeClamped,
        },
        primary: { label: 'This period', points: primaryPoints },
      };

      if (comparisonResult && compPoints !== null) {
        response.comparison = { label: comparisonLabel, points: compPoints };
      }

      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  // ---- POST /api/admin/reports/export ----------------------------------------
  router.post('/admin/reports/export', exportGuard, async (req, res, next) => {
    try {
      const { clientId, staffId, roleTier } = req.auth;
      const { venueIds: resolvedVenueIds, maxLookbackDays } = req.scope;

      const {
        metric = 'revenue',
        grain  = 'day',
        range,
        comparison = { mode: 'none' },
        scope: requestedScope,
        view = 'desktop',
        format = 'csv',
        exportClass = 'internal',
      } = req.body || {};

      if (!METRIC_DEFS[metric]) {
        return res.status(400).json({ error: 'invalid_metric' });
      }
      if (!['pdf', 'csv'].includes(format)) {
        return res.status(400).json({ error: 'invalid_format' });
      }
      if (!['regulator', 'internal'].includes(exportClass)) {
        return res.status(400).json({ error: 'invalid_export_class' });
      }

      const todayStr = today();
      let fromDate = range?.from || addDays(todayStr, -28);
      let toDate   = range?.to   || todayStr;

      if (maxLookbackDays !== null) {
        const clampFrom = addDays(todayStr, -maxLookbackDays);
        if (fromDate < clampFrom) fromDate = clampFrom;
        if (toDate > todayStr) toDate = todayStr;
      }

      const requestedVenueIds = requestedScope?.venueIds || null;
      const effectiveVenueIds = intersectVenueIds(requestedVenueIds, resolvedVenueIds);

      if (requestedVenueIds) {
        const resolvedSet = new Set(resolvedVenueIds);
        for (const id of requestedVenueIds) {
          if (!resolvedSet.has(id)) {
            return res.status(403).json({ error: 'forbidden' });
          }
        }
      }

      if (effectiveVenueIds.length === 0) {
        return res.status(400).json({ error: 'no_venues_in_scope' });
      }

      // Fetch staff display name for the param block header.
      let staffName = 'Unknown', staffRole = 'Unknown';
      try {
        const staffRow = await withClientContext(clientId, (q) =>
          q(
            `SELECT TRIM(first_name || ' ' || last_name) AS name, role_name
               FROM staff WHERE staff_id = $1 AND deleted_at IS NULL LIMIT 1`,
            [staffId],
          ).then((r) => r.rows[0]),
        );
        if (staffRow) { staffName = staffRow.name; staffRole = staffRow.role_name; }
      } catch { /* non-critical — continue without name */ }

      // Server-resolved filter params snapshot (embedded in every artifact and
      // audit row — never accepted from the client body).
      const comparisonMode = comparison?.mode || 'none';
      const comparisonAlignment = comparison?.alignment || 'weekday';
      const comparisonRange = comparisonMode !== 'none'
        ? deriveComparisonRange(fromDate, toDate, comparisonMode, comparisonAlignment)
        : null;

      const resolvedParams = {
        metric,
        grain,
        range: { from: fromDate, to: toDate },
        comparison: comparisonRange
          ? { mode: comparisonMode, alignment: comparisonAlignment, range: comparisonRange }
          : { mode: 'none' },
        scope: { kind: scopeKind(requestedVenueIds, resolvedVenueIds), venueCount: effectiveVenueIds.length },
        exportClass,
        generatedAt: new Date().toISOString(),
        generatedBy: { staffId, name: staffName, role: staffRole },
      };

      // Run the query (reuses the same resolution path as /query).
      let primary, comparisonResult = null;
      await withClientContext(clientId, async (q) => {
        primary = await runMetricQuery(q, metric, grain, effectiveVenueIds, fromDate, toDate);
        if (comparisonRange) {
          comparisonResult = await runMetricQuery(
            q, metric, grain, effectiveVenueIds, comparisonRange.from, comparisonRange.to,
          );
        }
      });

      const rowCount = primary.points.length + (comparisonResult?.points?.length ?? 0);

      // Write audit row to report_exports.
      let exportId;
      try {
        const auditRow = await withClientContext(clientId, (q) =>
          q(
            `INSERT INTO report_exports
               (client_id, staff_id, format, export_class, filter_params,
                scope_kind, venue_count, row_count, status, completed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', now())
             RETURNING export_id`,
            [
              clientId, staffId, format, exportClass,
              JSON.stringify(resolvedParams),
              resolvedParams.scope.kind,
              resolvedParams.scope.venueCount,
              rowCount,
            ],
          ).then((r) => r.rows[0]?.export_id),
        );
        exportId = auditRow;
      } catch {
        // Audit write failure must not block the export delivery — log and continue.
        console.error('[reporting-api] Failed to write report_exports audit row');
      }

      const metricLabel  = METRIC_DEFS[metric].label;
      const unitLabel    = METRIC_DEFS[metric].unit === 'cents' ? 'AUD' : METRIC_DEFS[metric].unit;
      const generatedAt  = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' }) + ' AEST';
      const isStale      = primary.isStale || (comparisonResult?.isStale ?? false);
      const partlyEst    = primary.partlyEstimated || (comparisonResult?.partlyEstimated ?? false);

      if (format === 'csv') {
        return sendCsv(res, {
          resolvedParams, metricLabel, unitLabel, generatedAt,
          isStale, partlyEst, primary, comparisonResult,
          fromDate, toDate, metric,
        });
      }

      return sendPdf(res, {
        resolvedParams, metricLabel, unitLabel, generatedAt,
        isStale, partlyEst, primary, comparisonResult,
        staffName, staffRole, fromDate, toDate, metric,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// CSV generation
// ---------------------------------------------------------------------------

function sendCsv(res, { resolvedParams, metricLabel, unitLabel, generatedAt,
                        isStale, partlyEst, primary, comparisonResult,
                        fromDate, toDate, metric }) {
  const { staffId, name, role } = resolvedParams.generatedBy;
  const comp = resolvedParams.comparison;

  const lines = [
    `# Report generated: ${generatedAt}`,
    `# Generated by: ${name}, ${role} (${staffId})`,
    `# Scope: ${resolvedParams.scope.kind}, ${resolvedParams.scope.venueCount} venue(s)`,
    `# Metric: ${metricLabel} (${unitLabel})`,
    `# Range: ${fromDate} → ${toDate} (venue-local trading dates)`,
    comp.mode !== 'none'
      ? `# Comparison: ${comp.mode} (${comp.alignment || ''}), range ${comp.range?.from} → ${comp.range?.to}`
      : `# Comparison: none`,
    isStale      ? `# WARNING: Data may be stale` : `# Data freshness: OK`,
    partlyEst    ? `# WARNING: Labour figures include award estimates — see individual rows` : null,
    `# Export class: ${resolvedParams.exportClass}`,
    `# Export ID: ${resolvedParams.generatedAt}`,
    '',
  ].filter((l) => l !== null).join('\n');

  const header = comparisonResult
    ? `date,${metricLabel} (${unitLabel}),comparison_date,comparison_${metricLabel} (${unitLabel})`
    : `date,${metricLabel} (${unitLabel})`;

  const rows = primary.points.map((p, i) => {
    const val = metric === 'labour_pct' ? p.v : Math.round((p.v ?? 0) / 100 * 100) / 100;
    if (comparisonResult) {
      const cp = comparisonResult.points[i];
      const cval = cp ? (metric === 'labour_pct' ? cp.v : Math.round((cp.v ?? 0) / 100 * 100) / 100) : '';
      return `${p.t},${val},${cp?.t || ''},${cval}`;
    }
    return `${p.t},${val}`;
  });

  const csvBody = [lines, header, ...rows].join('\n');
  const filename = `reporting_${metric}_${fromDate}_${toDate}.csv`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvBody);
}

// ---------------------------------------------------------------------------
// PDF generation (pdfkit, Deep Meridian brand)
// ---------------------------------------------------------------------------

function sendPdf(res, { resolvedParams, metricLabel, unitLabel, generatedAt,
                        isStale, partlyEst, primary, comparisonResult,
                        staffName, staffRole, fromDate, toDate, metric }) {
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const filename = `reporting_${metric}_${fromDate}_${toDate}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  // Colour tokens (light printable variant of Deep Meridian).
  const COPPER   = '#B87A3C';
  const DARK     = '#090F1A';
  const MID      = '#2E5080';
  const MUTED    = '#6B8CAD';
  const WHITE    = '#FFFFFF';
  const WARN_BG  = '#FFF8EE';

  // Header bar.
  doc.rect(0, 0, doc.page.width, 56).fill(DARK);
  doc.fillColor(COPPER).font('Helvetica-Bold').fontSize(18)
    .text('Mise', 48, 18);
  doc.fillColor(WHITE).font('Helvetica').fontSize(11)
    .text('Reporting & Analytics', 90, 21);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
    .text(generatedAt, doc.page.width - 200, 24, { width: 155, align: 'right' });

  doc.moveDown(2.5);

  // Param block — server-stamped, never from client body.
  doc.fillColor(COPPER).font('Helvetica-Bold').fontSize(11).text('Report Parameters', { underline: false });
  doc.moveDown(0.3);

  const p = resolvedParams;
  const paramLines = [
    ['Metric',      metricLabel + ' (' + unitLabel + ')'],
    ['Range',       `${fromDate} → ${toDate} (venue-local trading dates)`],
    ['Scope',       `${p.scope.kind}, ${p.scope.venueCount} venue(s)`],
    ['Comparison',  p.comparison.mode !== 'none'
                      ? `${p.comparison.mode}, ${p.comparison.alignment || 'weekday'}-aligned`
                      : 'None'],
    ['Generated by', `${staffName} · ${staffRole}`],
    ['Export class', p.exportClass],
  ];

  for (const [k, v] of paramLines) {
    doc.fillColor(MUTED).font('Courier').fontSize(8).text(k.padEnd(16) + v, { lineGap: 2 });
  }

  if (isStale || partlyEst) {
    doc.moveDown(0.5);
    doc.rect(48, doc.y, doc.page.width - 96, 28).fill(WARN_BG);
    doc.fillColor(COPPER).font('Helvetica-Bold').fontSize(9)
      .text(
        [
          isStale   ? '⚠ Data may be stale — synced from a prior pull' : null,
          partlyEst ? '⚠ Labour figures include award estimates (see CFO guardrail MIS-409 §7-R)' : null,
        ].filter(Boolean).join('  ·  '),
        52, doc.y - 22, { width: doc.page.width - 104 },
      );
    doc.moveDown(0.5);
  }

  doc.moveDown(1);
  doc.fillColor(COPPER).font('Helvetica-Bold').fontSize(11).text('Data');
  doc.moveDown(0.3);

  // Column headers.
  const COL_DATE = 48;
  const COL_VAL  = 200;
  const COL_COMP = 340;
  const ROW_H    = 16;

  doc.rect(COL_DATE, doc.y, doc.page.width - 96, ROW_H).fill('#E8EFF7');
  const headerY = doc.y + 3;
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8);
  doc.text('Date', COL_DATE + 4, headerY, { width: 140 });
  doc.text(metricLabel + (unitLabel === 'AUD' ? ' (AUD)' : ''), COL_VAL, headerY, { width: 120 });
  if (comparisonResult) {
    doc.text('Comparison', COL_COMP, headerY, { width: 120 });
  }
  doc.moveDown(1);

  // Data rows (max 50 for PDF).
  const rowsToShow = primary.points.slice(0, 50);
  for (let i = 0; i < rowsToShow.length; i++) {
    const pt = rowsToShow[i];
    const bg = i % 2 === 0 ? null : '#F4F7FB';
    if (bg) doc.rect(48, doc.y - 2, doc.page.width - 96, ROW_H).fill(bg);

    const val = metric === 'labour_pct'
      ? (pt.v !== null ? pt.v.toFixed(2) + '%' : '—')
      : (pt.v !== null ? '$' + (pt.v / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 }) : '—');

    doc.fillColor(DARK).font('Courier').fontSize(8);
    doc.text(pt.t, COL_DATE + 4, doc.y + 2, { width: 140 });
    doc.text(val, COL_VAL, doc.y - 10, { width: 120 });

    if (comparisonResult) {
      const cp = comparisonResult.points[i];
      const cval = cp
        ? (metric === 'labour_pct'
          ? (cp.v !== null ? cp.v.toFixed(2) + '%' : '—')
          : '$' + ((cp.v ?? 0) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 }))
        : '—';
      doc.text(cval, COL_COMP, doc.y - 10, { width: 120 });
    }

    doc.moveDown(0.2);

    // Page break guard.
    if (doc.y > doc.page.height - 80 && i < rowsToShow.length - 1) {
      doc.addPage();
    }
  }

  if (primary.points.length > 50) {
    doc.moveDown(0.5);
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text(`(${primary.points.length - 50} additional rows omitted from PDF — use CSV for full data)`);
  }

  // Footer.
  const footerY = doc.page.height - 36;
  doc.rect(0, footerY - 4, doc.page.width, 40).fill(DARK);
  doc.fillColor(MUTED).font('Helvetica').fontSize(7)
    .text(
      `Mise Analytics · ${p.exportClass === 'regulator' ? 'REGULATOR-GRADE EXPORT' : 'Internal report'} · ${generatedAt}`,
      48, footerY + 4, { width: doc.page.width - 96, align: 'center' },
    );

  doc.end();
}
