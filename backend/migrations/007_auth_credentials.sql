-- =============================================================================
-- Migration 007 — Auth layer: staff credentials + failed-login audit
-- Owned by the Auth Agent (MIS-28). Builds on the Database stage (001–006).
--
-- Two additions the identity schema deliberately left to the auth layer:
--   1. staff.password_hash — the verifiable credential. Nullable so existing
--      rows stay valid; login REQUIRES it (a NULL hash can never match).
--      Format is self-describing: 'scrypt$N$r$p$<salt_b64>$<hash_b64>'.
--   2. failed_logins — a SYSTEM security-audit table (not tenant content).
--      It records every rejected attempt for brute-force / ops review and is
--      therefore intentionally NOT under client RLS: cross-tenant attack
--      detection needs a global view, and rows are written on the pre-auth
--      path before any client context exists. It stores only the *attempted*
--      identifiers (which may not correspond to a real staff/client) plus a
--      machine reason. The API response NEVER echoes this reason — callers
--      always get a single generic "Invalid credentials".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

ALTER TABLE staff ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE TABLE IF NOT EXISTS failed_logins (
    attempt_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id_attempted  UUID,          -- raw supplied value; may not exist
    client_id_attempted UUID,          -- raw supplied value; may not exist
    email_attempted     TEXT,          -- raw supplied value; may not exist
    reason              TEXT NOT NULL, -- machine code; never returned to caller
    source_ip           TEXT,
    attempted_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_failed_logins_time  ON failed_logins (attempted_at);
CREATE INDEX IF NOT EXISTS idx_failed_logins_staff ON failed_logins (staff_id_attempted);

-- The audit table is written on the privileged pre-auth path (db.withSystemContext,
-- which does NOT switch to mise_app) and reviewed by security ops via a privileged
-- role. The tenant app role mise_app deliberately gets NO grant: failed_logins has
-- no client RLS (system-wide security log, see header), so any SELECT grant to a
-- tenant-scoped role would expose every client's attempted emails/IPs/ids across
-- the tenant boundary — and no mise_app code path reads or writes this table.
-- (Database Agent ratification, MIS-52: removed the prior INSERT,SELECT grant to
-- mise_app, which contradicted this header and breached least-privilege.)

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- (no mise_app grant to revoke — see UP)
-- DROP TABLE IF EXISTS failed_logins;
-- ALTER TABLE staff DROP COLUMN IF EXISTS password_hash;
