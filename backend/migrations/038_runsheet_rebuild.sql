-- =============================================================================
-- Migration 038 — Run Sheet Rebuild (MIS-639 / MIS-626 W3)
--
-- CONTEXT
-- -------
-- Adds all tables required for the rebuilt 9-section duty-manager run sheet.
-- Source spec: Mise-RunSheet-Component-Spec-V1.md (MIS-637 HoP)
-- UX spec:     RunSheet-Rebuild-UX-V1.md (MIS-638)
--
-- Tables introduced here:
--   venue_calendar         — public holiday + trading-hours overrides
--   weather_cache          — demo seed weather stub (no live API)
--   compliance_acknowledgements — DM acknowledges alerts on shift
--   sports_events          — fixtures + screen allocation
--   venue_screens          — screen/zone inventory
--   chef_specials          — tonight's menu items
--   eighty_six_items       — 86'd kitchen + bar items
--   shift_incentives       — active upsell competitions
--   incentive_scores       — per-staff leaderboard rows
--   roster_breaks          — shift break windows (DM sees "Break 21:30–22:00")
--   shift_priorities       — top-3 briefing items (write by DM)
--   shift_handover_notes   — outgoing DM note, auto-saved + locked at shift close
--   venue_roles            — extensible role/area lookup (not a DB enum)
--   revenue_daily_budgets  — per-channel daily budget targets for the budget section
--
-- Also adds event_data JSONB column to compliance_events for structured alert data.
--
-- CLIENT ISOLATION
-- ----------------
-- Every table carries client_id NOT NULL + venue_id NOT NULL.
-- RLS policies are applied in migration 039_runsheet_rls.sql.
--
-- ROLLBACK at bottom of file.
-- =============================================================================

SET timezone = 'UTC';

-- ── venue_calendar ────────────────────────────────────────────────────────────
CREATE TABLE venue_calendar (
    calendar_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id               UUID        NOT NULL REFERENCES clients(client_id),
    venue_id                UUID        NOT NULL REFERENCES venues(venue_id),
    calendar_date           DATE        NOT NULL,
    is_public_holiday       BOOLEAN     NOT NULL DEFAULT false,
    holiday_name            TEXT,
    trading_hours_override  TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (venue_id, calendar_date)
);
CREATE INDEX idx_venue_calendar_venue   ON venue_calendar(venue_id);
CREATE INDEX idx_venue_calendar_client  ON venue_calendar(client_id);

-- ── weather_cache ─────────────────────────────────────────────────────────────
CREATE TABLE weather_cache (
    weather_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id        UUID        NOT NULL REFERENCES clients(client_id),
    venue_id         UUID        NOT NULL REFERENCES venues(venue_id),
    cached_date      DATE        NOT NULL,
    temperature_c    NUMERIC(4,1),
    condition_label  TEXT,
    trade_note       TEXT,
    fetched_at       TIMESTAMPTZ,
    UNIQUE (venue_id, cached_date)
);
CREATE INDEX idx_weather_cache_venue    ON weather_cache(venue_id);
CREATE INDEX idx_weather_cache_client   ON weather_cache(client_id);

-- ── compliance_acknowledgements ───────────────────────────────────────────────
CREATE TABLE compliance_acknowledgements (
    ack_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID        NOT NULL REFERENCES clients(client_id),
    venue_id            UUID        NOT NULL,
    alert_type          TEXT        NOT NULL,
    alert_ref_id        UUID,
    acknowledged_by     UUID        REFERENCES staff(staff_id),
    acknowledged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    shift_id            UUID        REFERENCES shifts(shift_id)
);
CREATE INDEX idx_compliance_acks_venue  ON compliance_acknowledgements(venue_id);
CREATE INDEX idx_compliance_acks_client ON compliance_acknowledgements(client_id);

