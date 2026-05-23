// JWT issuance and validation. The payload is fixed by the spec:
//   sub (=staff_id), client_id, venue_id, role_at_login, role_tier,
//   session_id, iat, exp.
// Algorithm and keys come from validated config (RS256 preferred, HS256 min).
// `verifyToken` pins the allowed algorithm so a token cannot be downgraded
// (e.g. "alg":"none" or HS-with-public-key confusion).

import jwt from 'jsonwebtoken';

export function issueToken(config, claims) {
  const { staffId, clientId, venueId, roleAtLogin, roleTier, sessionId } = claims;
  const payload = {
    client_id: clientId,
    venue_id: venueId,
    role_at_login: roleAtLogin,
    role_tier: roleTier,
    session_id: sessionId,
  };
  return jwt.sign(payload, config.jwt.signingKey, {
    algorithm: config.jwt.algorithm,
    subject: staffId, // -> sub
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    expiresIn: config.jwt.expirySeconds, // sets exp; iat set automatically
  });
}

/**
 * Verify signature, algorithm, issuer, audience and expiry. Returns the decoded
 * claims, or throws. The caller treats these as the ONLY source of identity —
 * never the request body.
 */
export function verifyToken(config, token) {
  const decoded = jwt.verify(token, config.jwt.verifyingKey, {
    algorithms: [config.jwt.algorithm], // pin: reject any other alg, incl. "none"
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  return {
    staffId: decoded.sub,
    clientId: decoded.client_id,
    venueId: decoded.venue_id,
    roleAtLogin: decoded.role_at_login,
    roleTier: decoded.role_tier,
    sessionId: decoded.session_id,
    iat: decoded.iat,
    exp: decoded.exp,
  };
}
