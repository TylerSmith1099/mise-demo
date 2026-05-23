/**
 * DeputyConnector — read-only rostering / WFM / T&A connector for Deputy.
 *
 * Slot 1 of the P1 integration build (MIS-141). Feeds the MIS-44 understaffing
 * alert with who is rostered and who is actually clocked on right now.
 *
 * Deputy API reference: https://{installName}.au.deputy.com/api/v1/
 * Auth: OAuth 2.0 — access_token in Authorization header (1-hour lifetime).
 * All writes go via the normalised signal shape so swapping Deputy↔Humanforce
 * does not change what MIS-44 receives.
 *
 * ── RSA/RCG certification note (MIS-141) ───────────────────────────────────
 * Deputy does NOT expose RSA/RCG certification as a first-class field in the
 * standard Roster or Employee endpoints. Certification is available only via
 * the optional Training module, which must be enabled on the venue's Deputy
 * plan AND have RSA/RCG configured as training record types.
 * fetchCertifications() attempts the Training endpoint and returns null if
 * unavailable. CTO has been flagged — see MIS-141 thread.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { ConnectorBase } from './connector-base.js';
import { makeRosteredShift, makeTimesheetEntry, makeStaffingSnapshot } from './signal-shape.js';
import { getCredential, storeCredential } from './credential-store.js';
import { deputyBaseUrl, refreshDeputyAccessToken, storeDeputyTokens } from './deputy-oauth.js';
import { withClientContext } from '../db.js';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Map a Deputy OperationalUnit name to a Mise normalised role slug.
 * Matching is case-insensitive and keyword-based.
 * @param {string} unitName
 * @returns {'gaming_attendant'|'duty_manager'|'bar'|'kitchen'|'other'}
 */
export function normaliseDutyRole(unitName = '') {
  const n = unitName.toLowerCase();
  if (/gaming|egm|machine|pokies|slots/.test(n))            return 'gaming_attendant';
  if (/duty[\s_-]?ma?na?ger|duty[\s_-]?mgr|mod\b|manager[\s_-]?on[\s_-]?duty/.test(n))
    return 'duty_manager';
  if (/\bbar\b|cellar|beverage|cocktail|drink/.test(n))     return 'bar';
  if (/kitchen|chef|cook|culinary|food/.test(n))            return 'kitchen';
  return 'other';
}

/**
 * Convert a Deputy Unix timestamp (seconds) to an ISO 8601 UTC string.
 * @param {number} ts — seconds since epoch
 * @returns {string}
 */
