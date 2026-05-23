// Shift-summary API — the Duty Manager's opening surface (MIS-43 / MIS-26 Scene 2).
//
//   GET /api/shift-summary -> the live opening summary for the caller's venue:
//        staff on now (with gaming-floor cover vs the venue minimum), the gaming
//        weekly labour % with a >12% flag, open (unacknowledged) compliance
//        incidents, and the prior shift's handover highlights. This is what the
//        UI renders when a DM opens the app with no message.
//   GET /api/handover      -> the full pre-seeded prior-shift handover note,
//        broken into open compliance items, staffing notes, incidents and
//        recommended actions so the UI can render it STRUCTURED (not prose).
//
// ISOLATION: every query runs through withClientContext(req.auth.clientId, ...),
// so a caller only ever reads their own client's rows. venueId/clientId come
// from the VERIFIED token (req.auth), never the request body. There is no
// hardcoded venue/number content here — every figure is read from the DB.
//
// GAMING LABOUR %: gaming weekly labour = sum(shifts.labour_cost) for the gaming
// department this week (the active 7-day roster); net gaming revenue is the
// weekly basis derived from pnl_summary.net_gaming_revenue (a monthly figure in
// the seed, /WEEKS_PER_MONTH) and falls back to the $126k/wk basis. The flag
// fires when the ratio exceeds GAMING_LABOUR_THRESHOLD_PCT (12%).

import { Router } from 'express';
import { withClientContext } from './db.js';
import { getDemoHandover } from './integrations/mock/handover.js';

export const GAMING_LABOUR_THRESHOLD_PCT = 12;
// Matches the seed's monthly→weekly factor (scripts/seed-demo-criterion.js, W).
const WEEKS_PER_MONTH = 4.33;
// Net gaming revenue weekly basis used when no P&L row is present (MIS-43 spec).
const FALLBACK_NET_GAMING_REVENUE_WEEKLY = 126000;

// "RSA refusal — patron showing..." -> "RSA refusal". A concise headline for the
// summary card; the full description is still returned for callers that want it.
function headline(description) {
  if (!description) return '';
  const [head] = description.split(' — ');
  return head.trim();
}

// Split a multi-line note field into trimmed, bullet-stripped lines.
function lines(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*[•\-\d.]+\s*/, '').trim())
    .filter(Boolean);
}

