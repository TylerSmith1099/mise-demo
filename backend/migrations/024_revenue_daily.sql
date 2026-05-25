-- =============================================================================
-- Migration 024 — Revenue Daily: POS revenue actuals, forecast, and variance
--
-- CONTEXT (Admin Homepage, MIS-411 / Architecture MIS-409)
-- ---------------------------------------------------------
-- Powers the revenue section of the admin homepage. Revenue is pulled from POS
-- connectors (BEPOZ, H&L, SwiftPOS) and normalised into this table via the
-- integration framework (mig 015). The homepage API reads ONLY from this table;
-- no vendor call is ever made in the request path.
--
-- KEY DESIGN DECISIONS
-- --------------------
-- • Money is stored as integer cents (BIGINT), never floating point. All display
--   formatting is an app-layer concern.
-- • business_date is the venue-local trading date (not UTC midnight). The
--   normalisation layer assigns it using venues.timezone and the venue's
--   day-rollover convention (default 05:00 venue-local). This keeps the
--   revenue↔labour join correct across pub trading hours that span midnight.
--   (BASE_DATE drift incident MIS-78: same trap class — avoid UTC midnight.)
-- • variance_cents is a GENERATED ALWAYS AS column so it never goes stale
--   independently of the columns it depends on.
-- • UNIQUE (client_id, venue_id, business_date, source) enables idempotent
--   ON CONFLICT upserts from the sync job.
-- • is_stale / synced_at drive the "data freshness" badge on the homepage.
--   Stale = last-known, never fabricated (ConnectorBase rule, mig 015).
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

-- revenue_daily — one row per (client, venue, trading date, POS source).
-- Intraday rows are provisional; the definitive Z-read reconciliation replaces
-- them on the same (venue_id, business_date, source) key at end of day.
CREATE TABLE revenue_daily (
    revenue_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id               UUID        NOT NULL REFERENCES clients (client_id),
    venue_id                UUID        NOT NULL,
    business_date           DATE        NOT NULL,
    gross_revenue_cents     BIGINT      NOT NULL DEFAULT 0,
    net_revenue_cents       BIGINT      NOT NULL DEFAULT 0,
    transaction_count       INTEGER     NOT NULL DEFAULT 0,
    forecast_revenue_cents  BIGINT,     -- nullable; populated by forecast job
    -- variance is always net_revenue minus forecast; GENERATED so it can never drift
    variance_cents          BIGINT      GENERATED ALWAYS AS (
                                net_revenue_cents - COALESCE(forecast_revenue_cents, 0)
                            ) STORED,
    source                  TEXT        NOT NULL
                                CHECK (source IN ('bepoz','hl','swiftpos','manual','seed')),
    is_stale                BOOLEAN     NOT NULL DEFAULT false,
    synced_at               TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,

    FOREIGN KEY (client_id, venue_id) REFERENCES venues (client_id, venue_id),
    -- Idempotency key for ON CONFLICT upserts from the sync connector
    UNIQUE (client_id, venue_id, business_date, source)
);

-- Primary lookup: scope-filtered daily revenue for a date range (homepage aggregate)
CREATE INDEX idx_revenue_daily_scope ON revenue_daily (client_id, venue_id, business_date);
-- Freshness sweep: find stale rows per client
CREATE INDEX idx_revenue_daily_stale ON revenue_daily (client_id, is_stale) WHERE is_stale = true;

ALTER TABLE revenue_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_daily FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON revenue_daily
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON revenue_daily TO mise_app;


-- ---------------------------------------------------------------------------
-- RLS TEST BLOCK
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    client_a UUID    := '33333333-3333-3333-3333-333333333333';
    client_b UUID    := '44444444-4444-4444-4444-444444444444';
    venue_a  UUID    := '33333333-0000-0000-0000-000000000001';
    cnt      INTEGER;
BEGIN
    -- Run AS mise_app: a superuser bypasses RLS (FORCE binds only the owner), so
    -- a superuser-connected runner would false-fail these cross-client reads.
    -- The runner is a member of mise_app (granted in 005). See 023 for rationale.
    SET LOCAL ROLE mise_app;

    -- Seed under client_a's context so WITH CHECK is satisfied (no owner bypass).
    PERFORM set_config('app.current_client_id', client_a::text, true);
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_a, '_rls_rev_test_a', '_rls_rev_test_a', 'active');
    INSERT INTO venues (venue_id, client_id, venue_name, state, timezone)
    VALUES (venue_a, client_a, '_rls_rev_venue', 'QLD', 'Australia/Brisbane');
    INSERT INTO revenue_daily (client_id, venue_id, business_date, gross_revenue_cents, net_revenue_cents, source)
    VALUES (client_a, venue_a, '2026-01-01', 100000, 95000, 'seed');

    PERFORM set_config('app.current_client_id', client_b::text, true);
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_b, '_rls_rev_test_b', '_rls_rev_test_b', 'active');

    -- Test 1: client_b cannot read client_a's revenue rows
    SELECT COUNT(*) INTO cnt FROM revenue_daily WHERE client_id = client_a;
    IF cnt <> 0 THEN
        RAISE EXCEPTION 'RLS FAIL: client_b saw % revenue_daily rows for client_a', cnt;
    END IF;

    -- Test 2: client_b cannot write a revenue row for client_a
    BEGIN
        INSERT INTO revenue_daily (client_id, venue_id, business_date, gross_revenue_cents, net_revenue_cents, source)
        VALUES (client_a, venue_a, '2026-01-02', 50000, 47000, 'seed');
        RAISE EXCEPTION 'RLS FAIL: client_b wrote a revenue_daily row for client_a';
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
        NULL; -- expected: RLS WITH CHECK rejected it
    END;

    -- Cleanup as the migration runner (mise_app has no DELETE grant).
    RESET ROLE;
    PERFORM set_config('app.current_client_id', client_a::text, true);
    DELETE FROM revenue_daily WHERE client_id = client_a;
    DELETE FROM venues        WHERE client_id = client_a;
    DELETE FROM clients       WHERE client_id = client_a;
    PERFORM set_config('app.current_client_id', client_b::text, true);
    DELETE FROM clients       WHERE client_id = client_b;

    RAISE NOTICE 'Migration 024 RLS tests PASSED';
END
$$;


-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS revenue_daily;
