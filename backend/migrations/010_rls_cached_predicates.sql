-- =============================================================================
-- Migration 010 — RLS predicate caching: wrap current_setting() in (SELECT ...)
--
-- WHY
-- ---
-- Migrations 005/008 express the tenant predicate as a bare function call:
--     client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
-- current_setting() is STABLE, so the planner is free to re-evaluate it for
-- EVERY candidate row. On wide scans (e.g. messages, document_chunks) that is
-- thousands of redundant calls per statement.
--
-- Wrapping the lookup in a scalar sub-SELECT:
--     client_id = (SELECT NULLIF(current_setting('app.current_client_id', true), '')::uuid)
-- forces the planner to evaluate it ONCE as an InitPlan and reuse the constant
-- for the whole statement. Identical semantics, evaluated once per statement
-- instead of once per row (perf + predictable behaviour under high load).
--
-- This recreates the `client_isolation` policy on all 13 client-data tables
-- (10 from 005, 3 from 009, plus document_chunks from 008).
-- ENABLE/FORCE state and grants are untouched. No behavioural change to which
-- rows are visible — only how often the setting is read.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- Tables from migration 005 (plain tenant predicate).
DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'clients','venues','staff','sessions','conversations','messages',
        'compliance_events','certifications','shifts','runsheet_items',
        'egm_machines','handover_notes','pnl_summary'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS client_isolation ON %I', t);
        EXECUTE format($f$
            CREATE POLICY client_isolation ON %I
                USING      (client_id = (SELECT NULLIF(current_setting('app.current_client_id', true), '')::uuid))
                WITH CHECK (client_id = (SELECT NULLIF(current_setting('app.current_client_id', true), '')::uuid))
        $f$, t);
    END LOOP;
END
$$;

-- document_chunks from migration 008 (NULL = shared legislation, visible to all).
DROP POLICY IF EXISTS client_isolation ON document_chunks;
CREATE POLICY client_isolation ON document_chunks
    USING (
        client_id = (SELECT NULLIF(current_setting('app.current_client_id', true), '')::uuid)
        OR client_id IS NULL
    )
    WITH CHECK (
        client_id = (SELECT NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    );

-- ---------------------------------------------------------------------------
-- DOWN (rollback) — restore the un-wrapped predicates from migrations 005/008.
-- ---------------------------------------------------------------------------
-- DO $$
-- DECLARE
--     t text;
--     tables text[] := ARRAY[
--         'clients','venues','staff','sessions','conversations','messages',
--         'compliance_events','certifications','shifts','runsheet_items'
--     ];
-- BEGIN
--     FOREACH t IN ARRAY tables LOOP
--         EXECUTE format('DROP POLICY IF EXISTS client_isolation ON %I', t);
--         EXECUTE format($f$
--             CREATE POLICY client_isolation ON %I
--                 USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
--                 WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
--         $f$, t);
--     END LOOP;
-- END
-- $$;
-- DROP POLICY IF EXISTS client_isolation ON document_chunks;
-- CREATE POLICY client_isolation ON document_chunks
--     USING (
--         client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
--         OR client_id IS NULL
--     )
--     WITH CHECK (
--         client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
--     );
