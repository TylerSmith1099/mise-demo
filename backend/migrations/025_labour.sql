-- =============================================================================
-- Migration 025 — Labour: actuals daily + budgets
--
-- CONTEXT (Admin Homepage, MIS-411 / Architecture MIS-409)
-- ---------------------------------------------------------
-- Powers the labour / budget-vs-actual section of the admin homepage. Two tables:
--
--   labour_actuals_daily  — worked hours + cost rollup per venue per trading date,
--                           sourced from Humanforce timesheets (or KeyPay actual
--                           rates where connected).
--   labour_budgets        — the budget side: planned hours + cost + revenue for a
--                           date period, entered manually or imported.
--
-- The headline pub KPI "labour cost as % of revenue" is computed at query time
-- from labour_actuals_daily ⋈ revenue_daily on (venue_id, business_date) — not
-- stored, so it can never become stale independently.
--
-- KEY DESIGN DECISIONS
-- --------------------
-- • Money stored as integer cents (BIGINT), hours as NUMERIC(8,2). Same rules
--   as revenue_daily (mig 024).
-- • business_date is the venue-local trading date, consistent with revenue_daily.
--   Revenue↔labour join correctness depends on both tables using the same
--   trading-date convention (mig 024 §2.4 in architecture doc MIS-409).
-- • UNIQUE (client_id, venue_id, business_date, source) enables idempotent
--   ON CONFLICT upserts from the Humanforce sync connector.
-- • labour_budgets.budgeted_revenue_cents is nullable: when set it enables a
--   forecast-variance view; when absent only the hours/cost budget is tracked.
-- • No stored "labour %" column — computed at the API layer to avoid drift.
--
-- CLIENT ISOLATION
-- ----------------
-- client_id NOT NULL on every row. RLS enabled and forced. mise_app no DELETE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- labour_actuals_daily — one row per (client, venue, trading date, WFM source).
-- Timesheets are reconciled end-of-day; intraday rows use scheduled hours as a
-- provisional estimate until the definitive timesheet is received.
CREATE TABLE labour_actuals_daily (
    labour_id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID         NOT NULL REFERENCES clients (client_id),
    venue_id            UUID         NOT NULL,
    business_date       DATE         NOT NULL,
    worked_hours        NUMERIC(8,2) NOT NULL DEFAULT 0,
    labour_cost_cents   BIGINT       NOT NULL DEFAULT 0,
    budgeted_hours      NUMERIC(8,2),   -- nullable; from labour_budgets for that period
    budgeted_cost_cents BIGINT,         -- nullable; denormalised for query convenience
    source              TEXT         NOT NULL
                            CHECK (source IN ('humanforce','keypay','manual','seed')),
    is_stale            BOOLEAN      NOT NULL DEFAULT false,
    synced_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,

    FOREIGN KEY (client_id, venue_id) REFERENCES venues (client_id, venue_id),
    UNIQUE (client_id, venue_id, business_date, source)
);

-- Primary lookup: scope-filtered daily labour for a date range
CREATE INDEX idx_labour_actuals_scope ON labour_actuals_daily (client_id, venue_id, business_date);
-- Freshness sweep
CREATE INDEX idx_labour_actuals_stale ON labour_actuals_daily (client_id, is_stale) WHERE is_stale = true;

ALTER TABLE labour_actuals_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_actuals_daily FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON labour_actuals_daily
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON labour_actuals_daily TO mise_app;


-- labour_budgets — the planned budget for a venue over a date period.
-- period_start/period_end are inclusive trading dates (venue-local).
-- Multiple overlapping periods are allowed (e.g. weekly + monthly budgets);
-- the API picks the most granular period covering the requested date range.
CREATE TABLE labour_budgets (
    budget_id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id               UUID         NOT NULL REFERENCES clients (client_id),
    venue_id                UUID         NOT NULL,
    period_start            DATE         NOT NULL,
    period_end              DATE         NOT NULL,
    budgeted_hours          NUMERIC(10,2) NOT NULL,
    budgeted_cost_cents     BIGINT       NOT NULL,
    budgeted_revenue_cents  BIGINT,      -- nullable; enables revenue-forecast variance
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,

    FOREIGN KEY (client_id, venue_id) REFERENCES venues (client_id, venue_id),
    CONSTRAINT budget_period_valid CHECK (period_end >= period_start)
);

