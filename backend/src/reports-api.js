// Reports API — MIS-253.
//
//   GET /api/reports  -> 7-day P&L summary from pnl_summary table.
//   Returns revenue, labour_cost, labour_pct, net_gaming_revenue per department,
//   plus a 'total' row. Gaming uses NET RTV as denominator (never raw meter turnover).
//
// Access: Tier 4 (Venue Manager) only. Duty Manager (Tier 5) does not see reports.

import { Router } from 'express';
import { requireTier } from './permissions.js';
import { withClientContext } from './db.js';

export function reportsRouter() {
  const router = Router();

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

  return router;
}
