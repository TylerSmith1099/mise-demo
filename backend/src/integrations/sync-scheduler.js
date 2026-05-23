/**
 * Integration sync scheduler.
 *
 * Drives periodic syncs for all active integration_connections.
 * Each connector's runSync() is called with an idempotency key derived from
 * {vendor}:{client_id}:{UTC-date-hour} so re-running within the same hour is a no-op.
 *
 * Backoff: on consecutive failures the interval doubles up to MAX_BACKOFF_MS.
 * The scheduler does NOT retry within the same run — backoff is applied by
 * lengthening the next scheduled interval.
 *
 * Usage (in server startup):
 *   const scheduler = new SyncScheduler({ connectorRegistry, intervalMs: 15 * 60 * 1000 });
 *   scheduler.start();
 *   // on shutdown:
 *   scheduler.stop();
 */

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_BACKOFF_MS       = 4 * 60 * 60 * 1000; // 4 hours

export class SyncScheduler {
  /**
   * @param {object} opts
   * @param {Map<string, import('./connector-base.js').ConnectorBase>} opts.connectors
   *   Map keyed by connectionId. Callers populate this before calling start().
   * @param {number} [opts.intervalMs]
   * @param {Function} [opts.logger] — defaults to console.error (success not logged to avoid noise)
   */
  constructor({ connectors, intervalMs = DEFAULT_INTERVAL_MS, logger = console.error }) {
    this.connectors  = connectors;
    this.intervalMs  = intervalMs;
    this.logger      = logger;
    this._timer      = null;
    this._failures   = new Map(); // connectionId -> consecutive failure count
  }

  start() {
    if (this._timer) return; // already running
    this._scheduleNext(this.intervalMs);
  }

  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _scheduleNext(delayMs) {
    this._timer = setTimeout(() => this._runAll(), delayMs);
  }

  async _runAll() {
    this._timer = null;
    const now = new Date();
    const hourTag = `${now.toISOString().slice(0, 13)}`; // "2026-05-23T14"

    for (const [connectionId, connector] of this.connectors) {
      const key = `${connector.vendor}:${connector.clientId}:${hourTag}`;
      try {
        const result = await connector.runSync({ idempotencyKey: key });
        if (result.isStale) {
          this.logger(`[sync] ${connectionId} degraded — ${result.staleReason}`);
          this._failures.set(connectionId, (this._failures.get(connectionId) || 0) + 1);
        } else {
          this._failures.set(connectionId, 0);
        }
      } catch (err) {
        this.logger(`[sync] ${connectionId} unhandled error — ${err.message}`);
        this._failures.set(connectionId, (this._failures.get(connectionId) || 0) + 1);
      }
    }

    // Compute next interval applying backoff for any connection with failures.
    // Simple global backoff: use the max failure count across all connectors.
    const maxFailures = Math.max(0, ...[...this._failures.values()]);
    const backoff = Math.min(
      this.intervalMs * Math.pow(2, maxFailures),
      MAX_BACKOFF_MS
    );
    this._scheduleNext(backoff);
  }
}
