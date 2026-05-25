/**
 * H&L POS connector — maps H&L sales API response to RevenueSignal
 * and upserts into revenue_daily.
 *
 * Same contract as BepozConnector: swapping H&L for BEPOZ must not change
 * what the admin homepage consumes. Only the vendor-specific API mapping differs.
 *
 * Architecture ref: Admin-Homepage-Architecture-V1.md §3.1, §3.2
 */

import { ConnectorBase } from './connector-base.js';
import { makeRevenueSignal } from './signal-shape.js';
import { withClientContext } from '../db.js';

export class HlConnector extends ConnectorBase {
  constructor({ connectionId, clientId, venueId, venueTimezone = 'Australia/Brisbane' }) {
    super({ vendor: 'hl', connectionId, clientId, venueId });
    this.venueTimezone = venueTimezone;
  }

  /**
   * Fetch daily revenue totals from H&L.
   * @returns {Promise<import('./signal-shape.js').RevenueSignal[]>}
   */
  async fetchRevenue() {
    const apiKey = await this.getCredential('api_key');
    if (!apiKey) {
      throw new Error('HlConnector: no api_key credential found for connection ' + this.connectionId);
    }

    const baseUrl = process.env.HL_BASE_URL || 'https://api.handt l.com.au';
    const response = await fetch(`${baseUrl}/v2/sales/daily?siteId=${this.venueId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HlConnector: API error ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    // H&L returns { dailySales: [{ date, totalGross, totalNet, transactions }] }
    const records = Array.isArray(data.dailySales) ? data.dailySales : [];

    return records.map((r) =>
      makeRevenueSignal({
        id:           `hl:${this.venueId}:${r.date}`,
        venueId:      this.venueId,
        businessDate: r.date,       // YYYY-MM-DD in venue-local trading date
        grossCents:   Math.round((r.totalGross || 0) * 100),
        netCents:     Math.round((r.totalNet || 0) * 100),
        txnCount:     r.transactions || 0,
        source:       'hl',
        syncedAt:     new Date().toISOString(),
        isStale:      false,
      }),
    );
  }

  /**
   * Idempotent upsert into revenue_daily. Identical to BepozConnector — same
   * canonical table, same conflict key.
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
}
