-- =============================================================================
-- Migration 014 — Runsheet item category (MIS-107, for the MIS-102 Runsheet tab)
--
-- The runsheet_items table already exists (004) and is under client RLS (005).
-- The MIS-102 UI groups/colours each task by a category. This adds the single
-- column the GET /api/runsheet contract needs; everything else is reused.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- category — a UI grouping/colour for the task; NULL = uncategorised ("open").
ALTER TABLE runsheet_items
    ADD COLUMN IF NOT EXISTS category TEXT
        CHECK (category IS NULL
               OR category IN ('open','compliance','gaming','bar','open_close'));

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- ALTER TABLE runsheet_items DROP COLUMN IF EXISTS category;