export function deputyTsToUtc(ts) {
  return new Date(ts * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Connection registration helper
// ---------------------------------------------------------------------------

/**
 * Register a Deputy integration connection for a client and store its OAuth
 * credentials. Idempotent — returns existing connectionId if already registered.
 *
 * Call this once during venue onboarding (after the OAuth authorization code
 * flow completes). The connector can then be instantiated for any subsequent sync.
 *
 * Non-secret config (installName, oauthClientId) is NOT stored in the
 * credential table — it belongs in the app's connection config/environment.
 * Only secrets go in integration_credentials.
 *
 * @param {{
 *   clientId:          string,
 *   installName:       string,   // Deputy subdomain, e.g. "myvenue"
 *   oauthClientSecret: string,   // Deputy OAuth app client_secret (SECRET — stored as 'api_key')
 *   accessToken:       string,   // initial access token from auth code exchange
 *   expiresIn?:        number,   // access token lifetime in seconds
 *   refreshToken?:     string,   // refresh token from auth code exchange
 *   displayName?:      string,
 * }} opts
 * @returns {Promise<string>} connectionId
 */
export async function registerDeputyConnection({
  clientId, installName, oauthClientSecret,
  accessToken, expiresIn, refreshToken, displayName,
}) {
  const connectionId = await withClientContext(clientId, async (q) => {
    const existing = await q(
      `SELECT id FROM integration_connections
        WHERE client_id = $1 AND vendor = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [clientId, 'deputy'],
    );
    if (existing.rows.length > 0) return existing.rows[0].id;

    const result = await q(
      `INSERT INTO integration_connections (client_id, vendor, display_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [clientId, 'deputy', displayName || `Deputy (${installName})`],
    );
    return result.rows[0].id;
  });

  // Store the OAuth client secret using the 'api_key' slot (it IS a secret API key)
  if (oauthClientSecret) {
    await storeCredential({
      connectionId, clientId,
      credentialType: 'api_key',
      plaintext: oauthClientSecret,
    });
  }

  // Store initial OAuth tokens
  await storeDeputyTokens({ connectionId, clientId, accessToken, expiresIn, refreshToken });

  return connectionId;
}

// ---------------------------------------------------------------------------
// DeputyConnector
// ---------------------------------------------------------------------------

export class DeputyConnector extends ConnectorBase {
  /**
   * @param {object} opts
   * @param {string}   opts.connectionId
   * @param {string}   opts.clientId
   * @param {string}   opts.venueId
   * @param {string}   opts.installName       — Deputy subdomain (e.g. "myvenue")
   * @param {string}   opts.oauthClientId     — Deputy OAuth app client id
   * @param {string}   opts.oauthClientSecret — Deputy OAuth app client secret
   * @param {Function} [opts._fetchFn]        — injectable fetch for unit tests
   */
  constructor({ connectionId, clientId, venueId, installName, oauthClientId, oauthClientSecret, _fetchFn }) {
    super({ vendor: 'deputy', connectionId, clientId, venueId });
    if (!installName) throw new Error('DeputyConnector: installName is required');
    this.installName       = installName;
    this.oauthClientId     = oauthClientId || '';
    this.oauthClientSecret = oauthClientSecret || '';
    this.baseUrl           = deputyBaseUrl(installName);
    this._fetch            = _fetchFn || fetch;
    this._cachedToken      = null; // cleared per-instance, not across heartbeats
    this._ouCache          = null;
  }

  // ---------------------------------------------------------------------------
  // ConnectorBase overrides
  // ---------------------------------------------------------------------------

  /**
   * Fetch published rostered shifts (1h lookback → 24h ahead) and map to
   * RosteredShift[]. Open (unassigned) shifts are included with status 'scheduled'.
   */
  async fetchRoster() {
    const nowSec    = Math.floor(Date.now() / 1000);
    const pastSec   = nowSec - 3600;    // 1h back: catch in-progress shifts
    const futureSec = nowSec + 86400;   // 24h ahead

    const [rosterRows, ouMap] = await Promise.all([
      this._queryResource('Roster', {
        search: {
          s1: { field: 'StartTime', type: 'ge', data: pastSec },
          s2: { field: 'StartTime', type: 'le', data: futureSec },
          s3: { field: 'Published', type: 'eq', data: 1 },
        },
        sort:  { field: 'StartTime', order: 'asc' },
        max:   500,
        start: 0,
      }),
      this._getOperationalUnits(),
    ]);

    const nowMs = Date.now();

    return rosterRows.map((r) => {
      const startMs = r.StartTime * 1000;
      const endMs   = r.EndTime   * 1000;

      let status;
      if (r.Open)             status = 'scheduled'; // open shift — not yet assigned
      else if (nowMs < startMs) status = 'scheduled';
      else if (nowMs > endMs)   status = 'completed';
      else                      status = 'in_progress';

      const unitName = ouMap[r.OperationalUnit]?.OperationalUnitName || '';

      return makeRosteredShift({
        id:              `deputy:roster:${r.Id}`,
        venueId:         this.venueId,
        staffId:         null, // resolved later via staff-matching pass
        externalStaffId: r.Open ? `open:${r.Id}` : String(r.Employee),
        role:            normaliseDutyRole(unitName),
        startUtc:        deputyTsToUtc(r.StartTime),
        endUtc:          deputyTsToUtc(r.EndTime),
        status,
        source:          'deputy',
      });
    });
  }

  /**
   * Fetch timesheet entries for the last 7 days and map to TimesheetEntry[].
   * Only includes timesheets with both a start and end time (excludes open clock-ins).
   *
   * Deputy T&A does not carry award/pay categories — that signal comes from
   * KeyPay (Slot 2). payCategory defaults to 'ordinary' here.
   */
  async fetchTimesheets() {
    const nowSec     = Math.floor(Date.now() / 1000);
    const weekAgoSec = nowSec - 7 * 86400;

    const rows = await this._queryResource('Timesheet', {
      search: {
        s1: { field: 'StartTime', type: 'ge', data: weekAgoSec },
        s2: { field: 'StartTime', type: 'le', data: nowSec },
      },
      sort:  { field: 'StartTime', order: 'desc' },
      max:   500,
      start: 0,
    });

    return rows
      .filter((r) => r.StartTime && r.EndTime) // skip open clock-ins
      .map((r) => makeTimesheetEntry({
        id:              `deputy:ts:${r.Id}`,
        venueId:         this.venueId,
        staffId:         null,
        externalStaffId: String(r.Employee),
        periodStartUtc:  deputyTsToUtc(r.StartTime),
        periodEndUtc:    deputyTsToUtc(r.EndTime),
        hoursWorked:     typeof r.TotalTime === 'number' ? r.TotalTime : 0,
        payCategory:     'ordinary', // Deputy T&A has no award category — KeyPay owns this
        source:          'deputy',
      }));
  }

  // ---------------------------------------------------------------------------
  // Additional public methods (beyond ConnectorBase contract)
  // ---------------------------------------------------------------------------

  /**
   * Build a point-in-time StaffingSnapshot for MIS-44.
   * Filters the roster to currently in-progress shifts.
   *
   * @param {import('./signal-shape.js').RosteredShift[]} shifts — from fetchRoster()
   * @returns {import('./signal-shape.js').StaffingSnapshot}
   */
  buildSnapshot(shifts) {
    const active = shifts.filter((s) => s.status === 'in_progress');
    return makeStaffingSnapshot({
      connectionId: this.connectionId,
      venueId:      this.venueId,
      asOfUtc:      new Date().toISOString(),
      rostered:     active,
      source:       'deputy',
    });
  }

  /**
   * Attempt to fetch RSA/RCG training records from the Deputy Training module.
   *
   * Deputy does NOT expose certifications in the standard Roster or Employee API.
   * This calls the optional Training module endpoint. Returns null if the module is
   * unavailable (404 / 403 / plan restriction). When null is returned, the
   * compliance signal falls back to seeded certification data.
   *
   * CTO flag: if the pilot venue's Deputy plan does not include the Training module,
   * RSA/RCG cert status cannot be sourced from Deputy at MVP. See MIS-141.
   *
   * @returns {Promise<Array<{employeeId:string,trainingType:string,expiresAt:string|null,status:string}>|null>}
   */
  async fetchCertifications() {
    const accessToken = await this._getAccessToken();
    let res;
    try {
      res = await this._deputyFetch('/api/v1/resource/TrainingRecord', accessToken, { method: 'GET' });
    } catch {
      return null;
    }

    if (!res.ok) return null; // Training module unavailable on this plan/install

    let rows;
    try {
      rows = await res.json();
    } catch {
      return null;
    }

    if (!Array.isArray(rows)) return null;

    return rows
      .filter((r) => {
        const name = (r.TrainingType?.Title || r.TrainingTypeName || '').toLowerCase();
        return /rsa|rsg|rcg|responsible[\s_-]?service|responsible[\s_-]?conduct/.test(name);
      })
      .map((r) => ({
        employeeId:   String(r.Employee),
        trainingType: r.TrainingType?.Title || 'RSA/RCG',
        expiresAt:    r.Expiry ? deputyTsToUtc(r.Expiry) : null,
        status:       r.Active ? 'active' : 'expired',
      }));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Return a valid Deputy access token.
   * Uses an in-instance cache to avoid repeated DB reads within one sync run.
   * On cache miss (token expired or not stored), falls through to refresh.
   */
  async _getAccessToken() {
    if (this._cachedToken) return this._cachedToken;

    let token = await getCredential({
      connectionId:   this.connectionId,
      clientId:       this.clientId,
      credentialType: 'access_token',
    });

    if (!token) {
      // Access token expired — use refresh token to obtain a new one
      token = await refreshDeputyAccessToken({
        connectionId:      this.connectionId,
        clientId:          this.clientId,
        installName:       this.installName,
        oauthClientId:     this.oauthClientId,
        oauthClientSecret: this.oauthClientSecret,
        _fetchFn:          this._fetch,
      });
    }

    this._cachedToken = token;
    return token;
  }

  /**
   * Make an authenticated GET or POST request to the Deputy API.
   * Translates 429 and 401 into descriptive errors (no token values in messages).
   */
  async _deputyFetch(path, accessToken, init = {}) {
    const url = `${this.baseUrl}${path}`;
    const res = await this._fetch(url, {
      ...init,
      headers: {
        Authorization:  `OAuth ${accessToken}`,
        'Content-Type': 'application/json',
        Accept:         'application/json',
        ...(init.headers || {}),
      },
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers?.get?.('Retry-After') || 10);
      throw new Error(`DeputyAPI: rate limited — retry after ${retryAfter}s`);
    }
    if (res.status === 401) {
      // Clear cached token so the next sync attempt tries a refresh
      this._cachedToken = null;
      throw new Error('DeputyAPI: 401 Unauthorized — re-authorization may be required');
    }

    return res;
  }

  /**
   * POST to a Deputy resource QUERY endpoint.
   * @param {string} resource — e.g. 'Roster', 'Timesheet'
   * @param {object} body     — QUERY payload
   * @returns {Promise<object[]>}
   */
  async _queryResource(resource, body) {
    const accessToken = await this._getAccessToken();
    const res = await this._deputyFetch(
      `/api/v1/resource/${resource}/QUERY`,
      accessToken,
      { method: 'POST', body: JSON.stringify(body) },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `DeputyAPI: ${resource} QUERY returned HTTP ${res.status} — ${text.slice(0, 200)}`,
      );
    }

    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Fetch and cache OperationalUnit records for role normalisation.
   * In-memory cache per connector instance (refreshed each sync run).
   * Falls back to empty map on non-200 (all roles → 'other').
   * @returns {Promise<Record<number, object>>} keyed by OperationalUnit Id
   */
  async _getOperationalUnits() {
    if (this._ouCache) return this._ouCache;

    const accessToken = await this._getAccessToken();
    let res;
    try {
      res = await this._deputyFetch('/api/v1/resource/OperationalUnit', accessToken, { method: 'GET' });
    } catch {
      this._ouCache = {};
      return this._ouCache;
    }

    if (!res.ok) {
      this._ouCache = {};
      return this._ouCache;
    }

    const rows = await res.json().catch(() => []);
    this._ouCache = {};
    if (Array.isArray(rows)) {
      for (const ou of rows) this._ouCache[ou.Id] = ou;
    }
    return this._ouCache;
  }
}
