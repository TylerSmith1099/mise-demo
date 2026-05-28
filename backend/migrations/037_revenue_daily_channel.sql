-- =============================================================================
-- Migration 037 — revenue_daily: add channel dimension for per-channel reports
--
-- CONTEXT (MIS-642 / MIS-635 / HoP sign-off MIS-641)
-- ---------------------------------------------------
-- The existing revenue_daily table stores one aggregate row per
-- (client, venue, date, source). This migration adds a channel column so the
-- Reports tab can display Gaming / Bar / Food / Bottle Shop breakdowns with
-- actual vs target and variance — without touching the schema of existing rows
-- (they get channel='total' by default).
--
-- CHANGE
-- ------
-- 1. Add column: channel TEXT NOT NULL DEFAULT 'total'
--    CHECK (channel IN ('total','gaming','bar','food','tab_keno','bottle_shop'))
-- 2. Drop old UNIQUE (client_id, venue_id, business_date, source) — too narrow
--    once per-channel rows exist alongside the aggregate 'total'.
-- 3. Add new UNIQUE (client_id, venue_id, business_date, source, channel).
-- 4. Add an index on (client_id, venue_id, business_date, channel) for
--    channel-scoped range queries from the reports API.
--
-- BACKWARD COMPATIBILITY
-- ----------------------
-- All existing rows get channel='total'. The admin-homepage + MIS-429 reporting
-- queries that read revenue_daily already filter on venue_id + date range only
-- — they will continue to see the same rows (channel='total' rows exist
-- alongside new per-channel rows; aggregate queries remain unaffected if they
-- don't filter on channel). New channel queries add AND channel != 'total'.
-- =============================================================================

SET timezone = 'UTC';

-- Step 1: add channel column (idempotent — safe to re-run)
ALTER TABLE revenue_daily
    ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'total';

-- Step 2: add CHECK constraint if absent (ALTER TABLE ... ADD CONSTRAINT is
-- idempotent-safe when wrapped in DO $$ ... END $$ with exception handling)
DO $$
BEGIN
    ALTER TABLE revenue_daily
        ADD CONSTRAINT revenue_daily_channel_check
        CHECK (channel IN ('total','gaming','bar','food','tab_keno','bottle_shop'));
EXCEPTION WHEN duplicate_object THEN
    NULL; -- constraint already exists from a prior run
END
$$;

-- Step 3: drop the narrow unique constraint and replace with the channel-aware one.
-- Use IF EXISTS so this is safe on re-run.
ALTER TABLE revenue_daily
    DROP CONSTRAINT IF EXISTS revenue_daily_client_id_venue_id_business_date_source_key;

DO $$
BEGIN
    ALTER TABLE revenue_daily
        ADD CONSTRAINT revenue_daily_scope_channel_key
        UNIQUE (client_id, venue_id, business_date, source, channel);
EXCEPTION WHEN duplicate_object THEN
    NULL; -- already applied
END
$$;

-- Step 4: index for channel-scoped range queries (Reports tab API)
CREATE INDEX IF NOT EXISTS idx_revenue_daily_channel
    ON revenue_daily (client_id, venue_id, business_date, channel);


-- ---------------------------------------------------------------------------
-- Smoke test: confirm existing 'total' rows are still visible and that a
-- per-channel insert + read round-trips correctly.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    client_x UUID := 'aaaaaaaa-aaaa-4000-aaaa-aaaaaaaaaaaa';
    venue_x  UUID := 'aaaaaaaa-0000-4000-0000-000000000001';
    cnt      INTEGER;
BEGIN
    SET LOCAL ROLE mise_app;

    PERFORM set_config('app.current_client_id', client_x::text, true);
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_x, '_rls_chan_test', '_rls_chan_test', 'active');
    INSERT INTO venues  (venue_id, client_id, venue_name, state, timezone)
    VALUES (venue_x, client_x, '_rls_chan_venue', 'QLD', 'Australia/Brisbane');

    -- Insert aggregate row (default channel='total')
    INSERT INTO revenue_daily (client_id, venue_id, business_date, gross_revenue_cents, net_revenue_cents, source)
    VALUES (client_x, venue_x, '2026-01-01', 30000000, 28000000, 'seed');

    -- Insert per-channel row (gaming)
    INSERT INTO revenue_daily (client_id, venue_id, business_date, gross_revenue_cents, net_revenue_cents, source, channel)
    VALUES (client_x, venue_x, '2026-01-01', 12600000, 12600000, 'seed', 'gaming');

    -- Both rows visible
    SELECT COUNT(*) INTO cnt FROM revenue_daily
     WHERE client_id = client_x AND business_date = '2026-01-01';
    IF cnt <> 2 THEN
        RAISE EXCEPTION 'Channel migration smoke test FAIL: expected 2 rows, got %', cnt;
    END IF;

    -- Cleanup
    RESET ROLE;
    DELETE FROM revenue_daily WHERE client_id = client_x;
    DELETE FROM venues        WHERE client_id = client_x;
    DELETE FROM clients       WHERE client_id = client_x;

    RAISE NOTICE 'Migration 037 channel smoke test PASSED';
END
$$;


-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- ALTER TABLE revenue_daily DROP CONSTRAINT IF EXISTS revenue_daily_scope_channel_key;
-- ALTER TABLE revenue_daily ADD CONSTRAINT revenue_daily_client_id_venue_id_business_date_source_key
--   UNIQUE (client_id, venue_id, business_date, source);
-- ALTER TABLE revenue_daily DROP COLUMN IF EXISTS channel;
