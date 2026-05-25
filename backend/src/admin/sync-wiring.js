/**
 * Admin homepage sync scheduler wiring.
 *
 * Starts two scheduled sync loops after the DB is initialised:
 *   - Revenue: every 15 min during trading hours (BEPOZ / H&L / SwiftPOS)
 *   - Labour:  every 60 min (Humanforce timesheets)
 *
 * Connectors are instantiated from active integration_connections rows.
 * No vendor is ever called in the request path — only from these schedulers.
 *
 * Architecture ref: Admin-Homepage-Architecture-V1.md §3.3
 */

import pg from 'pg';
import { SyncScheduler } from '../integrations/sync-scheduler.js';
import { BepozConnector } from '../integrations/bepoz-connector.js';
import { HlConnector } from '../integrations/hl-connector.js';
import { HumanforceLabourConnector } from '../integrations/humanforce-labour-connector.js';

const REVENUE_INTERVAL_MS = 15 * 60 * 1000;  // 15 minutes
const LABOUR_INTERVAL_MS  = 60 * 60 * 1000;  // 60 minutes

let revenueScheduler = null;
let labourScheduler  = null;

/**
 * Build connector maps from active integration_connections rows.
 * Runs once at startup; connectors are long-lived for the process lifetime.
 */
async function buildConnectorMaps(config) {
  // Use a direct pool connection outside of RLS — we're reading all client
  // connections as the app role for scheduler bootstrapping.
  const pool = new pg.Pool({ connectionString: config.db.connectionString });
  let rows;
  try {
    // integration_connections is client-scoped — no venue_id column (per migration 015).
    const result = await pool.query(
      `SELECT id, client_id, vendor, status
         FROM integration_connections
        WHERE status = 'active'
          AND deleted_at IS NULL
          AND vendor IN ('bepoz', 'hl', 'swiftpos', 'humanforce')
        ORDER BY vendor, client_id`,
    );
    rows = result.rows;
  } finally {
    await pool.end();
  }

  const revenueConnectors = new Map();
  const labourConnectors  = new Map();

  for (const row of rows) {
    const base = {
      connectionId: row.id,
      clientId:     row.client_id,
    };

    if (row.vendor === 'bepoz') {
      revenueConnectors.set(row.id, new BepozConnector(base));
    } else if (row.vendor === 'hl') {
      revenueConnectors.set(row.id, new HlConnector(base));
    } else if (row.vendor === 'humanforce') {
      labourConnectors.set(row.id, new HumanforceLabourConnector(base));
    }
    // swiftpos: reserved for P2; skip until connector is implemented.
  }

  return { revenueConnectors, labourConnectors };
}

/**
 * Start revenue and labour sync schedulers.
 * Call once after initDb() in server.js.
 * @param {object} config — app config from loadConfig()
 */
export async function startAdminSyncSchedulers(config) {
  let revenueConnectors;
  let labourConnectors;

  try {
    ({ revenueConnectors, labourConnectors } = await buildConnectorMaps(config));
  } catch (err) {
    // If the new tables don't exist yet (migrations pending from MIS-411),
    // log and skip — the server still starts; sync begins once migrations land.
    if (err.code === '42P01') {
      console.warn('[admin-sync] integration_connections table not found — skipping sync scheduler start (migrations pending)');
      return;
    }
    console.error('[admin-sync] failed to build connector maps:', err.message);
    return;
  }

  if (revenueConnectors.size > 0) {
    revenueScheduler = new SyncScheduler({
      connectors:  revenueConnectors,
      intervalMs:  REVENUE_INTERVAL_MS,
      logger:      (msg) => console.error('[revenue-sync]', msg),
    });
    revenueScheduler.start();
    console.log(`[admin-sync] revenue scheduler started (${revenueConnectors.size} connectors, 15 min interval)`);
  }

  if (labourConnectors.size > 0) {
    labourScheduler = new SyncScheduler({
      connectors:  labourConnectors,
      intervalMs:  LABOUR_INTERVAL_MS,
      logger:      (msg) => console.error('[labour-sync]', msg),
    });
    labourScheduler.start();
    console.log(`[admin-sync] labour scheduler started (${labourConnectors.size} connectors, 60 min interval)`);
  }
}

/** Stop both schedulers on graceful shutdown. */
export function stopAdminSyncSchedulers() {
  revenueScheduler?.stop();
  labourScheduler?.stop();
}