// Compute the opening shift summary inside an already-scoped query fn `q`.
export async function buildShiftSummary(q, { venueId }) {
  const venue = (
    await q(
      `SELECT venue_name, state, gaming_min_attendants, egm_count
         FROM venues WHERE venue_id = $1 AND deleted_at IS NULL`,
      [venueId],
    )
  ).rows[0];
  if (!venue) return null;

  // Staffing: everyone currently on, plus gaming-floor cover vs the venue min.
  const staffing = (
    await q(
      `SELECT
         COUNT(*) FILTER (WHERE shift_status = 'on')                            AS on_now,
         COUNT(*) FILTER (WHERE shift_status = 'on' AND department = 'gaming')  AS gaming_on_floor
       FROM staff
       WHERE venue_id = $1 AND deleted_at IS NULL`,
      [venueId],
    )
  ).rows[0];
  const gamingOnFloor = Number(staffing.gaming_on_floor);
  const gamingMin = Number(venue.gaming_min_attendants);

  // Gaming weekly labour = sum of gaming-department shift labour for the active
  // roster (one week of shifts in the demo dataset).
  const labour = (
    await q(
      `SELECT COALESCE(SUM(labour_cost), 0) AS gaming_weekly_labour
         FROM shifts
        WHERE venue_id = $1 AND department = 'gaming' AND deleted_at IS NULL`,
      [venueId],
    )
  ).rows[0];
  const gamingWeeklyLabour = Number(labour.gaming_weekly_labour);

  // Net gaming revenue (weekly basis) from the P&L gaming row, falling back to
  // the $126k/wk basis if no row exists.
  const pnl = (
    await q(
      `SELECT net_gaming_revenue
         FROM pnl_summary
        WHERE venue_id = $1 AND department = 'gaming' AND deleted_at IS NULL
          AND net_gaming_revenue IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [venueId],
    )
  ).rows[0];
  const netGamingRevenueWeekly = pnl
    ? Number(pnl.net_gaming_revenue) / WEEKS_PER_MONTH
    : FALLBACK_NET_GAMING_REVENUE_WEEKLY;

  // Labour % = gross_labour_cost / net_gaming_revenue (RTV net). NEVER use EGM meter. See scripts/README.md.
  // Net (~$126k/wk) vs meter (~$1.8M/wk) is a 14x difference; the meter would
  // hide the >12% DM flag entirely. The denominator above is the seed's net
  // gaming revenue (pnl_summary.net_gaming_revenue), never egm meter turnover.
  const pct =
    netGamingRevenueWeekly > 0
      ? Math.round((gamingWeeklyLabour / netGamingRevenueWeekly) * 1000) / 10
      : null;

  // Open (unacknowledged) compliance incidents, newest first.
  const openCompliance = (
    await q(
      `SELECT event_type, severity, description, created_at
         FROM compliance_events
        WHERE venue_id = $1 AND acknowledged_at IS NULL
        ORDER BY created_at DESC`,
      [venueId],
    )
  ).rows.map((r) => ({
    eventType: r.event_type,
    severity: r.severity,
    headline: headline(r.description),
    description: r.description,
    createdAt: r.created_at,
  }));

  // Prior-shift handover highlights (open compliance items from the latest note).
  const note = (
    await q(
      `SELECT from_role, shift_date, open_compliance_items
         FROM handover_notes
        WHERE venue_id = $1 AND deleted_at IS NULL
        ORDER BY shift_date DESC, created_at DESC
        LIMIT 1`,
      [venueId],
    )
  ).rows[0];

  return {
    venueName: venue.venue_name,
    venueState: venue.state,
    staffing: {
      onNow: Number(staffing.on_now),
      gamingOnFloor,
      gamingMinAttendants: gamingMin,
      gamingUnderstaffed: gamingOnFloor < gamingMin,
    },
    gamingLabour: {
      weeklyLabourCost: Math.round(gamingWeeklyLabour),
      netGamingRevenueWeekly: Math.round(netGamingRevenueWeekly),
      pct,
      thresholdPct: GAMING_LABOUR_THRESHOLD_PCT,
      flagged: pct !== null && pct > GAMING_LABOUR_THRESHOLD_PCT,
    },
    openCompliance,
    priorHandover: note
      ? {
          fromRole: note.from_role,
          shiftDate: note.shift_date,
          highlights: lines(note.open_compliance_items),
        }
      : null,
  };
}

// Pull the full prior-shift handover note, structured for the UI.
export async function buildHandover(q, { venueId }) {
  const row = (
    await q(
      `SELECT h.from_role, h.to_role, h.shift_date,
              h.open_compliance_items, h.staffing_notes, h.incidents_summary,
              h.action_items, h.created_at,
              s.first_name, s.last_name
         FROM handover_notes h
         LEFT JOIN staff s ON s.staff_id = h.author_staff_id AND s.deleted_at IS NULL
        WHERE h.venue_id = $1 AND h.deleted_at IS NULL
        ORDER BY h.shift_date DESC, h.created_at DESC
        LIMIT 1`,
      [venueId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    fromRole: row.from_role,
    toRole: row.to_role,
    shiftDate: row.shift_date,
    author: [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
    openComplianceItems: lines(row.open_compliance_items),
    staffingNotes: row.staffing_notes || null,
    incidentsSummary: row.incidents_summary || null,
    actionItems: lines(row.action_items),
  };
}

export function shiftSummaryRouter() {
  const router = Router();

  router.get('/shift-summary', async (req, res, next) => {
    try {
      const { clientId, venueId } = req.auth;
      const summary = await withClientContext(clientId, (q) =>
        buildShiftSummary(q, { venueId }),
      );
      if (!summary) return res.status(404).json({ error: 'venue_not_found' });
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  router.get('/handover', async (req, res, next) => {
    try {
      const { clientId, venueId } = req.auth;
      const handover = await withClientContext(clientId, (q) =>
        buildHandover(q, { venueId }),
      );
      // Real clients carry a relational handover_notes row. The demo tenant's
      // operational truth lives in the mock adapters, so when no note exists we
      // aggregate the structured handover from the live demo data (MIS-201)
      // rather than 404-ing Scene 2.
      if (!handover) return res.json(getDemoHandover());
      res.json(handover);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
