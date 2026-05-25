-- =============================================================================
-- Migration 020 — RLS: client isolation on incident report tables
--
-- Extends the isolation model established in migration 005.
-- Pattern: NULLIF(current_setting('app.current_client_id', true), '')::uuid
-- Missing variable → NULL → no rows visible (secure default).
-- FORCE ROW LEVEL SECURITY ensures even the table owner is constrained.
--
-- Application requirement (same as 005): set app.current_client_id per-transaction
-- via SET LOCAL within a BEGIN/COMMIT block, sourced from Auth Agent session only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

GRANT SELECT, INSERT, UPDATE
    ON incident_reports, incident_reporting_obligations, incident_notifications
    TO mise_app;

-- incident_reports ------------------------------------------------------------
ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_reports FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON incident_reports
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- incident_reporting_obligations ----------------------------------------------
ALTER TABLE incident_reporting_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_reporting_obligations FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON incident_reporting_obligations
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- incident_notifications ------------------------------------------------------
ALTER TABLE incident_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_notifications FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON incident_notifications
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP POLICY IF EXISTS client_isolation ON incident_notifications;
-- DROP POLICY IF EXISTS client_isolation ON incident_reporting_obligations;
-- DROP POLICY IF EXISTS client_isolation ON incident_reports;
-- ALTER TABLE incident_notifications         NO FORCE ROW LEVEL SECURITY; ALTER TABLE incident_notifications         DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE incident_reporting_obligations NO FORCE ROW LEVEL SECURITY; ALTER TABLE incident_reporting_obligations DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE incident_reports               NO FORCE ROW LEVEL SECURITY; ALTER TABLE incident_reports               DISABLE ROW LEVEL SECURITY;
-- REVOKE SELECT, INSERT, UPDATE ON incident_reports, incident_reporting_obligations, incident_notifications FROM mise_app;
