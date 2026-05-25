/**
 * Role-scope resolution for the admin desktop homepage.
 *
 * Two independent security gates protect every admin endpoint:
 *
 *   Gate 1 — Client isolation (RLS): automatic via withClientContext. Every
 *   query runs inside a transaction with SET LOCAL app.current_client_id from
 *   the verified JWT. Cross-client rows are structurally invisible.
 *
 *   Gate 2 — Intra-client scope (this module): RLS gets you to "this client's
 *   data." It does not distinguish a DM's one venue from a Group Admin's whole
 *   group. resolveScope() narrows to the caller's authorised venue set. Every
 *   homepage section query then appends AND venue_id = ANY($scopeVenueIds).
 *
 * Single-venue roles (tiers 4/5/7) return [auth.venueId] from the JWT directly.
 * Multi-venue desktop roles (tiers 1-3) read staff_venue_assignments and expand
 * cluster / group scopes. Resolution reads only JWT claims + RLS-protected tables;
 * it can never widen beyond the caller's client_id.
 *
 * Architecture ref: Admin-Homepage-Architecture-V1.md §5.1
 */

import { withClientContext } from '../db.js';

const SINGLE_VENUE_TIERS = new Set([4, 5, 7]);

/**
 * Resolve the caller's authorised venue set from their JWT claims.
 * @param {{ staffId: string, clientId: string, venueId: string|null, roleTier: number }} auth
 * @returns {Promise<{ venueIds: string[] }>}
 */
export async function resolveScope(auth) {
  // Single-venue mobile roles: scope comes directly from the JWT.
  if (SINGLE_VENUE_TIERS.has(auth.roleTier)) {
    if (!auth.venueId) throw new Error('resolveScope: venueId required for tier ' + auth.roleTier);
    return { venueIds: [auth.venueId] };
  }

  // Desktop multi-venue roles (tiers 1-3): expand via staff_venue_assignments.
  const rows = await withClientContext(auth.clientId, (q) =>
    q(
      `SELECT scope_type, venue_id, cluster_id
         FROM staff_venue_assignments
        WHERE staff_id = $1
          AND client_id = $2
          AND deleted_at IS NULL`,
      [auth.staffId, auth.clientId],
    ).then((r) => r.rows),
  );

  const venueIdSet = new Set();

  for (const row of rows) {
    if (row.scope_type === 'venue' && row.venue_id) {
      venueIdSet.add(row.venue_id);
    } else if (row.scope_type === 'cluster' && row.cluster_id) {
      // Expand cluster → member venues.
      const members = await withClientContext(auth.clientId, (q) =>
        q(
          `SELECT venue_id
             FROM venue_cluster_members
            WHERE client_id = $1
              AND cluster_id = $2`,
          [auth.clientId, row.cluster_id],
        ).then((r) => r.rows),
      );
      for (const m of members) venueIdSet.add(m.venue_id);
    } else if (row.scope_type === 'group') {
      // Group scope: all venues under the client.
      const venues = await withClientContext(auth.clientId, (q) =>
        q(
          `SELECT venue_id FROM venues WHERE client_id = $1 AND deleted_at IS NULL`,
          [auth.clientId],
        ).then((r) => r.rows),
      );
      for (const v of venues) venueIdSet.add(v.venue_id);
    }
  }

  return { venueIds: [...venueIdSet] };
}

/**
 * Express middleware that attaches req.scope = { venueIds } to the request.
 * Must be mounted after authenticate() so req.auth is populated.
 *
 * If a caller names a venueId in a query param it must be within their scope —
 * call assertVenueInScope(req.scope, venueId) in the route handler.
 */
export function attachScope(req, res, next) {
  resolveScope(req.auth)
    .then((scope) => {
      req.scope = scope;
      next();
    })
    .catch(next);
}

/**
 * Validate that a caller-supplied venueId is within their resolved scope.
 * Returns 403 (explicit denial) rather than empty, per §5.1.
 * @param {{ venueIds: string[] }} scope
 * @param {string} venueId
 * @returns {boolean}
 */
export function isVenueInScope(scope, venueId) {
  return scope.venueIds.includes(venueId);
}
