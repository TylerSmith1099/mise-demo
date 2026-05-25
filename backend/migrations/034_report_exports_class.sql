-- =============================================================================
-- Migration 034 — report_exports: add export_class column
--
-- CONTEXT (MIS-429 / Architecture MIS-426 §4.3)
-- -----------------------------------------------
-- The MIS-426 architecture specifies an export_class column on report_exports
-- to distinguish regulator-grade exports (audit trail mandatory, must be
-- reproducible and retained inspectable) from internal operational exports.
-- Migration 030 created the table without this column; this migration adds it.
--
-- Two export classes:
--   'regulator' — gaming clearance/meter logs, RG/harm-min interventions,
--                 AUSTRAC triggers; filter-params embedding + audit row are
--                 obligations, not nicety.
--   'internal'  — operational management reports (revenue/labour trends).
--                 Same provenance discipline, lower retention bar.
-- =============================================================================

SET timezone = 'UTC';

ALTER TABLE report_exports
    ADD COLUMN IF NOT EXISTS export_class TEXT NOT NULL DEFAULT 'internal'
        CONSTRAINT report_exports_export_class_check
        CHECK (export_class IN ('regulator', 'internal'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name  = 'report_exports'
          AND column_name = 'export_class'
    ) THEN
        RAISE EXCEPTION 'Migration 034 FAIL: export_class column not found on report_exports';
    END IF;
    RAISE NOTICE 'Migration 034 PASSED — export_class added to report_exports';
END
$$;

-- DOWN: ALTER TABLE report_exports DROP COLUMN IF EXISTS export_class;
