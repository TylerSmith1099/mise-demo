// Role permission map and tier-boundary middleware.
//
// The ONLY source of the caller's role tier is req.auth.roleTier — populated by
// authenticate() from the verified JWT (see middleware.js). No path through this
// module reads a tier from request body, query params, or conversation context.
//
// Tier scale (full system; MVP activates 4, 5, 7):
//   1  Mise System / Super Admin      — internal only; never issued as a client login
//   2  Group Admin                    — desktop; whole client group (all venues)
//   3  Area Manager                   — desktop; a venue cluster
//   4  Venue Manager                  — desktop+MVP; single venue
//   5  Duty Manager                   — MVP
//   6  Supervisor                     — post-MVP
//   7  Gaming Attendant               — MVP
// Canonical names locked by MIS-415 (CTO+HoP, 2026-05-25).
//
// Resource permissions are expressed as a minimum tier CEILING: the resource is
// accessible to callers whose roleTier is IN the allowed set, not above/below a
// single threshold.  This prevents both upward escalation (a lower-numbered, more
// privileged tier bypassing a gate meant for attendants) and downward escalation
// (an attendant accessing manager-only data). Each resource lists its allowed
// MVP tiers explicitly.

export const MVP_ROLE_TIERS = Object.freeze([4, 5, 7]);

// Resource → allowed role tiers.  Add rows here as the app grows; the
// requireTier() factory and canAccess() read only from this map.
export const PERMISSION_MAP = Object.freeze({
  // All authenticated staff may identify themselves and log out.
  me:              Object.freeze([4, 5, 7]),
  logout:          Object.freeze([4, 5, 7]),

  // Chat / RAG — both product personas (Gaming Attendant + Duty Manager).
  chat:            Object.freeze([5, 7]),

  // Shift summary and handover notes — Duty Manager only.
  'shift-summary': Object.freeze([4, 5]),
  handover:        Object.freeze([4, 5]),

  // Compliance alerts — Duty Manager and Coordinator.
  compliance:      Object.freeze([4, 5]),

  // Staff directory — Coordinator / admin only.
  staff:           Object.freeze([4]),

  // Incident Reports — all MVP roles; tier 7 sees own incidents only (enforced in route).
  incidents:       Object.freeze([4, 5, 7]),

  // Revenue Intelligence — Duty Manager and Venue Manager (not floor staff).
  'revenue-intelligence': Object.freeze([4, 5]),

  // ---- Admin Desktop Homepage (MIS-412) — tiers 1-3 activated for desktop roles ----
  // Tier numbering: 1=Group Admin/Super Admin, 2=Area Manager/Regional, 3=General Manager
  // 4=Venue Coordinator, 5=Duty Manager. Tier 7 (Gaming Attendant) excluded from admin.
  'admin-homepage':  Object.freeze([1, 2, 3, 4, 5]),
  'admin-revenue':   Object.freeze([1, 2, 3, 4, 5]),
  'admin-labour':    Object.freeze([1, 2, 3, 4]),    // cost data not DM-facing by default
  'admin-incidents': Object.freeze([1, 2, 3, 4, 5]),
  'admin-stream':    Object.freeze([1, 2, 3, 4, 5]),

  // Reporting & Filtering (MIS-429 / MIS-426 §3.2):
  //   DM (tier 5) included but time-bounded to ≤7 days via resolveScope().maxLookbackDays.
  //   Export is manager+ only (tier 2–4): a DM cannot export data off-platform.
  //   Tier 7 (Gaming Attendant) has no reporting surface (MIS-426 §3.3).
  'admin-reports':        Object.freeze([2, 3, 4, 5]),
  'admin-reports-export': Object.freeze([2, 3, 4]),

  // Group roll-up view (MIS-478): estate-level view for group-scoped roles only.
  // Tier 1=Group Admin, 2=Area Manager, 3=General Manager. Venue Manager (4) and below
  // see single-venue; they do not access the estate overview.
  'admin-group-overview': Object.freeze([1, 2, 3]),
});

/**
 * Return true when `roleTier` is allowed to access `resource`.
 * Fails closed: unknown resources return false.
 */
export function canAccess(roleTier, resource) {
  const allowed = PERMISSION_MAP[resource];
  if (!allowed) return false;
  return allowed.includes(roleTier);
}

/**
 * Express middleware factory — gates a route to callers whose roleTier is in
 * `allowedTiers`. Must be mounted AFTER authenticate() so req.auth is populated.
 *
 * Usage:
 *   router.get('/shift-summary', requireTier([4, 5]), handler);
 */
export function requireTier(allowedTiers) {
  const allowed = Object.freeze([...allowedTiers]);
  return function tierGate(req, res, next) {
    // req.auth is set and frozen by authenticate(); no input path can set it.
    if (!req.auth || !allowed.includes(req.auth.roleTier)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

/**
 * Express middleware factory — gates a route by named resource key in
 * PERMISSION_MAP. Convenient when the resource name maps directly to a route.
 *
 * Usage:
 *   router.get('/staff', requireAccess('staff'), handler);
 */
export function requireAccess(resource) {
  const allowed = PERMISSION_MAP[resource];
  if (!allowed) {
    // Misconfigured at mount time; throw immediately so the bug surfaces at boot.
    throw new Error(`requireAccess: unknown resource "${resource}"`);
  }
  return requireTier(allowed);
}
