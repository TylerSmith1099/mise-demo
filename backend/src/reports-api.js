// Reports API — MIS-253 (extended MIS-642).
//
//   GET /api/reports
//     7-day P&L summary from pnl_summary table. Tier 4 only (Venue Manager).
//
//   GET /api/reports/channels?from=&to=&grain=daily|weekly|monthly&channels=gaming,bar
//     Per-channel revenue from revenue_daily with actual vs target, variance, trend.
//     Tiers 4 and 5. Channels: gaming, bar, food, bottle_shop.
//     - from / to: YYYY-MM-DD (default: past 30 days to today)
//     - grain: daily (default) | weekly | monthly
//     - channels: comma-separated (default: all 4)
//
// Gaming revenue is always NET RTV — never meter turnover.

import { Router } from 'express';
import { requireTier } from './permissions.js';
import { withClientContext } from './db.js';

// ─── Weekly targets (cents) — matches seed-revenue-channels.js exactly ────────
// NON-NEGOTIABLE: gaming = NET RTV only at 8.4% of $1.5M meter turnover/week
const WEEKLY_TARGETS = {
  gaming:      12_600_000,
  bar:          5_000_000,
  food:         8_000_000,
  bottle_shop:  5_200_000,
};

// Day weights Sun(0)→Sat(6) — must match seed DAY_WEIGHTS
const DAY_WEIGHTS = [0.17, 0.08, 0.08, 0.10, 0.12, 0.20, 0.25];

const CHANNEL_ORDER = ['gaming', 'bar', 'food', 'bottle_shop'];
const CHANNEL_LABELS = {
  gaming:      'Gaming',
  bar:         'Bar',
  food:        'Food',
  bottle_shop: 'Bottle Shop',
};
const CHANNEL_COLOURS = {
  gaming:      '#00E87A',
  bar:         '#00C8E8',
  food:        '#E8A020',
  bottle_shop: '#B87A3C',
};

