-- =============================================================================
-- Migration 001 — Initial schema: core + staff/sessions
-- Mise MVP PostgreSQL data layer
--
-- Conventions enforced across the whole schema:
--   * Every client-data table carries a NOT NULL client_id (UUID).
--   * All timestamps are TIMESTAMPTZ stored in UTC (DB timezone is forced to
--     UTC in this migration). The application layer converts to venue tz.
--   * Soft deletes only: a deleted_at TIMESTAMPTZ (NULL = live) plus, where the
--     domain calls for it, a status column. No hard DELETEs in app paths.
--   * No foreign keys cross a client boundary. FKs to client-scoped parents are
--     reinforced by composite (client_id, id) references so a child can never
--     point at another client's parent row.
--   * RLS policies are added in migration 005; immutability triggers in 006.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------

-- Force UTC at the database level. All TIMESTAMPTZ values are stored in UTC by
-- Postgres regardless, but this makes session-default rendering unambiguous.
SET timezone = 'UTC';

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- clients — the tenant root. One row per pub group (a Mise client/customer).
CREATE TABLE clients (
    client_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_name      TEXT NOT NULL,
    white_label_name TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'suspended')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);
-- Note: on clients, client_id IS the primary key, so the identical RLS policy
-- expression (client_id = current client) applies uniformly to every table.

-- venues — a physical venue belonging to one client (2..350+ per client).
CREATE TABLE venues (
    venue_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id  UUID NOT NULL REFERENCES clients (client_id),
    venue_name TEXT NOT NULL,
    state      TEXT NOT NULL CHECK (state IN ('QLD','NSW','VIC','SA','WA','TAS','NT','ACT')),
    timezone   TEXT NOT NULL DEFAULT 'Australia/Brisbane',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    -- Composite unique target so client-scoped children can pin (client_id, venue_id).
    UNIQUE (client_id, venue_id)
);
CREATE INDEX idx_venues_client ON venues (client_id);

-- staff — a staff member at a venue; role_tier maps to the 1..7 role architecture.
CREATE TABLE staff (
    staff_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id  UUID NOT NULL REFERENCES clients (client_id),
    venue_id   UUID NOT NULL,
    first_name TEXT NOT NULL,
    last_name  TEXT NOT NULL,
    email      TEXT NOT NULL,
    role_tier  SMALLINT NOT NULL CHECK (role_tier BETWEEN 1 AND 7),
    role_name  TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    -- Same-client guarantee: the referenced venue must share this row's client_id.
    FOREIGN KEY (client_id, venue_id) REFERENCES venues (client_id, venue_id),
    UNIQUE (client_id, staff_id),
    -- Email is unique per client (not globally — two clients may share an address).
    UNIQUE (client_id, email)
);
CREATE INDEX idx_staff_client ON staff (client_id);
CREATE INDEX idx_staff_venue ON staff (client_id, venue_id);

-- sessions — one authenticated staff login. role_at_login is captured once at
-- session creation and is INSERT-only (enforced by trigger in migration 006).
CREATE TABLE sessions (
    session_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id      UUID NOT NULL REFERENCES clients (client_id),
    venue_id       UUID NOT NULL,
    staff_id       UUID NOT NULL,
    role_at_login  TEXT NOT NULL,  -- immutable snapshot of role at login time
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at       TIMESTAMPTZ,
    deleted_at     TIMESTAMPTZ,
    FOREIGN KEY (client_id, venue_id) REFERENCES venues (client_id, venue_id),
    FOREIGN KEY (client_id, staff_id) REFERENCES staff (client_id, staff_id),
    UNIQUE (client_id, session_id)
);
CREATE INDEX idx_sessions_client ON sessions (client_id);
CREATE INDEX idx_sessions_staff ON sessions (client_id, staff_id);

-- ---------------------------------------------------------------------------
-- DOWN (rollback) — drop in reverse dependency order.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS sessions;
-- DROP TABLE IF EXISTS staff;
-- DROP TABLE IF EXISTS venues;
-- DROP TABLE IF EXISTS clients;
-- DROP EXTENSION IF EXISTS "pgcrypto";
