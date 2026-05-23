-- =============================================================================
-- Migration 006 — Enforce role_at_login as INSERT-only (no UPDATE path)
--
-- CTO sign-off criterion 3: role_at_login must have no UPDATE path, enforced at
-- the DB level. A column-level GRANT alone is insufficient (owners/roles vary),
-- so we add a BEFORE UPDATE trigger that rejects any change to the column. The
-- value can only ever be written by the original INSERT.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

CREATE OR REPLACE FUNCTION reject_role_at_login_update()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role_at_login IS DISTINCT FROM OLD.role_at_login THEN
        RAISE EXCEPTION
            'role_at_login is immutable (INSERT-only); attempted change on session %',
            OLD.session_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sessions_role_at_login_immutable
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION reject_role_at_login_update();

-- Belt-and-braces: also revoke column-level UPDATE on role_at_login from the
-- app role so an UPDATE listing that column is rejected before the trigger runs.
REVOKE UPDATE (role_at_login) ON sessions FROM mise_app;

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TRIGGER IF EXISTS trg_sessions_role_at_login_immutable ON sessions;
-- DROP FUNCTION IF EXISTS reject_role_at_login_update();
-- -- (column UPDATE grant is restored by re-running the GRANT in migration 005)