-- ── sports_events ─────────────────────────────────────────────────────────────
CREATE TABLE sports_events (
    event_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID        NOT NULL REFERENCES clients(client_id),
    venue_id        UUID        NOT NULL REFERENCES venues(venue_id),
    event_date      DATE        NOT NULL,
    event_name      TEXT        NOT NULL,
    teams           TEXT,
    competition     TEXT,
    start_time      TIME        NOT NULL,
    channel_label   TEXT        NOT NULL,
    is_sound_on     BOOLEAN     NOT NULL DEFAULT false,
    crowd_impact    TEXT        CHECK (crowd_impact IN ('high','medium','low')),
    created_by      UUID        REFERENCES staff(staff_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_sports_events_venue    ON sports_events(venue_id);
CREATE INDEX idx_sports_events_date     ON sports_events(venue_id, event_date);
CREATE INDEX idx_sports_events_client   ON sports_events(client_id);

-- ── venue_screens ─────────────────────────────────────────────────────────────
CREATE TABLE venue_screens (
    screen_id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID    NOT NULL REFERENCES clients(client_id),
    venue_id            UUID    NOT NULL REFERENCES venues(venue_id),
    screen_label        TEXT    NOT NULL,
    zone_label          TEXT    NOT NULL,
    current_event_id    UUID    REFERENCES sports_events(event_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    UNIQUE (venue_id, screen_label)
);
CREATE INDEX idx_venue_screens_venue    ON venue_screens(venue_id);
CREATE INDEX idx_venue_screens_client   ON venue_screens(client_id);

-- ── chef_specials ─────────────────────────────────────────────────────────────
CREATE TABLE chef_specials (
    special_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID        NOT NULL REFERENCES clients(client_id),
    venue_id        UUID        NOT NULL REFERENCES venues(venue_id),
    service_date    DATE        NOT NULL,
    service         TEXT        NOT NULL CHECK (service IN ('lunch','dinner','all_day')),
    dish_name       TEXT        NOT NULL,
    description     TEXT,
    price_cents     INTEGER     NOT NULL CHECK (price_cents > 0),
    allergen_tags   JSONB       NOT NULL DEFAULT '[]',
    available_count INTEGER,
    is_pushed       BOOLEAN     NOT NULL DEFAULT false,
    created_by      UUID        REFERENCES staff(staff_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_chef_specials_venue    ON chef_specials(venue_id, service_date);
CREATE INDEX idx_chef_specials_client   ON chef_specials(client_id);

-- ── eighty_six_items ─────────────────────────────────────────────────────────
CREATE TABLE eighty_six_items (
    item_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID        NOT NULL REFERENCES clients(client_id),
    venue_id        UUID        NOT NULL REFERENCES venues(venue_id),
    service_date    DATE        NOT NULL,
    category        TEXT        NOT NULL CHECK (category IN ('kitchen','bar')),
    item_name       TEXT        NOT NULL,
    reason          TEXT,
    logged_by       UUID        REFERENCES staff(staff_id),
    logged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_eighty_six_venue       ON eighty_six_items(venue_id, service_date);
CREATE INDEX idx_eighty_six_client      ON eighty_six_items(client_id);

-- ── shift_incentives ─────────────────────────────────────────────────────────
CREATE TABLE shift_incentives (
    incentive_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID        NOT NULL REFERENCES clients(client_id),
    venue_id            UUID        NOT NULL REFERENCES venues(venue_id),
    name                TEXT        NOT NULL,
    target_description  TEXT,
    reward_description  TEXT,
    active_from         TIMESTAMPTZ,
    active_to           TIMESTAMPTZ,
    is_active           BOOLEAN     NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);
CREATE INDEX idx_incentives_venue       ON shift_incentives(venue_id);
CREATE INDEX idx_incentives_client      ON shift_incentives(client_id);

-- ── incentive_scores ─────────────────────────────────────────────────────────
CREATE TABLE incentive_scores (
    score_id        UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID    NOT NULL REFERENCES clients(client_id),
    incentive_id    UUID    NOT NULL REFERENCES shift_incentives(incentive_id),
    staff_id        UUID    NOT NULL REFERENCES staff(staff_id),
    score           INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (incentive_id, staff_id)
);
CREATE INDEX idx_incentive_scores_incentive ON incentive_scores(incentive_id);
CREATE INDEX idx_incentive_scores_client    ON incentive_scores(client_id);

-- ── roster_breaks ─────────────────────────────────────────────────────────────
-- One break window per shift (simple demo model).
CREATE TABLE roster_breaks (
    break_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID        NOT NULL REFERENCES clients(client_id),
    shift_id    UUID        NOT NULL REFERENCES shifts(shift_id),
    break_start TIMESTAMPTZ NOT NULL,
    break_end   TIMESTAMPTZ,
    UNIQUE (shift_id, break_start)
);
CREATE INDEX idx_roster_breaks_shift    ON roster_breaks(shift_id);
CREATE INDEX idx_roster_breaks_client   ON roster_breaks(client_id);

-- ── shift_priorities ─────────────────────────────────────────────────────────
CREATE TABLE shift_priorities (
    priority_id     UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID    NOT NULL REFERENCES clients(client_id),
    venue_id        UUID    NOT NULL,
    shift_id        UUID    NOT NULL REFERENCES shifts(shift_id),
    priority_order  INTEGER NOT NULL CHECK (priority_order BETWEEN 1 AND 3),
    body            TEXT    NOT NULL,
    created_by      UUID    REFERENCES staff(staff_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shift_id, priority_order)
);
CREATE INDEX idx_shift_priorities_shift ON shift_priorities(shift_id);
CREATE INDEX idx_shift_priorities_client ON shift_priorities(client_id);

-- ── shift_handover_notes ──────────────────────────────────────────────────────
CREATE TABLE shift_handover_notes (
    note_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID        NOT NULL REFERENCES clients(client_id),
    venue_id            UUID        NOT NULL REFERENCES venues(venue_id),
    shift_id            UUID        NOT NULL REFERENCES shifts(shift_id),
    author_staff_id     UUID        REFERENCES staff(staff_id),
    body_text           TEXT,
    tags                JSONB       NOT NULL DEFAULT '[]',
    is_locked           BOOLEAN     NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shift_id)
);
CREATE INDEX idx_shn_shift   ON shift_handover_notes(shift_id);
CREATE INDEX idx_shn_venue   ON shift_handover_notes(venue_id);
CREATE INDEX idx_shn_client  ON shift_handover_notes(client_id);

-- ── venue_roles ──────────────────────────────────────────────────────────────
CREATE TABLE venue_roles (
    role_id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID    NOT NULL REFERENCES clients(client_id),
    venue_id        UUID    NOT NULL REFERENCES venues(venue_id),
    label           TEXT    NOT NULL,
    area_group      TEXT    NOT NULL CHECK (area_group IN (
                        'management','bar_foh','gaming','kitchen','bottle_shop','security')),
    is_rsg_required BOOLEAN NOT NULL DEFAULT false,
    is_rsa_required BOOLEAN NOT NULL DEFAULT false,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (venue_id, label)
);
CREATE INDEX idx_venue_roles_venue      ON venue_roles(venue_id);
CREATE INDEX idx_venue_roles_client     ON venue_roles(client_id);

-- ── revenue_daily_budgets ─────────────────────────────────────────────────────
-- Per-channel daily budget targets. Used by the Budget section of the run sheet.
-- channel values match revenue_daily.channel (migration 036).
CREATE TABLE revenue_daily_budgets (
    budget_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     UUID        NOT NULL REFERENCES clients(client_id),
    venue_id      UUID        NOT NULL,
    trade_date    DATE        NOT NULL,
    channel       TEXT        NOT NULL CHECK (channel IN ('gaming','bar','food','tab_keno','bottle_shop')),
    budget_cents  BIGINT      NOT NULL CHECK (budget_cents >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, venue_id, trade_date, channel)
);
CREATE INDEX idx_rdbudgets_venue        ON revenue_daily_budgets(venue_id, trade_date);
CREATE INDEX idx_rdbudgets_client       ON revenue_daily_budgets(client_id);

-- ── compliance_events: add event_data JSONB ───────────────────────────────────
-- Allows gaming understaffing alerts to carry structured {current, minimum} data.
ALTER TABLE compliance_events
    ADD COLUMN IF NOT EXISTS event_data JSONB;

-- =============================================================================
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE compliance_events DROP COLUMN IF EXISTS event_data;
-- DROP TABLE IF EXISTS revenue_daily_budgets;
-- DROP TABLE IF EXISTS venue_roles;
-- DROP TABLE IF EXISTS shift_handover_notes;
-- DROP TABLE IF EXISTS shift_priorities;
-- DROP TABLE IF EXISTS roster_breaks;
-- DROP TABLE IF EXISTS incentive_scores;
-- DROP TABLE IF EXISTS shift_incentives;
-- DROP TABLE IF EXISTS eighty_six_items;
-- DROP TABLE IF EXISTS chef_specials;
-- DROP TABLE IF EXISTS venue_screens;
-- DROP TABLE IF EXISTS sports_events;
-- DROP TABLE IF EXISTS compliance_acknowledgements;
-- DROP TABLE IF EXISTS weather_cache;
-- DROP TABLE IF EXISTS venue_calendar;
-- COMMIT;
-- =============================================================================
