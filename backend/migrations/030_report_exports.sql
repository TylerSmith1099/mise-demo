-- =============================================================================
-- Migration 030 — report_exports: export audit trail
--
-- CONTEXT (Reporting & Filtering, MIS-428 / Architecture MIS-426 §4.3)
-- ---------------------------------------------------------------------
-- The export layer (POST /api/admin/reports/export) embeds the resolved
-- filter parameters in every PDF/CSV artifact. This table records the act of
-- exporting itself — who pulled what data, when, and for what scope — making
-- the platform auditable on an outbound-data basis.
--
-- WHY BOTH (artifact embedding + DB row)?
-- • The embedded param block in the artifact documents the filter that produced
--   that specific file, traveling with the artifact if it is forwarded.
-- • The DB row makes the act of exporting auditable on-platform (who, when,
--   what metric, how many rows), independent of whether the file is retained.
--   This is relevant because exports move client data off the platform.
--
-- AUDIT TRAIL INTEGRITY
-- ---------------------
-- No DELETE grant. An audit trail that can be hard-deleted is not an audit
-- trail. Soft delete via deleted_at is the only removal path, and even that
-- should require explicit operator action with a recorded reason.
--
-- FILTER PARAMS AS JSONB
-- ----------------------
-- filter_params stores the fully server-resolved filter — metric, range,
-- comparison, scope_kind, venue set — as a JSONB snapshot. Not the raw
-- client request body; the post-resolveScope, post-clamp, post-alignment
-- resolved record. This means the audit row reflects what actually ran,
-- including any DM time-bound clamp, comparison alignment selection, etc.
--
-- ASYNC EXPORT SUPPORT
-- --------------------
-- status IN ('pending','completed','failed') supports the async path
-- (§4.4 MIS-426): a 202 response returns export_id; the client polls
-- GET /api/admin/reports/export/:id. For MVP, synchronous rendering
-- always writes status='completed' in the same request. The column is
-- in place so the async path requires no schema change later.
--
-- CLIENT ISOLATION
-- ----------------
-- client_id NOT NULL on every row. RLS enabled and forced. No DELETE grant.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- report_exports — one row per export action. Written by the export endpoint
-- after the file is generated (or enqueued for async generation).
CREATE TABLE report_exports (
    export_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID        NOT NULL REFERENCES clients (client_id),
    -- staff member who triggered the export (tier 2–4 only; DM cannot export)
    staff_id        UUID        NOT NULL,
    format          TEXT        NOT NULL CHECK (format IN ('pdf', 'csv')),
    -- Server-resolved filter: the exact parameters that drove this export.
    -- Includes metric, range (from/to), comparison (mode/alignment/range),
    -- scope (kind + venueCount), grain, and any DM clamp flags.
    filter_params   JSONB       NOT NULL,
    -- Scope summary (denormalised from filter_params for fast dashboarding)
    scope_kind      TEXT        NOT NULL,   -- 'venue' | 'cluster' | 'group'
    venue_count     INTEGER     NOT NULL,   -- number of venues in the resolved scope
    -- row_count: rows/data-points in the exported file; null until completed.
    row_count       INTEGER,
    status          TEXT        NOT NULL DEFAULT 'completed'
                        CHECK (status IN ('pending', 'completed', 'failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- completed_at: timestamp the file was delivered (or async render finished)
    completed_at    TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,

    FOREIGN KEY (client_id, staff_id) REFERENCES staff (client_id, staff_id)
);

-- Primary audit lookup: all exports by a staff member, chronological.
-- Also the index the async-status poll hits: client + staff + recency.
CREATE INDEX idx_report_exports_scope
    ON report_exports (client_id, staff_id, created_at DESC);

-- Secondary: pending exports that need async completion (sparse)
CREATE INDEX idx_report_exports_pending
    ON report_exports (client_id, status)
    WHERE status = 'pending';

ALTER TABLE report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_exports FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON report_exports
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- INSERT: export endpoint writes the audit row on file creation.
-- UPDATE: async path updates status + completed_at on render completion.
-- No DELETE: audit trail must not be erasable.
GRANT SELECT, INSERT, UPDATE ON report_exports TO mise_app;


-- ---------------------------------------------------------------------------
-- RLS TEST BLOCK
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    client_a UUID    := '99999999-9999-9999-9999-999999999999';
    client_b UUID    := 'cccccccc-cccc-4000-8000-cccccccccccc';
    venue_a  UUID    := '99999999-0000-0000-0000-000000000001';
    staff_a  UUID    := '99999999-0000-0000-0000-000000000002';
    cnt      INTEGER;
    sample_filter JSONB := '{"metric":"revenue","grain":"day","range":{"from":"2026-04-01","to":"2026-04-30"}}'::jsonb;
BEGIN
    -- Run AS mise_app: a superuser bypasses RLS (FORCE binds only the owner), so
    -- a superuser-connected runner would false-fail these cross-client reads.
    -- The runner is a member of mise_app (granted in 005). See 023 for rationale.
    SET LOCAL ROLE mise_app;

    -- Seed under client_a's context so WITH CHECK is satisfied (no owner bypass).
    PERFORM set_config('app.current_client_id', client_a::text, true);
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_a, '_rls_exports_test_a', '_rls_exports_test_a', 'active');
    INSERT INTO venues (venue_id, client_id, venue_name, state, timezone)
    VALUES (venue_a, client_a, '_rls_exports_venue', 'QLD', 'Australia/Brisbane');
    INSERT INTO staff (staff_id, client_id, venue_id, first_name, last_name,
                       email, role_tier, role_name, status)
    VALUES (staff_a, client_a, venue_a, '_Test', '_User',
            '_rls_exports@test.internal', 3, 'Area Manager', 'active');
    INSERT INTO report_exports
        (client_id, staff_id, format, filter_params, scope_kind, venue_count, status)
    VALUES
        (client_a, staff_a, 'csv', sample_filter, 'venue', 1, 'completed');

    PERFORM set_config('app.current_client_id', client_b::text, true);
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_b, '_rls_exports_test_b', '_rls_exports_test_b', 'active');

    -- Test 1: client_b cannot read client_a's export audit rows
    SELECT COUNT(*) INTO cnt FROM report_exports WHERE client_id = client_a;
    IF cnt <> 0 THEN
        RAISE EXCEPTION 'RLS FAIL mig030: client_b saw % report_exports rows for client_a', cnt;
    END IF;

    -- Test 2: client_b cannot write an export audit row for client_a
    BEGIN
        INSERT INTO report_exports
            (client_id, staff_id, format, filter_params, scope_kind, venue_count, status)
        VALUES
            (client_a, staff_a, 'pdf', sample_filter, 'venue', 1, 'completed');
        RAISE EXCEPTION 'RLS FAIL mig030: client_b wrote a report_exports row for client_a';
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
        NULL; -- expected: RLS WITH CHECK rejected it
    END;

    -- Cleanup as the migration runner (mise_app has no DELETE grant).
    RESET ROLE;
    PERFORM set_config('app.current_client_id', client_a::text, true);
    DELETE FROM report_exports WHERE client_id = client_a;
    DELETE FROM staff          WHERE client_id = client_a;
    DELETE FROM venues         WHERE client_id = client_a;
    DELETE FROM clients        WHERE client_id = client_a;
    PERFORM set_config('app.current_client_id', client_b::text, true);
    DELETE FROM clients        WHERE client_id = client_b;

    RAISE NOTICE 'Migration 030 RLS tests PASSED';
END
$$;


-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS report_exports;
