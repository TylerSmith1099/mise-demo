-- =============================================================================
-- Migration 028 — Labour: add 'award_estimate' to labour_actuals_daily source CHECK
--
-- CONTEXT (Admin Homepage, MIS-419 / Architecture MIS-409 §7-R flag 2)
-- ---------------------------------------------------------------------
-- Migration 025 shipped source IN ('humanforce','keypay','manual','seed').
-- The Admin Homepage labour-% KPI needs to distinguish definitive actuals from
-- award-derived estimates when no connected WFM (Humanforce/KeyPay) row exists.
--
-- CFO (MIS-417) and Knowledge (MIS-418) confirmed award_estimate is in scope:
-- cost is derived from the Fair Work Award rate for the inferred staff mix when
-- no integration data is available.
--
-- DESIGN
-- ------
-- • Adds 'award_estimate' to the CHECK constraint via ALTER TABLE.
-- • UNIQUE (client_id, venue_id, business_date, source) already covers each
--   combination independently — an 'award_estimate' row coexists with a later
--   'keypay' or 'humanforce' row for the same day; the API/MV picks the
--   definitive source when present (award_estimate is not overwritten).
-- • RLS unchanged — table already has FORCE ROW LEVEL SECURITY + client_isolation
--   policy from mig 025; no new grants required.
-- • No data backfill needed for the demo.
--
-- CLIENT ISOLATION
-- ----------------
-- No change — client_id NOT NULL + RLS inherited from migration 025.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- Drop the existing CHECK and replace it with the extended set.
-- PostgreSQL does not support ALTER CONSTRAINT for CHECK constraints, so we
-- drop by name and re-add.  The constraint name matches what pg assigns when
-- no explicit name is given; verify with \d labour_actuals_daily if needed.
-- NOTE: pg auto-names unnamed CHECK constraints as <table>_<column>_check;
-- if the deployed name differs, re-run the DROP with the actual name.
ALTER TABLE labour_actuals_daily
    DROP CONSTRAINT IF EXISTS labour_actuals_daily_source_check;

ALTER TABLE labour_actuals_daily
    ADD CONSTRAINT labour_actuals_daily_source_check
        CHECK (source IN ('humanforce', 'keypay', 'manual', 'seed', 'award_estimate'));

-- Smoke-test: insert an award_estimate row and confirm it is accepted, then
-- clean up.  Runs inside an anonymous DO block so any failure rolls back the
-- migration transaction.
DO $$
DECLARE
    client_t UUID := 'aaaaaaaa-0000-4000-8000-000000000099';
    venue_t  UUID := 'aaaaaaaa-0000-4000-8000-000000000098';
    cnt      INTEGER;
BEGIN
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_t, '_mig028_test', '_mig028_test', 'active')
    ON CONFLICT DO NOTHING;

    INSERT INTO venues (venue_id, client_id, venue_name, state, timezone)
    VALUES (venue_t, client_t, '_mig028_venue', 'QLD', 'Australia/Brisbane')
    ON CONFLICT DO NOTHING;

    -- Must succeed — award_estimate is now a valid source value
    INSERT INTO labour_actuals_daily
        (client_id, venue_id, business_date, worked_hours, labour_cost_cents, source)
    VALUES (client_t, venue_t, '2026-01-01', 40.0, 120000, 'award_estimate');

    SELECT COUNT(*) INTO cnt
    FROM labour_actuals_daily
    WHERE client_id = client_t AND source = 'award_estimate';

    IF cnt <> 1 THEN
        RAISE EXCEPTION 'Migration 028 smoke FAIL: expected 1 award_estimate row, got %', cnt;
    END IF;

    -- Confirm old source values still pass (no regression)
    INSERT INTO labour_actuals_daily
        (client_id, venue_id, business_date, worked_hours, labour_cost_cents, source)
    VALUES (client_t, venue_t, '2026-01-01', 38.0, 114000, 'keypay');

    -- Confirm rejection of an invalid source still fires
    BEGIN
        INSERT INTO labour_actuals_daily
            (client_id, venue_id, business_date, worked_hours, labour_cost_cents, source)
        VALUES (client_t, venue_t, '2026-01-02', 10, 30000, 'invalid_source');
        RAISE EXCEPTION 'Migration 028 smoke FAIL: invalid source was not rejected';
    EXCEPTION WHEN check_violation THEN
        NULL; -- expected
    END;

    -- Cleanup
    DELETE FROM labour_actuals_daily WHERE client_id = client_t;
    DELETE FROM venues               WHERE client_id = client_t;
    DELETE FROM clients              WHERE client_id = client_t;

    RAISE NOTICE 'Migration 028 smoke tests PASSED';
END
$$;


-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- ALTER TABLE labour_actuals_daily
--     DROP CONSTRAINT IF EXISTS labour_actuals_daily_source_check;
-- ALTER TABLE labour_actuals_daily
--     ADD CONSTRAINT labour_actuals_daily_source_check
--         CHECK (source IN ('humanforce', 'keypay', 'manual', 'seed'));
