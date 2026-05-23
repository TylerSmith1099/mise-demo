/**
 * StubConnector — verifiable stub for integration testing.
 *
 * Demonstrates the full connector lifecycle:
 *   - register a connection
 *   - store credentials
 *   - run a scheduled sync
 *   - degrade safely on simulated vendor failure
 *
 * Not shipped in production; imported only in tests and local dev.
 */

import { ConnectorBase } from './connector-base.js';
import { makeRosteredShift, makeTimesheetEntry } from './signal-shape.js';
import { withClientContext } from '../db.js';
import { storeCredential } from './credential-store.js';

export class StubConnector extends ConnectorBase {
  /**
   * @param {object} opts
   * @param {string} opts.connectionId
   * @param {string} opts.clientId
   * @param {string} opts.venueId
   * @param {boolean} [opts.simulateFailure=false] — makes fetchRoster throw to test degradation
   */
  constructor(opts) {
    super({ vendor: 'stub', ...opts });
    this.simulateFailure = opts.simulateFailure || false;
  }

  async fetchRoster() {
    if (this.simulateFailure) {
      throw new Error('Stub vendor unreachable (simulated)');
    }
    // Return two minimal valid shifts
    const now = new Date();
    const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const end   = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    return [
      makeRosteredShift({
        id:              `stub:shift:001`,
        venueId:         this.venueId,
        externalStaffId: 'stub-staff-1',
        role:            'gaming_attendant',
        startUtc:        start,
        endUtc:          end,
        status:          'in_progress',
        source:          'stub',
      }),
      makeRosteredShift({
        id:              `stub:shift:002`,
        venueId:         this.venueId,
        externalStaffId: 'stub-staff-2',
        role:            'duty_manager',
        startUtc:        start,
        endUtc:          end,
        status:          'in_progress',
        source:          'stub',
      }),
    ];
  }

  async fetchTimesheets() {
    if (this.simulateFailure) {
      throw new Error('Stub vendor unreachable (simulated)');
    }
    return [
      makeTimesheetEntry({
        id:              'stub:ts:001',
        venueId:         this.venueId,
        externalStaffId: 'stub-staff-1',
        periodStartUtc:  new Date(Date.now() - 8 * 3600000).toISOString(),
        periodEndUtc:    new Date().toISOString(),
        hoursWorked:     8,
        payCategory:     'ordinary',
        source:          'stub',
      }),
    ];
  }
}

/**
 * Register a new integration_connection row for a client/vendor.
 * Idempotent — returns existing id if the (client_id, vendor) pair already exists.
 *
 * @param {{ clientId, vendor, displayName? }} opts
 * @returns {Promise<string>} connection id
 */
export async function registerConnection({ clientId, vendor, displayName = '' }) {
  return withClientContext(clientId, async (q) => {
    const existing = await q(
      `SELECT id FROM integration_connections
        WHERE client_id = $1 AND vendor = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [clientId, vendor]
    );
    if (existing.rows.length > 0) return existing.rows[0].id;

    const result = await q(
      `INSERT INTO integration_connections (client_id, vendor, display_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [clientId, vendor, displayName]
    );
    return result.rows[0].id;
  });
}

/**
 * Convenience: register a connection and store an API-key credential for it.
 * @param {{ clientId, vendor, displayName?, apiKey }} opts
 * @returns {Promise<{ connectionId: string, credentialId: string }>}
 */
export async function registerConnectionWithApiKey({ clientId, vendor, displayName, apiKey }) {
  const connectionId = await registerConnection({ clientId, vendor, displayName });
  const credentialId = await storeCredential({
    connectionId,
    clientId,
    credentialType: 'api_key',
    plaintext: apiKey,
  });
  return { connectionId, credentialId };
}
