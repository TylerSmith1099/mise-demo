-- =============================================================================
-- Migration 004 — Shift operations: shifts & runsheet items
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- shifts — a scheduled/active/completed shift for a staff member, sourced from
-- Humanforce or entered manually.
CREATE TABLE shifts (
    shift_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES clients (client_id),
    venue_id    UUID NOT NULL,
    staff_id    UUID NOT NULL,
    role_name   TEXT NOT NULL,
    shift_start TIMESTAMPTZ NOT NULL,
    shift_end   TIMESTAMPTZ NOT NULL,
    status      TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','active','completed')),
    source      TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('humanforce','manual')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    FOREIGN KEY (client_id, venue_id) REFERENCES venues (client_id, venue_id),
    FOREIGN KEY (client_id, staff_id) REFERENCES staff (client_id, staff_id),
    UNIQUE (client_id, shift_id)
);
CREATE INDEX idx_shifts_client ON shifts (client_id);
CREATE INDEX idx_shifts_staff ON shifts (client_id, staff_id);

-- runsheet_items — an ordered task on a shift's runsheet, optionally completed.
CREATE TABLE runsheet_items (
    item_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id        UUID NOT NULL REFERENCES clients (client_id),
    shift_id         UUID NOT NULL,
    task_description TEXT NOT NULL,
    due_by           TIME,           -- local clock time on the shift; date implied by shift
    completed_at     TIMESTAMPTZ,
    completed_by     UUID,           -- nullable FK to staff (same client)
    item_order       INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    FOREIGN KEY (client_id, shift_id)     REFERENCES shifts (client_id, shift_id),
    FOREIGN KEY (client_id, completed_by) REFERENCES staff (client_id, staff_id)
);
CREATE INDEX idx_runsheet_items_client ON runsheet_items (client_id);
CREATE INDEX idx_runsheet_items_shift ON runsheet_items (client_id, shift_id);

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS runsheet_items;
-- DROP TABLE IF EXISTS shifts;
