-- =============================================================================
-- Migration 009 — Demo dataset schema extensions (MIS-26 Step 1)
--
-- Adds the columns/tables the product demo data requires that the foundation
-- schema (001–008) did not yet carry: employment type & pay rate on staff,
-- department/cost on shifts, venue gaming-floor minimum, EGM performance,
-- shift handover notes, and a P&L summary.
--
-- ISOLATION CONTRACT (non-negotiable): every new table carries a NOT NULL
-- client_id, is FK-pinned to its client's venue via the composite
-- (client_id, venue_id), and is protected by the same RLS policy as every
-- other client-data table (see migration 005). New tables created by the
-- migration owner are covered by the ALTER DEFAULT PRIVILEGES grant in 005;
-- explicit GRANTs below are belt-and-braces.
--
-- This migration is IDEMPOTENT (safe to re-apply): all DDL uses IF NOT EXISTS
-- and policies are dropped-then-created.
-- =============================================================================

SET timezone = 'UTC';

-- --- staff: employment, pay rate, current status, department -----------------
ALTER TABLE staff ADD COLUMN IF NOT EXISTS employment_type  TEXT;     -- casual | part_time | full_time
ALTER TABLE staff ADD COLUMN IF NOT EXISTS base_hourly_rate NUMERIC(7,2);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS shift_status     TEXT;     -- on | off | rostered
ALTER TABLE staff ADD COLUMN IF NOT EXISTS department       TEXT;     -- gaming | beverage | food | bottle_shop | management

-- --- venues: gaming-floor minimum & machine count ----------------------------
ALTER TABLE venues ADD COLUMN IF NOT EXISTS gaming_min_attendants SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS egm_count             SMALLINT NOT NULL DEFAULT 0;

-- --- shifts: department + costed labour ---------------------------------------
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS department  TEXT;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(7,2);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS labour_cost NUMERIC(10,2);

-- --- egm_machines: per-machine gaming performance -----------------------------
CREATE TABLE IF NOT EXISTS egm_machines (
    machine_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients (client_id),
    venue_id        UUID NOT NULL,
    machine_number  SMALLINT NOT NULL,
    game_name       TEXT NOT NULL,
    weekly_turnover NUMERIC(12,2) NOT NULL,   -- meter turnover (amount wagered), weekly
    status          TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','suspended','out_of_service')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    FOREIGN KEY (client_id, venue_id) REFERENCES venues (client_id, venue_id),
    UNIQUE (client_id, venue_id, machine_number)
);
CREATE INDEX IF NOT EXISTS idx_egm_machines_client ON egm_machines (client_id);
CREATE INDEX IF NOT EXISTS idx_egm_machines_venue  ON egm_machines (client_id, venue_id);

-- --- handover_notes: pre-seeded shift handover from the prior shift -----------
CREATE TABLE IF NOT EXISTS handover_notes (
    note_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            UUID NOT NULL REFERENCES clients (client_id),
    venue_id             UUID NOT NULL,
    author_staff_id      UUID,                 -- nullable: who wrote it (same client)
    from_role            TEXT NOT NULL,
    to_role              TEXT NOT NULL,
    shift_date           DATE NOT NULL,
    open_compliance_items TEXT,
    staffing_notes       TEXT,
    incidents_summary    TEXT,
    action_items         TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at           TIMESTAMPTZ,
    FOREIGN KEY (client_id, venue_id)        REFERENCES venues (client_id, venue_id),
    FOREIGN KEY (client_id, author_staff_id) REFERENCES staff  (client_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_handover_notes_client ON handover_notes (client_id);
CREATE INDEX IF NOT EXISTS idx_handover_notes_venue  ON handover_notes (client_id, venue_id);

-- --- pnl_summary: monthly P&L by department -----------------------------------
CREATE TABLE IF NOT EXISTS pnl_summary (
    pnl_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES clients (client_id),
    venue_id            UUID NOT NULL,
    period_label        TEXT NOT NULL,          -- e.g. '2026-05 (monthly)'
    department          TEXT NOT NULL,          -- beverage | food | gaming | bottle_shop | total
    revenue             NUMERIC(12,2) NOT NULL, -- net revenue used for labour %
    labour_cost         NUMERIC(12,2) NOT NULL,
    labour_pct          NUMERIC(5,2),           -- labour_cost / revenue * 100
    net_gaming_revenue  NUMERIC(12,2),          -- gaming only: net (RTV) revenue
    meter_turnover      NUMERIC(14,2),          -- gaming only: amount wagered (context, never a revenue base)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    FOREIGN KEY (client_id, venue_id) REFERENCES venues (client_id, venue_id)
);
CREATE INDEX IF NOT EXISTS idx_pnl_summary_client ON pnl_summary (client_id);
CREATE INDEX IF NOT EXISTS idx_pnl_summary_venue  ON pnl_summary (client_id, venue_id);

-- --- RLS on the new tables: identical client_isolation policy as migration 005 -
ALTER TABLE egm_machines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE egm_machines   FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_isolation ON egm_machines;
CREATE POLICY client_isolation ON egm_machines
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

ALTER TABLE handover_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE handover_notes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_isolation ON handover_notes;
CREATE POLICY client_isolation ON handover_notes
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

ALTER TABLE pnl_summary    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pnl_summary    FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_isolation ON pnl_summary;
CREATE POLICY client_isolation ON pnl_summary
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

-- Belt-and-braces grants (DEFAULT PRIVILEGES in 005 already covers owner-created tables).
GRANT SELECT, INSERT, UPDATE ON egm_machines, handover_notes, pnl_summary TO mise_app;

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS pnl_summary;
-- DROP TABLE IF EXISTS handover_notes;
-- DROP TABLE IF EXISTS egm_machines;
-- ALTER TABLE shifts DROP COLUMN IF EXISTS labour_cost, DROP COLUMN IF EXISTS hourly_rate, DROP COLUMN IF EXISTS department;
-- ALTER TABLE venues DROP COLUMN IF EXISTS egm_count, DROP COLUMN IF EXISTS gaming_min_attendants;
-- ALTER TABLE staff  DROP COLUMN IF EXISTS department, DROP COLUMN IF EXISTS shift_status, DROP COLUMN IF EXISTS base_hourly_rate, DROP COLUMN IF EXISTS employment_type;
