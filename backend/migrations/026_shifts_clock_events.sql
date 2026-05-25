-- =============================================================================
-- Migration 026 — Shifts: clock-in / clock-out columns
--
-- CONTEXT (Admin Homepage, MIS-411 / Architecture MIS-409 §2.3)
-- -------------------------------------------------------------
-- The existing shifts table (mig 004) tracks scheduled/active/completed status
-- and shift_start/shift_end (the planned window). The admin homepage "who's on
-- the floor now" view needs the ACTUAL clock event, distinct from the schedule.
--
-- Two nullable TIMESTAMPTZ columns are added:
--   clock_in_at  — when the staff member physically clocked in
--   clock_out_at — when the staff member physically clocked out
--
-- Rules:
--   • Both columns are nullable: a shift may be scheduled but not yet clocked in.
--   • No backfill required; existing rows remain valid with NULLs.
--   • clock_out_at must be after clock_in_at (CHECK enforced where both set).
--   • The existing status column (scheduled/active/completed) is unchanged;
--     clock events are independent data, not a status driver.
--   • Soft-delete only — no DELETE grant on shifts (unchanged from mig 005).
--   • All timestamps TIMESTAMPTZ UTC; app layer converts for display.
--
-- Reversible: both columns can be dropped without data loss beyond the clock data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

ALTER TABLE shifts
    ADD COLUMN clock_in_at  TIMESTAMPTZ,
    ADD COLUMN clock_out_at TIMESTAMPTZ,
    ADD CONSTRAINT shifts_clock_order
        CHECK (clock_out_at IS NULL OR clock_in_at IS NULL OR clock_out_at >= clock_in_at);

-- Index to support the "who is clocked in right now" query efficiently:
-- find active clock-ins (clock_in_at set, clock_out_at null) within a client.
CREATE INDEX idx_shifts_clocked_in ON shifts (client_id, venue_id, clock_in_at)
    WHERE clock_in_at IS NOT NULL AND clock_out_at IS NULL AND deleted_at IS NULL;


-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP INDEX IF EXISTS idx_shifts_clocked_in;
-- ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_clock_order;
-- ALTER TABLE shifts DROP COLUMN IF EXISTS clock_out_at;
-- ALTER TABLE shifts DROP COLUMN IF EXISTS clock_in_at;
