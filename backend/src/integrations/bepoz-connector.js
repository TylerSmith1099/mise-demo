/**
 * BEPOZ POS connector — maps BEPOZ end-of-day Z-read totals to RevenueSignal
 * and upserts into revenue_daily via the canonical normalisation layer.
 *
 * Extends ConnectorBase so sync logging, staleness marking, and safe degradation
 * are inherited. Vendor-specific logic is confined here — swapping BEPOZ for
 * another POS vendor must not change what the admin homepage consumes.
 *
 * Architecture ref: Admin-Homepage-Architecture-V1.md §3.1, §3.2
 */

import { ConnectorBase } from './connector-base.js';
import { makeRevenueSignal } from './signal-shape.js';
import { withClientContext } from '../db.js';

export class BepozConnector extends ConnectorBase {
  constructor({ connectionId, clientId, venueId, venueTimezone = 'Australia/Brisbane' }) {
    super({ vendor: 'bepoz', connectionId, clientId, venueId });
    this.venueTimezone = venueTimezone;
  }

  /**
   * Fetch daily revenue totals from BEPOZ.
   * Returns an array of RevenueSignal objects, one per trading date returned.
   * @returns {Promise<import('./signal-shape.js').RevenueSignal[]>}
   */
  async fetchRevenue() {
    const apiKey = await this.getCredential('api_key');
    if (!apiKey) {
      throw new Error('BepozConnector: no api_key credential found for connection ' + this.connectionId);
    }

    // BEPOZ sales summary API: returns array of Z-read totals per trading date.
    // Endpoint and auth are vendor-specific; only the mapping below matters to consumers.
    const baseUrl = await this._getBaseUrl();
    const response = await fetch(`${baseUrl}/api/v1/sales/summary?venueId=${this.venueId}`, {
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`BepozConnector: API error ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const records = Array.isArray(data.records) ? data.records : [];

    return records.map((r) =>
      makeRevenueSignal({
        id:           `bepoz:${this.venueId}:${r.tradingDate}`,
        venueId:      this.venueId,
        businessDate: r.tradingDate,  // YYYY-MM-DD in venue-local trading date
        grossCents:   Math.round((r.grossSalesInclGST || 0) * 100),
        netCents:     Math.round((r.netSales || r.netSalesExclGST || 0) * 100),
        txnCount:     r.transactionCount || 0,
        source:       'bepoz',
        syncedAt:     new Date().toISOString(),
        isStale:      false,
      }),
    );
  }

  /**
   * Idempotent upsert of revenue signals into revenue_daily.
   * UNIQUE(client_id, venue_id, business_date, source) + ON CONFLICT DO UPDATE.
   * @param {import('./signal-shape.js').RevenueSignal[]} signals
   */
  async upsertRevenue(signals) {
    for (const sig of signals) {
      await withClientContext(this.clientId, (q) =>
        q(
          `INSERT INTO revenue_daily
             (revenue_id, client_id, venue_id, business_date,
              gross_revenue_cents, net_revenue_cents, transaction_count,
              source, is_stale, synced_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (client_id, venue_id, business_date, source)
           DO UPDATE SET
             gross_revenue_cents = EXCLUDED.gross_revenue_cents,
             net_revenue_cents   = EXCLUDED.net_revenue_cents,
             transaction_count   = EXCLUDED.transaction_count,
             is_stale            = EXCLUDED.is_stale,
             synced_at           = EXCLUDED.synced_at,
             updated_at          = NOW()`,
          [
            this.clientId,
            sig.venueId,
            sig.businessDate,
            sig.grossCents,
            sig.netCents,
            sig.txnCount,
            sig.source,
            sig.isStale,
            sig.syncedAt,
          ],
        ),
      );
    }
  }

  /**
   * Full revenue sync: fetch → upsert → log.
   * Overrides ConnectorBase.runSync to add the revenue data path.
   */
  async runSync({ idempotencyKey }) {
    if (!idempotencyKey) throw new Error('runSync: idempotencyKey required');

    let syncLogId = null;
    try {
      syncLogId = await this._startSyncLog(idempotencyKey);
    } catch (err) {
      if (err.message?.includes('unique') || err.code === '23505') {
        return { signals: [], isStale: true, staleReason: 'sync already completed for this key' };
      }
      throw err;
    }

    let signals = [];
    try {
      signals = await this.fetchRevenue();
      await this.upsertRevenue(signals);
    } catch (err) {
      await this._finishSyncLog(syncLogId, 'failed', 0, err.message);
      await this._markConnectionStaleness(true, `Vendor error: ${err.message}`, 'error');
      return { signals: [], isStale: true, staleReason: `Vendor error: ${err.message}` };
    }

    await this._finishSyncLog(syncLogId, 'ok', signals.length, null);
    await this._markConnectionStaleness(false, null, 'active');
    return { signals, isStale: false, staleReason: null };
  }

  async _getBaseUrl() {
    // Base URL stored as a credential of type 'api_key' partner key (connection config).
    // Fallback to env var for development.
    return process.env.BEPOZ_BASE_URL || 'https://api.bepoz.com.au';
  }
}