-- Budget lookup for a given venue + date range
CREATE INDEX idx_labour_budgets_scope ON labour_budgets (client_id, venue_id, period_start, period_end);

ALTER TABLE labour_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_budgets FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON labour_budgets
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON labour_budgets TO mise_app;


-- ---------------------------------------------------------------------------
-- RLS TEST BLOCK
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    client_a UUID    := '55555555-5555-5555-5555-555555555555';
    client_b UUID    := '66666666-6666-6666-6666-666666666666';
    venue_a  UUID    := '55555555-0000-0000-0000-000000000001';
    cnt      INTEGER;
BEGIN
    -- Run AS mise_app: a superuser bypasses RLS (FORCE binds only the owner), so
    -- a superuser-connected runner would false-fail these cross-client reads.
    -- The runner is a member of mise_app (granted in 005). See 023 for rationale.
    SET LOCAL ROLE mise_app;

    -- Seed under client_a's context so WITH CHECK is satisfied (no owner bypass).
    PERFORM set_config('app.current_client_id', client_a::text, true);
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_a, '_rls_lab_test_a', '_rls_lab_test_a', 'active');
    INSERT INTO venues (venue_id, client_id, venue_name, state, timezone)
    VALUES (venue_a, client_a, '_rls_lab_venue', 'QLD', 'Australia/Brisbane');
    INSERT INTO labour_actuals_daily (client_id, venue_id, business_date, worked_hours, labour_cost_cents, source)
    VALUES (client_a, venue_a, '2026-01-01', 32.5, 88000, 'seed');
    INSERT INTO labour_budgets (client_id, venue_id, period_start, period_end, budgeted_hours, budgeted_cost_cents)
    VALUES (client_a, venue_a, '2026-01-01', '2026-01-07', 200, 550000);

    PERFORM set_config('app.current_client_id', client_b::text, true);
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_b, '_rls_lab_test_b', '_rls_lab_test_b', 'active');

    -- Test 1: client_b cannot read client_a's labour actuals
    SELECT COUNT(*) INTO cnt FROM labour_actuals_daily WHERE client_id = client_a;
    IF cnt <> 0 THEN
        RAISE EXCEPTION 'RLS FAIL: client_b saw % labour_actuals_daily rows for client_a', cnt;
    END IF;

    -- Test 2: client_b cannot read client_a's labour budgets
    SELECT COUNT(*) INTO cnt FROM labour_budgets WHERE client_id = client_a;
    IF cnt <> 0 THEN
        RAISE EXCEPTION 'RLS FAIL: client_b saw % labour_budgets rows for client_a', cnt;
    END IF;

    -- Test 3: client_b cannot write a labour_actuals_daily row for client_a
    BEGIN
        INSERT INTO labour_actuals_daily (client_id, venue_id, business_date, worked_hours, labour_cost_cents, source)
        VALUES (client_a, venue_a, '2026-01-02', 10, 25000, 'seed');
        RAISE EXCEPTION 'RLS FAIL: client_b wrote a labour_actuals_daily row for client_a';
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
        NULL; -- expected: RLS WITH CHECK rejected it
    END;

    -- Cleanup as the migration runner (mise_app has no DELETE grant).
    RESET ROLE;
    PERFORM set_config('app.current_client_id', client_a::text, true);
    DELETE FROM labour_budgets       WHERE client_id = client_a;
    DELETE FROM labour_actuals_daily WHERE client_id = client_a;
    DELETE FROM venues               WHERE client_id = client_a;
    DELETE FROM clients              WHERE client_id = client_a;
    PERFORM set_config('app.current_client_id', client_b::text, true);
    DELETE FROM clients              WHERE client_id = client_b;

    RAISE NOTICE 'Migration 025 RLS tests PASSED';
END
$$;


-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS labour_budgets;
-- DROP TABLE IF EXISTS labour_actuals_daily;
