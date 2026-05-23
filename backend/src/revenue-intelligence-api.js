// Revenue Intelligence API — MIS-238.
//
//   GET  /api/revenue-intelligence  -> department-level labour % vs benchmark,
//        gaming using net RTV (meter × 7%) as denominator, not meter turnover.
//   POST /api/revenue-intelligence/flag  -> log a revenue flag to the DM's
//        current shift runsheet. Gracefully returns { persisted: false } when
//        no active shift exists (demo tenants without seeded shifts).
//
// Access: Tier 4 (Venue Manager) and Tier 5 (Duty Manager) only.
// Gaming Attendants (Tier 7) and floor staff do not see labour data.

import { Router } from 'express';
import { requireTier } from './permissions.js';
import { withClientContext } from './db.js';
import { getRevenueIntelligence } from './integrations/mock/revenue-intelligence.js';

export function revenueIntelligenceRouter() {
  const router = Router();

  router.get('/revenue-intelligence', requireTier([4, 5]), (_req, res, next) => {
    try {
      res.json(getRevenueIntelligence());
    } catch (err) {
      next(err);
    }
  });

  router.post('/revenue-intelligence/flag', requireTier([4, 5]), async (req, res, next) => {
    try {
      const { clientId, staffId, venueId } = req.auth;
      const { department, labourPct } = req.body || {};
      if (!department) return res.status(400).json({ error: 'department_required' });

      // Find the caller's current active shift (shift window contains now()).
      const shiftRow = await withClientContext(clientId, (q) =>
        q(
          `SELECT shift_id FROM shifts
            WHERE staff_id = $1 AND venue_id = $2
              AND deleted_at IS NULL
              AND now() BETWEEN shift_start AND shift_end
            ORDER BY shift_start DESC LIMIT 1`,
          [staffId, venueId],
        ).then((r) => r.rows[0] || null),
      );

      if (!shiftRow) {
        // No active shift — flag cannot be persisted to runsheet. Graceful response.
        return res.json({ flagged: true, persisted: false, note: 'No active shift found.' });
      }

      const pctLabel = labourPct != null ? ` at ${labourPct}%` : '';
      const timeLabel = new Date().toLocaleTimeString('en-AU', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'Australia/Brisbane',
      });
      const noteText = `Revenue flag: ${department} labour${pctLabel} — ${timeLabel}`;

      const itemId = await withClientContext(clientId, (q) =>
        q(
          `INSERT INTO runsheet_items
             (client_id, shift_id, task_description, category, item_order)
           VALUES ($1, $2, $3, 'compliance', 999)
           RETURNING item_id`,
          [clientId, shiftRow.shift_id, noteText],
        ).then((r) => r.rows[0]?.item_id),
      );

      res.json({ flagged: true, persisted: true, itemId, note: noteText });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
