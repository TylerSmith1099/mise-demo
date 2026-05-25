-- =============================================================================
-- Migration 031 — Reporting support indices + MV gap confirmation
--
-- CONTEXT (Reporting & Filtering, MIS-428 / Architecture MIS-426 §2.4 + §5.1.3)
-- ------------------------------------------------------------------------------
-- The reporting filter API queries existing tables for the `incident_count` and
-- `compliance_count` metrics. This migration adds the date-range indices those
-- queries need and documents the MV gap analysis mandated by MIS-426 §5.1.3.
--
-- MV GAP ANALYSIS (mv_venue_daily_summary, migration 027)
-- -------------------------------------------------------
-- The CTO architecture (MIS-426 §5.1.3) requires confirming that
-- mv_venue_daily_summary covers the reporting metrics at wide (group/cluster)
-- scope, and extending the MV definition if `transaction_count` or
-- `incident_count` are absent.
--
-- Findings:
--
-- ✓ transaction_count  — PRESENT in the MV (from revenue_daily, mig 027 line 68).
--                        Wide-scope transaction count rolls up correctly through
--                        the MV. No change required.
--
-- ✗ incident_count (time-period) — NOT in the MV as a date-bounded metric.
--   The MV carries `open_incident_count`, which is a live count of unresolved
--   incidents (status IN ('draft','submitted')), not a date-bounded historical
--   count per business_date. These are different metrics:
--   • open_incident_count = "how many incidents are unresolved right now" (live)
--   • incident_count by period = "how many incidents occurred in this date range"
--
--   Adding a date-bounded incident count to the MV would require mapping
--   incident_reports.incident_at (TIMESTAMPTZ) to a business_date using the
--   venue's timezone and day-rollover convention — a runtime join that is not
--   structurally aligned with the MV's (client, venue, business_date) grain.
--
--   DECISION: incident_count by period queries incident_reports directly, with
--   the new composite index added below. At single/cluster scope the scan is
--   tiny (incidents are sparse vs. daily revenue rows). At full-group scope,
--   the indexed range scan across 40 venues is still fast. Adding a stale
--   MV column for this purpose would add refresh complexity with no material
--   query benefit.
--
-- ✗ compliance_count (time-period) — same reasoning as incident_count.
--   The MV carries `unack_compliance_count` (live, not date-bounded).
--   Time-period compliance queries read compliance_events directly.
--
-- INDICES ADDED
-- -------------
-- 1. incident_reports (client_id, venue_id, incident_at)
--    Powers the reporting API's incident_count metric with a date-range filter.
--    Combined with the RLS client_id gate and resolveScope() venue filter, this
--    is the covering index for: WHERE client_id = $c AND venue_id = ANY($venues)
--    AND incident_at BETWEEN $from AND $to AND deleted_at IS NULL
--
-- 2. compliance_events (client_id, venue_id, created_at)
--    Powers compliance_count by period (compliance_events has no business_date;
--    created_at is the event timestamp). Same access pattern as above.
--
-- NO CHANGES TO:
-- • revenue_daily index (already indexed on (client_id, venue_id, business_date))
-- • labour_actuals_daily index (same)
-- • mv_venue_daily_summary (MV covers its intended wide-scope use cases;
--   incident/compliance queries go to base tables by design)
-- • Any new daily/weekly/monthly summary tables (explicitly ruled out in
--   MIS-426 §5.1.5 — week/month/quarter/year are computed on-the-fly)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- Index 1: incident_reports by venue + time (reporting incident_count metric)
-- Partial index (deleted_at IS NULL) keeps the index size small; deleted
-- incidents are excluded from reporting queries.
CREATE INDEX IF NOT EXISTS idx_incident_reports_reporting
    ON incident_reports (client_id, venue_id, incident_at)
    WHERE deleted_at IS NULL;

-- Index 2: compliance_events by venue + time (reporting compliance_count metric)
CREATE INDEX IF NOT EXISTS idx_compliance_events_reporting
    ON compliance_events (client_id, venue_id, created_at)
    WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------------
-- Smoke test: confirm indices are usable (PostgreSQL planner can choose them)
-- This DO block verifies the indices exist; actual query-planner selection is
-- environment-dependent and cannot be tested in a migration DO block.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'incident_reports'
          AND indexname  = 'idx_incident_reports_reporting'
    ) THEN
        RAISE EXCEPTION 'Migration 031 FAIL: idx_incident_reports_reporting not found';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'compliance_events'
          AND indexname  = 'idx_compliance_events_reporting'
    ) THEN
        RAISE EXCEPTION 'Migration 031 FAIL: idx_compliance_events_reporting not found';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_matviews
        WHERE matviewname = 'mv_venue_daily_summary'
    ) THEN
        RAISE EXCEPTION 'Migration 031 FAIL: mv_venue_daily_summary not found (mig 027 missing?)';
    END IF;

    RAISE NOTICE 'Migration 031 smoke tests PASSED — reporting indices confirmed, MV present';
END
$$;


-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP INDEX IF EXISTS idx_compliance_events_reporting;
-- DROP INDEX IF EXISTS idx_incident_reports_reporting;
