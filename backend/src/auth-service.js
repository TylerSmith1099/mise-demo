// Login, session lifecycle, and the failed-login audit. This is where the
// security-critical rules live:
//   * role_at_login is taken from the AUTHENTICATED staff record, never from
//     the request — a client-supplied role is ignored entirely.
//   * one active session per staff_id: a new login ends the prior one
//     (writes ended_at) before inserting the new session.
//   * sessions are never deleted — ended_at is the audit trail.
//   * failed logins are recorded with a real reason, but the caller only ever
//     sees a single generic error that does not reveal whether the id exists.

import { withClientContext, withSystemContext } from './db.js';
import { verifyPassword } from './passwords.js';
import { issueToken } from './jwt.js';

// A throwaway hash so a "no such staff" path still spends ~the same time doing a
// scrypt verify, blunting username-enumeration via timing.
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  Buffer.alloc(64).toString('base64');

export class AuthError extends Error {
  constructor(reason) {
    super('Invalid credentials'); // generic message — safe to surface
    this.reason = reason; // machine code — audit only, never returned
    this.status = 401;
  }
}

async function recordFailedLogin(reason, attempt) {
  // Best-effort: an audit-write failure must not change the caller-visible result.
  try {
    await withSystemContext((q) =>
      q(
        `INSERT INTO failed_logins
           (staff_id_attempted, client_id_attempted, email_attempted, reason, source_ip)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          attempt.staffId || null,
          attempt.clientId || null,
          attempt.email || null,
          reason,
          attempt.sourceIp || null,
        ],
      ),
    );
  } catch {
    /* swallow: never let audit failure leak or break login */
  }
}

/**
 * Authenticate a staff member and open a session.
 * `clientId` here is the CLAIMED client being authenticated against — the one
 * place a client_id legitimately originates from input. Once the session token
 * is issued, the token's client_id is the only authoritative source.
 *
 * @returns {{ token, session, staff }}
 * @throws {AuthError} generic on any failure (real reason is audited)
 */
export async function login(config, input) {
  const { clientId, venueId, email, password, sourceIp } = input;
  const attempt = { clientId, venueId, email, sourceIp };

  if (!clientId || !venueId || !email || !password) {
    await recordFailedLogin('missing_fields', attempt);
    throw new AuthError('missing_fields');
  }

  // Look up within the claimed client's RLS scope.
  const staff = await withClientContext(clientId, async (q) => {
    const { rows } = await q(
      `SELECT staff_id, venue_id, role_name, role_tier, status, password_hash
         FROM staff
        WHERE email = $1 AND deleted_at IS NULL`,
      [email],
    );
    return rows[0] || null;
  });

  // Always run a verify (real or dummy) so timing doesn't reveal existence.
  const passwordOk = await verifyPassword(
    password,
    staff ? staff.password_hash : DUMMY_HASH,
  );

  if (!staff) {
    await recordFailedLogin('no_such_staff', attempt);
    throw new AuthError('no_such_staff');
  }
  if (staff.status !== 'active') {
    await recordFailedLogin('inactive', { ...attempt, staffId: staff.staff_id });
    throw new AuthError('inactive');
  }
  if (staff.venue_id !== venueId) {
    await recordFailedLogin('venue_mismatch', { ...attempt, staffId: staff.staff_id });
    throw new AuthError('venue_mismatch');
  }
  if (!passwordOk) {
    await recordFailedLogin('bad_password', { ...attempt, staffId: staff.staff_id });
    throw new AuthError('bad_password');
  }
  // MVP enforces tiers 4, 5, 7 only.
  if (!config.mvpRoleTiers.includes(staff.role_tier)) {
    await recordFailedLogin('tier_not_in_mvp', { ...attempt, staffId: staff.staff_id });
    throw new AuthError('tier_not_in_mvp');
  }

  // One active session per staff_id: end any prior open session, then open new.
  // role_at_login is written from the staff record — NOT from any input.
  const session = await withClientContext(clientId, async (q) => {
    await q(
      `UPDATE sessions SET ended_at = now()
        WHERE staff_id = $1 AND ended_at IS NULL`,
      [staff.staff_id],
    );
    const { rows } = await q(
      `INSERT INTO sessions (client_id, venue_id, staff_id, role_at_login)
       VALUES ($1, $2, $3, $4)
       RETURNING session_id, started_at`,
      [clientId, venueId, staff.staff_id, staff.role_name],
    );
    return rows[0];
  });

  const token = issueToken(config, {
    staffId: staff.staff_id,
    clientId,
    venueId,
    roleAtLogin: staff.role_name, // immutable snapshot from the staff record
    roleTier: staff.role_tier,
    sessionId: session.session_id,
  });

  return {
    token,
    session: { sessionId: session.session_id, startedAt: session.started_at },
    staff: {
      staffId: staff.staff_id,
      roleName: staff.role_name,
      roleTier: staff.role_tier,
    },
  };
}

// Reasons a live token may still be rejected at request time.
export const SESSION_INVALID = 'session_invalid'; // ended / unknown / newer login won
export const SESSION_TIMEOUT = 'session_timeout'; // inactivity exceeded

/**
 * Validate the session behind a verified token and refresh activity. Runs inside
 * the token's client context (proving app.current_client_id comes from the token).
 * Ends the session on inactivity timeout. Returns nothing on success; throws
 * AuthError on any rejection.
 */
export async function validateAndTouchSession(config, claims) {
  const reason = await withClientContext(claims.clientId, async (q) => {
    const { rows } = await q(
      `SELECT ended_at, last_active_at
         FROM sessions
        WHERE session_id = $1 AND staff_id = $2`,
      [claims.sessionId, claims.staffId],
    );
    const row = rows[0];
    if (!row || row.ended_at !== null) return SESSION_INVALID;

    const idleSeconds = (Date.now() - new Date(row.last_active_at).getTime()) / 1000;
    if (idleSeconds > config.session.inactivityTimeoutSeconds) {
      await q(`UPDATE sessions SET ended_at = now() WHERE session_id = $1`, [
        claims.sessionId,
      ]);
      return SESSION_TIMEOUT;
    }

    await q(`UPDATE sessions SET last_active_at = now() WHERE session_id = $1`, [
      claims.sessionId,
    ]);
    return null;
  });

  if (reason) throw new AuthError(reason);
}

/** End a session explicitly (logout). Idempotent; never deletes the row. */
export async function logout(claims) {
  await withClientContext(claims.clientId, (q) =>
    q(
      `UPDATE sessions SET ended_at = now()
        WHERE session_id = $1 AND ended_at IS NULL`,
      [claims.sessionId],
    ),
  );
}
