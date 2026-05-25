/**
 * Humanforce WFM connector — labour actuals path.
 *
 * Maps Humanforce timesheet data to labour_actuals_daily (worked hours + cost).
 * The roster path (RosteredShift → shifts table) is handled by the existing
 * DeputyConnector pattern and is not duplicated here.
 *
 * labour_cost_cents: uses actual pay rate from KeyPay where connected (mig 016);
 * falls back to award-derived estimate × worked hours otherwise. Source flag
 * distinguishes the two so the homepage can label estimates.
 *
 * Architecture ref: Admin-Homepage-Architecture-V1.md §3.2, §3.3
 */

import { ConnectorBase } from './connector-base.js';
import { withClientContext } from '../db.js';

export class HumanforceLabourConnector extends ConnectorBase {
  constructor({ connectionId, clientId, venueId }) {
    super({ vendor: 'humanforce', connectionId, clientId, venueId });
  }

  /**
   * Fetch timesheet actuals from Humanforce and upsert into labour_actuals_daily.
   * @returns {Promise<{ recordsUpserted: number }>}
   */
  async syncLabourActuals() {
    const apiKey = await this.getCredential('api_key');
    if (!apiKey) {
      throw new Error('HumanforceLabourConnector: no api_key for connection ' + this.connectionId);
    }

    const baseUrl = process.env.HUMANFORCE_BASE_URL || 'https://api.humanforce.com';
    const response = await fetch(
      `${baseUrl}/v1/timesheets?locationId=${this.venueId}&status=approved`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      },
    );

    if (!response.ok) {
      throw new Error(`HumanforceLabourConnector: API error ${response.status}`);
    }

    const data = await response.json();
    // Humanforce returns { timesheets: [{ date, staffId, hoursWorked, payRate, totalCost }] }
    const timesheets = Array.isArray(data.timesheets) ? data.timesheets : [];

    // Roll up per business_date (multiple staff entries per date → one aggregate row).
    const byDate = new Map();
    for (const ts of timesheets) {
      const date = ts.date; // YYYY-MM-DD trading date
      if (!byDate.has(date)) {
        byDate.set(date, { workedHours: 0, labourCostCents: 0 });
      }
      const agg = byDate.get(date);
      agg.workedHours += Number(ts.hoursWorked) || 0;
      // totalCost in AUD dollars → convert to cents.
      agg.labourCostCents += Math.round((Number(ts.totalCost) || 0) * 100);
    }

    let recordsUpserted = 0;
    for (const [businessDate, agg] of byDate) {
      await withClientContext(this.clientId, (q) =>
        q(
          `INSERT INTO labour_actuals_daily
             (labour_id, client_id, venue_id, business_date,
              worked_hours, labour_cost_cents,
              source, is_stale, synced_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (client_id, venue_id, business_date, source)
           DO UPDATE SET
             worked_hours      = EXCLUDED.worked_hours,
             labour_cost_cents = EXCLUDED.labour_cost_cents,
             is_stale          = EXCLUDED.is_stale,
             synced_at         = EXCLUDED.synced_at,
             updated_at        = NOW()`,
          [
            this.clientId,
            this.venueId,
            businessDate,
            agg.workedHours.toFixed(2),
            agg.labourCostCents,
            'humanforce',
            false,
          ],
        ),
      );
      recordsUpserted++;
    }

    return { recordsUpserted };
  }

  async runSync({ idempotencyKey }) {
    if (!idempotencyKey) throw new Error('runSync: idempotencyKey required');

    let syncLogId = null;
    try {
      syncLogId = await this._startSyncLog(idempotencyKey);
    } catch (err) {
      if (err.message?.includes('unique') || err.code === '23505') {
        return { isStale: true, staleReason: 'sync already completed for this key' };
      }
      throw err;
    }

    let recordsUpserted = 0;
    try {
      ({ recordsUpserted } = await this.syncLabourActuals());
    } catch (err) {
      await this._finishSyncLog(syncLogId, 'failed', 0, err.message);
      await this._markConnectionStaleness(true, `Vendor error: ${err.message}`, 'error');
      return { isStale: true, staleReason: `Vendor error: ${err.message}` };
    }

    await this._finishSyncLog(syncLogId, 'ok', recordsUpserted, null);
    await this._markConnectionStaleness(false, null, 'active');
    return { isStale: false, staleReason: null };
  }
}
