-- =============================================================================
-- Migration 003 — Compliance: events & certifications
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- compliance_events — RSA/RG/cert compliance signals. staff_id is nullable for
-- venue-level events that are not tied to an individual staff member.
CREATE TABLE compliance_events (
    event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES clients (client_id),
    venue_id        UUID NOT NULL,
    staff_id        UUID,            -- nullable: venue-level events have no staff
    event_type      TEXT NOT NULL,   -- e.g. RSA_alert, RG_patron_interaction, certification_expiry
    severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
    description     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID,            -- nullable FK to staff (same client)
    deleted_at      TIMESTAMPTZ,
    FOREIGN KEY (client_id, venue_id)        REFERENCES venues (client_id, venue_id),
    FOREIGN KEY (client_id, staff_id)        REFERENCES staff (client_id, staff_id),
    FOREIGN KEY (client_id, acknowledged_by) REFERENCES staff (client_id, staff_id)
);
CREATE INDEX idx_compliance_events_client ON compliance_events (client_id);
CREATE INDEX idx_compliance_events_venue ON compliance_events (client_id, venue_id);

-- certifications — staff certificates (RSA/RSG/Food Safety) and their validity.
CREATE TABLE certifications (
    cert_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id  UUID NOT NULL REFERENCES clients (client_id),
    staff_id   UUID NOT NULL,
    cert_type  TEXT NOT NULL,  -- e.g. RSA, RSG, Food Safety
    issued_at  TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status     TEXT NOT NULL DEFAULT 'current'
                 CHECK (status IN ('current','expiring_soon','expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    FOREIGN KEY (client_id, staff_id) REFERENCES staff (client_id, staff_id)
);
CREATE INDEX idx_certifications_client ON certifications (client_id);
CREATE INDEX idx_certifications_staff ON certifications (client_id, staff_id);

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS certifications;
-- DROP TABLE IF EXISTS compliance_events;