// ─── Date helpers ─────────────────────────────────────────────────────────────
function isoDate(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
function brisToday() {
  return isoDate(new Date(Date.now() + 10 * 3_600_000));
}

// ─── Target calculation helpers ───────────────────────────────────────────────
function dailyTargetCents(channel, dateStr) {
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  return Math.round(WEEKLY_TARGETS[channel] * DAY_WEIGHTS[dow]);
}

function weeklyTargetCents(channel) {
  return WEEKLY_TARGETS[channel];
}

// Approximate monthly target: weekly × (days_in_month / 7)
function monthlyTargetCents(channel, yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return Math.round(WEEKLY_TARGETS[channel] * (daysInMonth / 7));
}

// ─── Trend calculation ────────────────────────────────────────────────────────
// Returns signed change pct vs prior same-grain period. null if no prior data.
function trendPct(current, prior) {
  if (current == null || prior == null || prior === 0) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10; // one decimal
}

// ─── Main channel query ───────────────────────────────────────────────────────
async function queryChannelRevenue(q, venueId, fromDate, toDate, grain, channels) {
  let dateTrunc;
  switch (grain) {
    case 'weekly':  dateTrunc = 'week';  break;
    case 'monthly': dateTrunc = 'month'; break;
    default:        dateTrunc = null;    // daily — no truncation
  }

  let sql, rows;
  if (!dateTrunc) {
    ({ rows } = await q(
      `SELECT channel,
              business_date::text AS period_start,
              SUM(net_revenue_cents)::bigint AS actual
         FROM revenue_daily
        WHERE venue_id = $1
          AND business_date >= $2
          AND business_date <= $3
          AND channel = ANY($4)
          AND deleted_at IS NULL
        GROUP BY channel, business_date
        ORDER BY channel, business_date`,
      [venueId, fromDate, toDate, channels],
    ));
  } else {
    ({ rows } = await q(
      `SELECT channel,
              date_trunc($5, business_date)::date::text AS period_start,
              SUM(net_revenue_cents)::bigint AS actual
         FROM revenue_daily
        WHERE venue_id = $1
          AND business_date >= $2
          AND business_date <= $3
          AND channel = ANY($4)
          AND deleted_at IS NULL
        GROUP BY channel, date_trunc($5, business_date)
        ORDER BY channel, date_trunc($5, business_date)`,
      [venueId, fromDate, toDate, channels, dateTrunc],
    ));
  }
  return rows;
}

// ─── Attach target + variance + trend to period rows ─────────────────────────
function enrichPeriods(rows, grain) {
  // Group by channel
  const byChannel = {};
  for (const row of rows) {
    if (!byChannel[row.channel]) byChannel[row.channel] = [];
    byChannel[row.channel].push({ period: row.period_start, actual: Number(row.actual) });
  }

  const result = [];
  for (const channel of CHANNEL_ORDER.filter((c) => byChannel[c])) {
    const periods = byChannel[channel];
    const enriched = periods.map((p, i) => {
      let target;
      if (grain === 'weekly') {
        target = weeklyTargetCents(channel);
      } else if (grain === 'monthly') {
        const ym = p.period.slice(0, 7);
        target = monthlyTargetCents(channel, ym);
      } else {
        target = dailyTargetCents(channel, p.period);
      }
      const variance = p.actual - target;
      const prior = i > 0 ? periods[i - 1].actual : null;
      return {
        period:   p.period,
        actual:   p.actual,
        target,
        variance,
        trend:    trendPct(p.actual, prior),
      };
    });
    result.push({
      channel,
      label:   CHANNEL_LABELS[channel],
      colour:  CHANNEL_COLOURS[channel],
      periods: enriched,
    });
  }
  return result;
}

// ─── Router ───────────────────────────────────────────────────────────────────
export function reportsRouter() {
  const router = Router();

  // Legacy P&L summary — tier 4 only
  router.get('/reports', requireTier([4]), async (req, res, next) => {
    try {
      const { clientId, venueId } = req.auth;

      const rows = await withClientContext(clientId, (q) =>
        q(
          `SELECT department, period_label, revenue, labour_cost, labour_pct,
                  net_gaming_revenue, meter_turnover
             FROM pnl_summary
            WHERE venue_id = $1 AND deleted_at IS NULL
            ORDER BY
              CASE department
                WHEN 'beverage'    THEN 1
                WHEN 'food'        THEN 2
                WHEN 'gaming'      THEN 3
                WHEN 'bottle_shop' THEN 4
                WHEN 'total'       THEN 5
                ELSE 6
              END`,
          [venueId],
        ).then((r) => r.rows),
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'no_reports_data' });
      }

      const periodLabel = rows[0].period_label;
      const departments = rows.map((r) => ({
        department: r.department,
        revenue: Number(r.revenue),
        labourCost: Number(r.labour_cost),
        labourPct: Number(r.labour_pct),
        netGamingRevenue: r.net_gaming_revenue != null ? Number(r.net_gaming_revenue) : null,
        meterTurnover: r.meter_turnover != null ? Number(r.meter_turnover) : null,
      }));

      res.json({ periodLabel, departments });
    } catch (err) {
      next(err);
    }
  });

  // Channel reports — tiers 4 and 5
  router.get('/reports/channels', requireTier([4, 5]), async (req, res, next) => {
    try {
      const { clientId, venueId } = req.auth;
      const today = brisToday();

      // Parse + validate params
      const rawFrom = req.query.from || addDays(today, -29);
      const rawTo   = req.query.to   || today;
      const grain   = ['daily', 'weekly', 'monthly'].includes(req.query.grain)
        ? req.query.grain : 'daily';

      const requestedChannels = req.query.channels
        ? req.query.channels.split(',').map((c) => c.trim()).filter((c) => CHANNEL_ORDER.includes(c))
        : [...CHANNEL_ORDER];

      if (!requestedChannels.length) {
        return res.status(400).json({ error: 'no_valid_channels' });
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(rawTo)) {
        return res.status(400).json({ error: 'invalid_date_format' });
      }

      // DM (tier 5) clamp to 7 days max (MIS-426 §3.2)
      let fromDate = rawFrom;
      let scopeClamped = false;
      if (req.auth.roleTier === 5) {
        const minFrom = addDays(today, -6);
        if (fromDate < minFrom) {
          fromDate = minFrom;
          scopeClamped = true;
        }
      } else {
        fromDate = rawFrom;
      }

      const rows = await withClientContext(clientId, (q) =>
        queryChannelRevenue(q, venueId, fromDate, rawTo, grain, requestedChannels),
      );

      const channels = enrichPeriods(rows, grain);

      res.json({
        from: fromDate,
        to: rawTo,
        grain,
        scopeClamped,
        channels,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
