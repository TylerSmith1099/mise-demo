-- =============================================================================
-- Migration 036 — Bookings: restaurant and function bookings for demo Reports
--
-- CONTEXT (MIS-642 / MIS-635)
-- ----------------------------
-- Powers the Booking tab (tier 5 DM) and the channel reports seed.
-- Data flows: seed-revenue-channels.js → bookings → /api/bookings.
--
-- DESIGN
-- ------
-- • booking_date + service_window are the natural partition key.
-- • slot_time is venue-local time (Brisbane UTC+10) — no timezone conversion
--   needed for display; stored as TIME without tz.
-- • status tracks lifecycle: tentative → confirmed → completed (or cancelled).
-- • is_vip drives the VIP badge on the Booking tab UI.
-- • Soft-deletes only (deleted_at) — mise_app has no DELETE grant.
--
-- CLIENT ISOLATION
-- ----------------
-- client_id NOT NULL on every row. RLS FORCE-enabled with the canonical
-- expression from migration 005. mise_app has SELECT/INSERT/UPDATE only.
-- =============================================================================

SET timezone = 'UTC';

CREATE TABLE bookings (
    booking_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID        NOT NULL REFERENCES clients (client_id),
    venue_id        UUID        NOT NULL,
    booking_date    DATE        NOT NULL,
    service_window  TEXT        NOT NULL
                        CHECK (service_window IN ('breakfast','lunch','dinner','bar','function')),
    slot_time       TIME        NOT NULL DEFAULT '19:00:00',
    party_size      INTEGER     NOT NULL DEFAULT 2
                        CHECK (party_size > 0 AND party_size <= 500),
    guest_name      TEXT        NOT NULL DEFAULT '',
    contact_phone   TEXT,
    status          TEXT        NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('confirmed','tentative','completed','cancelled')),
    is_vip          BOOLEAN     NOT NULL DEFAULT false,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,

    FOREIGN KEY (client_id, venue_id) REFERENCES venues (client_id, venue_id)
);

-- Primary lookup: bookings by venue + date range
CREATE INDEX idx_bookings_venue_date ON bookings (client_id, venue_id, booking_date);
-- Status filter (upcoming confirmed/tentative bookings)
CREATE INDEX idx_bookings_status     ON bookings (client_id, venue_id, status)
    WHERE deleted_at IS NULL AND status IN ('confirmed', 'tentative');

ALTER TABLE bookings ENABLE  ROW LEVEL SECURITY;
ALTER TABLE bookings FORCE   ROW LEVEL SECURITY;

CREATE POLICY client_isolation ON bookings
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON bookings TO mise_app;


-- ---------------------------------------------------------------------------
-- RLS TEST BLOCK (MIS-431 pattern: run under SET LOCAL ROLE mise_app)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    client_a UUID    := '55555555-5555-5555-5555-555555555555';
    client_b UUID    := '66666666-6666-6666-6666-666666666666';
    venue_a  UUID    := '55555555-0000-0000-0000-000000000001';
    cnt      INTEGER;
BEGIN
    SET LOCAL ROLE mise_app;

    -- Seed under client_a
    PERFORM set_config('app.current_client_id', client_a::text, true);
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_a, '_rls_book_test_a', '_rls_book_test_a', 'active');
    INSERT INTO venues (venue_id, client_id, venue_name, state, timezone)
    VALUES (venue_a, client_a, '_rls_book_venue', 'QLD', 'Australia/Brisbane');
    INSERT INTO bookings (client_id, venue_id, booking_date, service_window, guest_name, party_size)
    VALUES (client_a, venue_a, '2026-01-01', 'dinner', 'Test Guest', 2);

    -- Switch to client_b
    PERFORM set_config('app.current_client_id', client_b::text, true);
    INSERT INTO clients (client_id, client_name, white_label_name, status)
    VALUES (client_b, '_rls_book_test_b', '_rls_book_test_b', 'active');

    -- Test 1: client_b cannot see client_a's bookings
    SELECT COUNT(*) INTO cnt FROM bookings WHERE client_id = client_a;
    IF cnt <> 0 THEN
        RAISE EXCEPTION 'RLS FAIL: client_b saw % booking rows for client_a', cnt;
    END IF;

    -- Test 2: client_b cannot write a booking for client_a
    BEGIN
        INSERT INTO bookings (client_id, venue_id, booking_date, service_window, guest_name, party_size)
        VALUES (client_a, venue_a, '2026-01-02', 'lunch', 'Evil Guest', 1);
        RAISE EXCEPTION 'RLS FAIL: client_b wrote a booking row for client_a';
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
        NULL; -- expected
    END;

    -- Cleanup
    RESET ROLE;
    PERFORM set_config('app.current_client_id', client_a::text, true);
    DELETE FROM bookings WHERE client_id = client_a;
    DELETE FROM venues   WHERE client_id = client_a;
    DELETE FROM clients  WHERE client_id = client_a;
    PERFORM set_config('app.current_client_id', client_b::text, true);
    DELETE FROM clients  WHERE client_id = client_b;

    RAISE NOTICE 'Migration 036 RLS tests PASSED';
END
$$;


-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS bookings;
