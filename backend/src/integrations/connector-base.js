/**
 * ConnectorBase — abstract base class every vendor connector extends.
 *
 * Contract:
 *   - subclasses implement fetchRoster() and/or fetchTimesheets()
 *   - ConnectorBase handles credential retrieval, sync logging, safe degradation,
 *     and staleness marking so each vendor connector contains only vendor-specific logic
 *
 * Safe degradation rules (per MIS-139 spec):
 *   1. On vendor outage / rate-limit / partial data → return last-known signal
 *      with isStale=true rather than throwing or returning empty.
 *   2. Staleness is surfaced via the signal's isStale + staleReason fields and
 *      written back to integration_connections.is_stale.
 *   3. Connector never fabricates data — stale means "last known", not "invented".
 */

import { withClientContext } from '../db.js';
import { getCredential } from './credential-store.js';

export class ConnectorBase {
  /**
   * @param {object} opts
   * @param {string} opts.vendor      — slug, e.g. 'deputy'
   * @param {string} opts.connectionId
   * @param {string} opts.clientId
   * @param {string} opts.venueId
   */
  constructor({ vendor, connectionId, clientId, venueId }) {
    if (!vendor || !connectionId || !clientId) {
      throw new Error('ConnectorBase: vendor, connectionId, and clientId are required');
    }
    this.vendor       = vendor;
    this.connectionId = connectionId;
    this.clientId     = clientId;
    this.venueId      = venueId || null;
  }

  /**
   * Retrieve a credential for this connection.
   * @param {'access_token'|'refresh_token'|'api_key'|'partner_key'} credentialType
   * @returns {Promise<string|null>}
   */
  async getCredential(credentialType) {
    return getCredential({
      connectionId: this.connectionId,
      clientId:     this.clientId,
      credentialType,
    });
  }

  /**
   * Fetch and normalise the current roster from the vendor.
   * Must return an array of RosteredShift objects.
   * Subclasses override this.
   * @returns {Promise<import('./signal-shape.js').RosteredShift[]>}
   */
  async fetchRoster() {
    throw new Error(`${this.constructor.name}.fetchRoster() not implemented`);
  }

  /**
   * Fetch and normalise timesheet entries from the vendor.
   * Must return an array of TimesheetEntry objects.
   * Subclasses override this.
   * @returns {Promise<import('./signal-shape.js').TimesheetEntry[]>}
   */
  async fetchTimesheets() {
    throw new Error(`${this.constructor.name}.fetchTimesheets() not implemented`);
  }

  /**
   * Run a full sync for this connection.
   * Handles idempotency key, sync log, safe degradation, and staleness marking.
   * @param {object} opts
   * @param {string} opts.idempotencyKey
   * @param {'roster'|'timesheets'|'all'} [opts.syncType='all']
   * @returns {Promise<{ shifts?: RosteredShift[], timesheets?: TimesheetEntry[], isStale: boolean, staleReason: string|null }>}
   */
  async runSync({ idempotencyKey, syncType = 'all' }) {
    if (!idempotencyKey) throw new Error('runSync: idempotencyKey required');

    // Start sync log (ignore duplicate key — idempotent)
    let syncLogId = null;
    try {
      syncLogId = await this._startSyncLog(idempotencyKey);
    } catch (err) {
      if (err.message?.includes('unique') || err.code === '23505') {
        // Already ran — return the last-known data as stale
        return this._degradedResult('sync already completed for this key');
      }
      throw err;
    }

    let shifts = [];
    let timesheets = [];
    let isStale = false;
    let staleReason = null;
    let syncStatus = 'ok';
    let recordsFetched = 0;
    let syncError = null;

    try {
      if (syncType === 'roster' || syncType === 'all') {
        shifts = await this.fetchRoster();
        recordsFetched += shifts.length;
      }
      if (syncType === 'timesheets' || syncType === 'all') {
        timesheets = await this.fetchTimesheets();
        recordsFetched += timesheets.length;
      }
    } catch (err) {
      syncStatus = 'failed';
      syncError  = err.message;
      isStale    = true;
      staleReason = `Vendor error: ${err.message}`;

      // Fall back to last-known data
      const fallback = await this._degradedResult(staleReason);
      await this._finishSyncLog(syncLogId, 'failed', recordsFetched, err.message);
      await this._markConnectionStaleness(true, staleReason, 'error');
      return fallback;
    }

    await this._finishSyncLog(syncLogId, syncStatus, recordsFetched, null);
    await this._markConnectionStaleness(false, null, 'active');

    return { shifts, timesheets, isStale, staleReason };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  async _startSyncLog(idempotencyKey) {
    return withClientContext(this.clientId, async (q) => {
      const result = await q(
        `INSERT INTO integration_sync_log
           (connection_id, client_id, idempotency_key, status)
         VALUES ($1, $2, $3, 'running')
         RETURNING id`,
        [this.connectionId, this.clientId, idempotencyKey]
      );
      return result.rows[0].id;
    });
  }

  async _finishSyncLog(syncLogId, status, recordsFetched, errorDetail) {
    if (!syncLogId) return;
    await withClientContext(this.clientId, async (q) => {
      await q(
        `UPDATE integration_sync_log
            SET finished_at = NOW(), status = $1, records_fetched = $2, error_detail = $3
          WHERE id = $4`,
        [status, recordsFetched, errorDetail, syncLogId]
      );
    });
  }

  async _markConnectionStaleness(isStale, staleReason, connectionStatus) {
    await withClientContext(this.clientId, async (q) => {
      await q(
        `UPDATE integration_connections
            SET is_stale = $1,
                stale_since = CASE WHEN $1 AND stale_since IS NULL THEN NOW() ELSE stale_since END,
                stale_reason = $2,
                last_synced_at = NOW(),
                last_sync_status = $3,
                status = $4
          WHERE id = $5`,
        [isStale, staleReason, isStale ? 'failed' : 'ok', connectionStatus, this.connectionId]
      );
    });
  }

  /**
   * Return a stale fallback result. Subclasses may override to provide
   * cached last-known data from the DB. Default returns empty + stale flag.
   */
  async _degradedResult(reason) {
    return {
      shifts:      [],
      timesheets:  [],
      isStale:     true,
      staleReason: reason || 'vendor unavailable',
    };
  }
}
