/**
 * KeyPay / Employment Hero Payroll connector — Slot 2 (award pay-rates).
 *
 * Responsibilities:
 *   - Fetch business-level and employee-specific pay rates from the KeyPay API.
 *   - Normalise vendor payloads into the stable `PayRate` signal shape so award-
 *     reasoning consumers never depend on KeyPay's response structure.
 *   - Act as a penalty-rate oracle: Mise's award reasoning can query the rate
 *     KeyPay has computed (via its own modern-award engine) and compare it
 *     against Mise's own conclusion.
 *
 * Auth: API key. KeyPay accepts `Authorization: ApiKey <key>`.
 * Scope: read-only. No write-back at MVP.
 * Data residency: AWS AU. The base URL resolves within Australia.
 *
 * Security:
 *   - API key is retrieved via the encrypted credential store (never hardcoded/logged).
 *   - Pay/rate data is employee PII under the Privacy Act / APPs — only the fields
 *     needed for the operational signal are pulled; no super, tax, or banking data.
 *   - clientId comes from the verified connection row / constructor, never from
 *     request bodies or vendor payloads.
 *
 * Degradation: on any vendor error or 4xx/5xx, `runPayRateSync` returns an empty
 * array with isStale=true rather than propagating the error to callers.
 */

import { ConnectorBase } from './connector-base.js';
import { makePayRate } from './signal-shape.js';
import { withClientContext } from '../db.js';
import { storeCredential } from './credential-store.js';

const KEYPAY_API_BASE = 'https://api.yourpayroll.com.au/api/v2';

// ---------------------------------------------------------------------------
// KeyPayConnector
// ---------------------------------------------------------------------------

export class KeyPayConnector extends ConnectorBase {
  /**
   * @param {object} opts
   * @param {string}   opts.connectionId
   * @param {string}   opts.clientId
   * @param {string}   [opts.venueId]
   * @param {string}   opts.businessId  — KeyPay business ID (from integration_connections.config)
   * @param {Function} [opts._fetch]    — injectable fetch; defaults to globalThis.fetch (tests only)
   */
  constructor(opts) {
    super({ vendor: 'keypay', ...opts });
    if (!opts.businessId) {
      throw new Error('KeyPayConnector: businessId is required');
    }
    this.businessId = String(opts.businessId);
    this._fetch     = opts._fetch || globalThis.fetch;
  }

  // ConnectorBase contract — KeyPay is payroll-only, not a rostering system.
  async fetchRoster()     { return []; }
  async fetchTimesheets() { return []; }

  // ---------------------------------------------------------------------------
  // Pay rate fetch — the core oracle function
  // ---------------------------------------------------------------------------

  /**
   * Fetch pay rates from KeyPay and return normalised PayRate signal objects.
   *
   * @param {object}  [opts]
   * @param {string}  [opts.employeeId]  — if provided, fetch employee-specific rates;
   *                                       otherwise fetch business-level rate schedule.
   * @returns {Promise<import('./signal-shape.js').PayRate[]>}
   */
  async fetchPayRates({ employeeId } = {}) {
    const headers  = await this._buildAuthHeaders();
    const url      = employeeId
      ? `${KEYPAY_API_BASE}/business/${this.businessId}/employee/${employeeId}/payrates`
      : `${KEYPAY_API_BASE}/business/${this.businessId}/payrate`;

    const resp = await this._fetch(url, { headers });

    if (!resp.ok) {
      // 401 / 403 → bad creds; 429 → rate limit; 5xx → vendor outage.
      // All treated identically: throw so runPayRateSync can degrade safely.
      throw new Error(`KeyPay ${resp.status}: GET ${url}`);
    }

    const body    = await resp.json();
    const records = Array.isArray(body) ? body : (body.items || body.data || []);
    const now     = new Date().toISOString();

    return records.map(r => makePayRate({
      id:                 `keypay:${this.businessId}:payrate:${r.id ?? r.payRateId}`,
      connectionId:       this.connectionId,
      venueId:            this.venueId,
      externalBusinessId: this.businessId,
      externalEmployeeId: r.employeeId    ? String(r.employeeId) : (employeeId ? String(employeeId) : null),
      awardCode:          r.awardCode     ?? r.modernAwardCode    ?? null,
      awardName:          r.awardName     ?? r.modernAwardName    ?? null,
      employmentType:     r.employmentType ?? r.type,
      rateType:           r.rateType ?? r.type ?? r.name,
      rateName:           r.name          ?? r.rateName           ?? '',
      rateMultiplier:     typeof r.multiplier === 'number' ? r.multiplier : null,
      rateAmount:         typeof r.rate       === 'number' ? r.rate
                        : typeof r.amount     === 'number' ? r.amount : null,
      effectiveFrom:      r.effectiveFrom ?? r.startDate ?? null,
      source:             'keypay',
      syncedAt:           now,
      isStale:            false,
    }));
  }

