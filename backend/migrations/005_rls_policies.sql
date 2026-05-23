-- =============================================================================
-- Migration 005 — Row-Level Security: client isolation on every client-data table
--
-- ISOLATION MODEL
-- ---------------
-- Every client-data table is filtered by:
--     client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
--
-- The second argument `true` (missing_ok) means an UNSET variable yields NULL
-- rather than an error. NULL = no rows match -> the SECURE DEFAULT is "see
-- nothing", never "see everything". A connection that forgets to set the
-- variable leaks no data.
--
-- POOLING SAFETY (hard DB gate from architecture sign-off MIS-22):
-- The application MUST set the variable per-transaction with SET LOCAL so it
-- is scoped to the transaction and automatically cleared on COMMIT/ROLLBACK,
-- preventing context bleed across a shared/pooled connection:
--
--     BEGIN;
--       SET LOCAL app.current_client_id = '<uuid verified at auth>';
--       -- ... queries ...
--     COMMIT;
--
-- The value is set by the Auth Agent from a server-verified session, NEVER
-- from user input.
--
-- FORCE ROW LEVEL SECURITY is applied so that even the table owner is subject
-- to the policies; the app connects as the non-owner role `mise_app`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- Dedicated least-privilege application role. RLS does not constrain superusers
-- or table owners unless FORCE is set; mise_app is neither, giving defence in depth.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mise_app') THEN
        CREATE ROLE mise_app NOLOGIN;  -- grant LOGIN + password in environment-specific provisioning
    END IF;
    -- The app connects as the database owner and SET ROLE mise_app per txn for
    -- defence-in-depth RLS. Grant the connecting user membership so SET ROLE is
    -- permitted on managed Postgres (e.g. Render), where the connection user is
    -- not a superuser. Idempotent; harmless when current_user is a superuser.
    EXECUTE format('GRANT mise_app TO %I', current_user);
END
$$;

GRANT USAGE ON SCHEMA public TO mise_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO mise_app;
-- Intentionally NO DELETE grant: soft deletes only (set deleted_at / status).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE ON TABLES TO mise_app;

-- Helper applied to each table: enable + force RLS, then a single policy that
-- both restricts visible rows (USING) and forbids writing rows for any other
-- client (WITH CHECK).
-- clients ---------------------------------------------------------------------
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON clients
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- venues ----------------------------------------------------------------------
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON venues
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- staff -----------------------------------------------------------------------
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON staff
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- sessions --------------------------------------------------------------------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON sessions
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- conversations ---------------------------------------------------------------
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON conversations
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- messages --------------------------------------------------------------------
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON messages
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- compliance_events -----------------------------------------------------------
ALTER TABLE compliance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_events FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON compliance_events
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- certifications --------------------------------------------------------------
ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE certifications FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON certifications
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- shifts ----------------------------------------------------------------------
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON shifts
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- runsheet_items --------------------------------------------------------------
ALTER TABLE runsheet_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE runsheet_items FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON runsheet_items
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP POLICY IF EXISTS client_isolation ON runsheet_items;
-- DROP POLICY IF EXISTS client_isolation ON shifts;
-- DROP POLICY IF EXISTS client_isolation ON certifications;
-- DROP POLICY IF EXISTS client_isolation ON compliance_events;
-- DROP POLICY IF EXISTS client_isolation ON messages;
-- DROP POLICY IF EXISTS client_isolation ON conversations;
-- DROP POLICY IF EXISTS client_isolation ON sessions;
-- DROP POLICY IF EXISTS client_isolation ON staff;
-- DROP POLICY IF EXISTS client_isolation ON venues;
-- DROP POLICY IF EXISTS client_isolation ON clients;
-- ALTER TABLE runsheet_items    NO FORCE ROW LEVEL SECURITY; ALTER TABLE runsheet_items    DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE shifts            NO FORCE ROW LEVEL SECURITY; ALTER TABLE shifts            DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE certifications    NO FORCE ROW LEVEL SECURITY; ALTER TABLE certifications    DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE compliance_events NO FORCE ROW LEVEL SECURITY; ALTER TABLE compliance_events DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE messages          NO FORCE ROW LEVEL SECURITY; ALTER TABLE messages          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE conversations     NO FORCE ROW LEVEL SECURITY; ALTER TABLE conversations     DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE sessions          NO FORCE ROW LEVEL SECURITY; ALTER TABLE sessions          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE staff             NO FORCE ROW LEVEL SECURITY; ALTER TABLE staff             DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE venues            NO FORCE ROW LEVEL SECURITY; ALTER TABLE venues            DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE clients           NO FORCE ROW LEVEL SECURITY; ALTER TABLE clients           DISABLE ROW LEVEL SECURITY;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE ON TABLES FROM mise_app;
-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mise_app;
-- REVOKE USAGE ON SCHEMA public FROM mise_app;
-- DROP ROLE IF EXISTS mise_app;
