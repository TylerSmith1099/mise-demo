-- =============================================================================
-- Migration 029 — revenue_hourly: intraday revenue grain
--
-- CONTEXT (Reporting & Filtering, MIS-428 / Architecture MIS-426 §1.2)
-- ---------------------------------------------------------------------
-- The reporting filter system (MIS-426) requires an intraday curve for the
-- "hour" grain. The existing revenue_daily table stores one row per
-- (venue, trading date, POS source) and cannot reconstruct an hourly curve
-- after the fact. This table was deferred in MIS-409 §2.2(e) and is activated
-- here by the Reporting & Filtering feature.
--
-- RECONCILIATION INVARIANT (mandatory — do not break)
-- ---------------------------------------------------
-- SUM(revenue_hourly.net_revenue_cents) for a given (venue_id, business_date)
-- reconciles to revenue_daily.net_revenue_cents for the same (venue_id,
-- business_date) after the end-of-day Z-read pull. Until then, hourly rows
-- are provisional estimates (is_stale = true or not yet present).
--
-- The day grain ALWAYS reads revenue_daily, not a sum of hourly rows.
-- The hourly table is authoritative ONLY for the intraday curve view.
-- Deriving day totals by summing hourly in the request path is forbidden —
-- revenue_daily is the corrected, authoritative day aggregate.
--
-- UPSERT IDEMPOTENCY
-- ------------------
-- UNIQUE (client_id, venue_id, business_date, hour_local, source) enables
-- idempotent ON CONFLICT upserts from the 15-min sync pull. A stale row is
-- replaced in place (UPDATE), not accumulated.
--
-- KEY DESIGN DECISIONS
-- --------------------
-- • Money as integer cents (BIGINT), never float — same rule as revenue_daily.
-- • business_date is the venue-local trading date (§0.7 in MIS-426):
--   hour_local refers to the hour within that trading day (0–23), aligned
--   with the venue's day-rollover convention. A pub whose trading day starts
--   at 05:00 local time has hour_local=0 mapping to 05:00–05:59.
-- • Labour has NO hourly table for MVP. Labour cost % is a day-grain KPI;
--   intraday labour adds connector cost with no demo or product driver. (§1.2)
--
-- CLIENT ISOLATION
-- ----------------
-- client_id NOT NULL on every row. RLS enabled and forced with the canonical
-- policy expression from migration 005. mise_app has no DELETE grant.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- revenue_hourly — one row per (client, venue, trading date, hour, POS source).
-- Intraday rows are provisional; the definitive Z-read at end of day populates
-- revenue_daily, which remains the authoritative day-grain source.
CREATE TABLE revenue_hourly (
    hourly_id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id               UUID         NOT NULL REFERENCES clients (client_id),
    venue_id                UUID         NOT NULL,
    business_date           DATE         NOT NULL,
    -- hour_local: 0–23, relative to the venue-local trading day start (see §0.7 MIS-426)
    hour_local              SMALLINT     NOT NULL CHECK (hour_local BETWEEN 0 AND 23),
    gross_revenue_cents     BIGINT       NOT NULL DEFAULT 0,
    net_revenue_cents       BIGINT       NOT NULL DEFAULT 0,
    transaction_count       INTEGER      NOT NULL DEFAULT 0,
    source                  TEXT         NOT NULL
                                CHECK (source IN ('bepoz','hl','swiftpos','manual','seed')),
    -- is_stale: true when the 15-min pull failed and the row carries the last
    -- known values. Cleared when a fresh pull succeeds for this hour.
    is_stale                BOOLEAN      NOT NULL DEFAULT false,
    synced_at               TIMESTAMPTZ,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,

    FOREIGN KEY (client_id, venue_id) REFERENCES venues (client_id, venue_id),
    -- Idempotency key: one row per hour per source; ON CONFLICT UPDATE replaces.
    UNIQUE (client_id, venue_id, business_date, hour_local, source)
);

-- Primary lookup: scope-filtered hourly revenue for a date + hour range.
-- This is the index the reporting API hits for the intraday curve query.
CREATE INDEX idx_revenue_hourly_scope
    ON revenue_hourly (client_id, venue_id, business_date, hour_local);

-- Freshness sweep: find stale rows that need re-pull
CREATE INDEX idx_revenue_hourly_stale
    ON revenue_hourly (client_id, is_stale)
    WHERE is_stale = true;

ALTER TABLE revenue_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_hourly FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON revenue_hourly
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- No DELETE grant: hourly rows are upserted (ON CONFLICT UPDATE), never hard-deleted.
-- Soft delete via deleted_at follows the global soft-delete rule.
GRANT SELECT, INSERT, UPDATE ON revenue_hourly TO mise_app;


-- ---------------------------------------------------------------------------
-- RLS TEST BLOCK
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    client_a UUID    := '77777777-7777-7777-7777-777777777777';
    client_b UUID    := '88888888-8888-8888-8888-888888888888';
    venue_a  UUID    := '77777777-0000-0000-0000-000000000001';
    cnt      INTEGER;
BEGIN
    -- Run AS mise_app: a superuser bypasses RLS (FORCE binds only the owner), so
    -- a superuser-connected runner would false-fail these cross-client reads.
    -- The runner is a member of mise_app (granted in 005). See 023 for rationale.
    SET LOCAL ROLE mise_app;

    -- Seed under client_a's context so WITH CHECK is satisfied (no owner bypass).
    PERFORM set_config('app.current_client_id', client_a::text, true);
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_a, '_rls_hourly_test_a', '_rls_hourly_test_a', 'active');
    INSERT INTO venues (venue_id, client_id, venue_name, state, timezone)
    VALUES (venue_a, client_a, '_rls_hourly_venue', 'QLD', 'Australia/Brisbane');
    INSERT INTO revenue_hourly
        (client_id, venue_id, business_date, hour_local, gross_revenue_cents,
         net_revenue_cents, transaction_count, source)
    VALUES
        (client_a, venue_a, '2026-01-15', 12, 25000, 23500, 18, 'seed');

    PERFORM set_config('app.current_client_id', client_b::text, true);
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_b, '_rls_hourly_test_b', '_rls_hourly_test_b', 'active');

    -- Test 1: client_b cannot read client_a's hourly revenue rows
    SELECT COUNT(*) INTO cnt FROM revenue_hourly WHERE client_id = client_a;
    IF cnt <> 0 THEN
        RAISE EXCEPTION 'RLS FAIL mig029: client_b saw % revenue_hourly rows for client_a', cnt;
    END IF;

    -- Test 2: client_b cannot write a revenue_hourly row for client_a
    BEGIN
        INSERT INTO revenue_hourly
            (client_id, venue_id, business_date, hour_local, gross_revenue_cents,
             net_revenue_cents, transaction_count, source)
        VALUES
            (client_a, venue_a, '2026-01-15', 13, 12000, 11000, 8, 'seed');
        RAISE EXCEPTION 'RLS FAIL mig029: client_b wrote a revenue_hourly row for client_a';
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
        NULL; -- expected: RLS WITH CHECK rejected it
    END;

    -- Cleanup as the migration runner (mise_app has no DELETE grant).
    RESET ROLE;
    PERFORM set_config('app.current_client_id', client_a::text, true);
    DELETE FROM revenue_hourly WHERE client_id = client_a;
    DELETE FROM venues         WHERE client_id = client_a;
    DELETE FROM clients        WHERE client_id = client_a;
    PERFORM set_config('app.current_client_id', client_b::text, true);
    DELETE FROM clients        WHERE client_id = client_b;

    RAISE NOTICE 'Migration 029 RLS tests PASSED';
END
$$;


-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS revenue_hourly;