  // ---------------------------------------------------------------------------
  // Sync lifecycle — mirrors ConnectorBase.runSync but for pay rates
  // ---------------------------------------------------------------------------

  /**
   * Run a pay-rate sync for this connection.
   * Idempotent — a second call with the same key returns stale rather than
   * re-fetching or throwing.
   *
   * @param {object}  opts
   * @param {string}  opts.idempotencyKey
   * @param {string}  [opts.employeeId]   — if provided, fetch employee-specific rates
   * @returns {Promise<{ payRates: PayRate[], isStale: boolean, staleReason: string|null }>}
   */
  async runPayRateSync({ idempotencyKey, employeeId } = {}) {
    if (!idempotencyKey) throw new Error('runPayRateSync: idempotencyKey required');

    let syncLogId = null;
    try {
      syncLogId = await this._startSyncLog(idempotencyKey);
    } catch (err) {
      if (err.message?.includes('unique') || err.code === '23505') {
        return _degradedPayRateResult('sync already completed for this key');
      }
      throw err;
    }

    try {
      const payRates = await this.fetchPayRates({ employeeId });
      await this._finishSyncLog(syncLogId, 'ok', payRates.length, null);
      await this._markConnectionStaleness(false, null, 'active');
      return { payRates, isStale: false, staleReason: null };
    } catch (err) {
      const reason = `Vendor error: ${err.message}`;
      await this._finishSyncLog(syncLogId, 'failed', 0, err.message);
      await this._markConnectionStaleness(true, reason, 'error');
      return _degradedPayRateResult(reason);
    }
  }

  /**
   * Award-rate oracle: query the applicable rates for a given classification.
   * Returns the subset of pay rates matching the requested rateType / employmentType.
   *
   * Example: rateType='penalty', employmentType='casual' returns all casual penalty
   * rates held in KeyPay for this business — Mise's award reasoning checks its own
   * conclusion against these before surfacing a figure to the user.
   *
   * @param {object}  opts
   * @param {string}  [opts.employeeId]
   * @param {string}  [opts.rateType]        — filter by normalised rate type
   * @param {string}  [opts.employmentType]  — filter by normalised employment type
   * @returns {Promise<{ rates: PayRate[], isStale: boolean, staleReason: string|null }>}
   */
  async queryAwardRate({ employeeId, rateType, employmentType } = {}) {
    // Use a time-bucketed idempotency key so we don't over-fetch within a window.
    const bucket      = new Date().toISOString().slice(0, 16); // minute-level bucket
    const idKey       = `keypay:${this.connectionId}:award:${employeeId || 'all'}:${bucket}`;
    const { payRates, isStale, staleReason } = await this.runPayRateSync({ idempotencyKey: idKey, employeeId });

    const rates = payRates.filter(r =>
      (!rateType       || r.rateType       === rateType) &&
      (!employmentType || r.employmentType === employmentType)
    );

    return { rates, isStale, staleReason };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  async _buildAuthHeaders() {
    const apiKey = await this.getCredential('api_key');
    if (!apiKey) {
      throw new Error('KeyPay: no api_key credential found for this connection');
    }
    // Never log the key. Log connection id only.
    return {
      'Authorization': `ApiKey ${apiKey}`,
      'Accept':        'application/json',
    };
  }
}

function _degradedPayRateResult(reason) {
  return { payRates: [], isStale: true, staleReason: reason || 'vendor unavailable' };
}

// ---------------------------------------------------------------------------
// Registration helper
// ---------------------------------------------------------------------------

/**
 * Register a KeyPay connection for a client and store its API key.
 * Idempotent — returns existing connection id if vendor='keypay' already exists
 * for this client.
 *
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.businessId   — KeyPay business ID (stored in config; not a secret)
 * @param {string} opts.apiKey       — KeyPay API key (encrypted at rest via credential store)
 * @param {string} [opts.displayName]
 * @returns {Promise<{ connectionId: string, credentialId: string }>}
 */
export async function registerKeyPayConnection({ clientId, businessId, apiKey, displayName }) {
  if (!clientId || !businessId || !apiKey) {
    throw new Error('registerKeyPayConnection: clientId, businessId, and apiKey are required');
  }

  const connectionId = await withClientContext(clientId, async (q) => {
    const existing = await q(
      `SELECT id FROM integration_connections
        WHERE client_id = $1 AND vendor = 'keypay' AND deleted_at IS NULL
        LIMIT 1`,
      [clientId]
    );
    if (existing.rows.length > 0) return existing.rows[0].id;

    const result = await q(
      `INSERT INTO integration_connections (client_id, vendor, display_name, config)
       VALUES ($1, 'keypay', $2, $3)
       RETURNING id`,
      [clientId, displayName || 'KeyPay Payroll', JSON.stringify({ businessId: String(businessId) })]
    );
    return result.rows[0].id;
  });

  const credentialId = await storeCredential({
    connectionId,
    clientId,
    credentialType: 'api_key',
    plaintext:      apiKey,
  });

  return { connectionId, credentialId };
}
