// JWT validation middleware — applied to EVERY API route (no "internal"
// exceptions). The only endpoints mounted outside it are the pre-auth ones that
// exist precisely to issue a token (login) or check liveness (health); they
// carry no token by definition.
//
// On every protected request this middleware:
//   1. Extracts the Bearer token; rejects (401) if missing.
//   2. Verifies signature + algorithm + issuer + audience + expiry; rejects on
//      any failure (tampered, wrong alg, expired, malformed).
//   3. Confirms the session is still live and within the inactivity window,
//      refreshing last_active_at — inside the token's client context.
//   4. Attaches the VERIFIED claims to req.auth. Downstream handlers read
//      identity/role/client ONLY from here, never from the request body.

import { verifyToken } from './jwt.js';
import { validateAndTouchSession, AuthError } from './auth-service.js';

function bearer(req) {
  const h = req.headers.authorization || '';
  const [scheme, value] = h.split(' ');
  if (scheme === 'Bearer' && value) return value.trim();
  // SSE fallback: EventSource cannot set headers, so the token is passed as
  // ?token= query param. Only used by /api/admin/stream; treated identically
  // to the Authorization header — same validation, same claims.
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  return null;
}

export function authenticate(config) {
  return async function authenticateMiddleware(req, res, next) {
    const token = bearer(req);
    if (!token) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    let claims;
    try {
      claims = verifyToken(config, token); // throws on tamper/expiry/bad alg
    } catch {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      await validateAndTouchSession(config, claims);
    } catch (err) {
      if (err instanceof AuthError) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      return next(err);
    }
    // Verified, server-derived identity. This is the ONLY trusted source.
    req.auth = Object.freeze({
      staffId: claims.staffId,
      clientId: claims.clientId,
      venueId: claims.venueId,
      roleAtLogin: claims.roleAtLogin,
      roleTier: claims.roleTier,
      sessionId: claims.sessionId,
    });
    next();
  };
}
