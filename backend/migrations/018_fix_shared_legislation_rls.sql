-- Allow the system ingestion path (withSystemContext, no app.current_client_id)
-- to write shared legislation rows (client_id IS NULL) into document_chunks.
--
-- The original WITH CHECK in migration 008 was:
--   client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
-- This blocks ALL client_id IS NULL inserts, including the ingestion pipeline
-- that runs under withSystemContext (no app.current_client_id set). The
-- FORCE ROW LEVEL SECURITY on the table means even the table owner is blocked.
--
-- Fix: also allow client_id IS NULL writes when app.current_client_id is not
-- set (i.e., system context). The mise_app tenant role always has
-- app.current_client_id set via withClientContext, so tenants still cannot
-- inject shared rows.
DROP POLICY IF EXISTS client_isolation ON document_chunks;

CREATE POLICY client_isolation ON document_chunks
    USING (
        client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
        OR client_id IS NULL
    )
    WITH CHECK (
        -- Client SOP / licence_condition: caller may only write their own chunks.
        client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
        OR
        -- Shared legislation (client_id IS NULL): allowed only from system context
        -- (no app.current_client_id set). mise_app always has it set, so tenants
        -- cannot inject shared rows.
        (client_id IS NULL
         AND NULLIF(current_setting('app.current_client_id', true), '') IS NULL)
    );
