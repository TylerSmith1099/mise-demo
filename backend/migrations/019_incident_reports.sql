-- =============================================================================
-- Migration 019 — Incident Reports: core table, regulatory obligations, routing
--
-- THREE TABLES
-- ------------
-- incident_reports            — the canonical incident record; pre-populated
--                               from RSA triage answers via triage_answers JSONB.
-- incident_reporting_obligations — per-incident regulatory reporting flags
--                               (OLGR, Austrac TTR/SMR, WorkSafe, Police,
--                               In-house) with fulfillment tracking.
-- incident_notifications      — auto-routing audit log: who was notified on
--                               submission, by what method, and when they acked.
--
-- CLIENT ISOLATION
-- ----------------
-- Every table carries client_id. RLS policies are in migration 020.
-- No FK ever crosses a client boundary. All timestamps UTC; app layer converts
-- to venue timezone for display.
--
-- SEVERITY LEVELS (L1–L4, from RSA Response Redesign MIS-376/MIS-378)
-- --------------------------------------------------------------------
--   L1  info     — internal log only, no escalation
--   L2  warning  — Venue Manager alerted on submission
--   L3  critical — Area Manager / Group Ops alerted
--   L4  emergency — CEO + Compliance Officer alerted; mandatory external reporting
--
-- INCIDENT TYPES (field list subject to lock after MIS-378)
-- ----------------------------------------------------------
--   intoxicated_patron_refused | patron_asked_to_leave_complied
--   patron_asked_to_leave_refused | serious_assault | death_on_premises
--   medical_emergency | self_exclusion_breach | cash_threshold_10k
--   suspicious_transaction | armed_robbery | threat_extortion
--   workplace_injury_staff
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- incident_reports — the primary record created (or pre-populated) from a triage
-- conversation. Soft-deleted; status tracks draft → submitted → acknowledged.
CREATE TABLE incident_reports (
    incident_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id                UUID NOT NULL REFERENCES clients (client_id),
    venue_id                 UUID NOT NULL,
    reported_by_staff_id     UUID NOT NULL,           -- staff who logged it

    -- Classification
    incident_type            TEXT NOT NULL CHECK (incident_type IN (
                                 'intoxicated_patron_refused',
                                 'patron_asked_to_leave_complied',
                                 'patron_asked_to_leave_refused',
                                 'serious_assault',
                                 'death_on_premises',
                                 'medical_emergency',
                                 'self_exclusion_breach',
                                 'cash_threshold_10k',
                                 'suspicious_transaction',
                                 'armed_robbery',
                                 'threat_extortion',
                                 'workplace_injury_staff'
                             )),
    severity_level           SMALLINT NOT NULL CHECK (severity_level BETWEEN 1 AND 4),

    -- Timing and location (mandatory per Liquor Act 1992 QLD incident register)
    incident_at              TIMESTAMPTZ NOT NULL,
    location_in_venue        TEXT NOT NULL,

    -- Core narrative fields (mandatory per SOP)
    description              TEXT NOT NULL,
    immediate_action_taken   TEXT NOT NULL,

    -- Persons involved
    patron_name              TEXT,                    -- nullable; known if patron was identified
    patron_description       TEXT,                    -- gender / age / clothing / distinguishing features
    witnesses                TEXT,                    -- free text; names if known

    -- Physical consequences
    injuries_or_damage       TEXT,

    -- Emergency service contacts
    police_called            BOOLEAN NOT NULL DEFAULT FALSE,
    police_reference         TEXT,                    -- incident/event number from police
    ambulance_called         BOOLEAN NOT NULL DEFAULT FALSE,
    ambulance_reference      TEXT,

    -- Duty Manager
    duty_manager_notified_at TIMESTAMPTZ,
    duty_manager_staff_id    UUID,                    -- nullable FK resolved at submission

    -- Triage pre-population (RSA conversation that triggered this report)
    triage_conversation_id   UUID,                    -- FK to conversations(conversation_id)
    triage_answers           JSONB,                   -- snapshot of answers at pre-population time

    -- Lifecycle
    status                   TEXT NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft','submitted','acknowledged')),
    submitted_at             TIMESTAMPTZ,
    acknowledged_at          TIMESTAMPTZ,
    acknowledged_by_staff_id UUID,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at               TIMESTAMPTZ,

    FOREIGN KEY (client_id, venue_id)                    REFERENCES venues (client_id, venue_id),
    FOREIGN KEY (client_id, reported_by_staff_id)        REFERENCES staff  (client_id, staff_id),
    FOREIGN KEY (client_id, duty_manager_staff_id)       REFERENCES staff  (client_id, staff_id),
    FOREIGN KEY (client_id, acknowledged_by_staff_id)    REFERENCES staff  (client_id, staff_id),
    FOREIGN KEY (triage_conversation_id)                 REFERENCES conversations (conversation_id)
);
CREATE INDEX idx_incident_reports_client        ON incident_reports (client_id);
CREATE INDEX idx_incident_reports_venue         ON incident_reports (client_id, venue_id);
CREATE INDEX idx_incident_reports_type_severity ON incident_reports (client_id, incident_type, severity_level);
CREATE INDEX idx_incident_reports_status        ON incident_reports (client_id, status) WHERE deleted_at IS NULL;

-- incident_reporting_obligations — one row per external or internal obligation
-- auto-created on incident submission based on incident_type (see mapping doc).
-- obligation_type values:
--   olgr_notifiable   — OLGR serious assault/death/gaming/self-exclusion breach
--   austrac_ttr       — Threshold Transaction Report ($10k+ cash)
--   austrac_smr       — Suspicious Matter Report
--   worksafe_notifiable — WorkSafe QLD (death / serious injury / dangerous incident)
--   police_notifiable — Liquor Act / assault / robbery
--   in_house          — internal record (always created)
CREATE TABLE incident_reporting_obligations (
    obligation_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id          UUID NOT NULL REFERENCES incident_reports (incident_id),
    client_id            UUID NOT NULL REFERENCES clients (client_id),

    obligation_type      TEXT NOT NULL CHECK (obligation_type IN (
                             'olgr_notifiable',
                             'austrac_ttr',
                             'austrac_smr',
                             'worksafe_notifiable',
                             'police_notifiable',
                             'in_house'
                         )),

    -- Due-by is calculated on submission (e.g. WorkSafe = immediately; AUSTRAC TTR = 10 business days)
    due_by               TIMESTAMPTZ,

    fulfilled_at         TIMESTAMPTZ,
    fulfilled_by_staff_id UUID,
    reference_number     TEXT,                        -- OLGR case #, AUSTRAC report #, police event #
    notes                TEXT,

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (client_id, fulfilled_by_staff_id) REFERENCES staff (client_id, staff_id),
    UNIQUE (incident_id, obligation_type)            -- one row per type per incident
);
CREATE INDEX idx_incident_obligations_incident  ON incident_reporting_obligations (incident_id);
CREATE INDEX idx_incident_obligations_client    ON incident_reporting_obligations (client_id);
CREATE INDEX idx_incident_obligations_unfulfilled ON incident_reporting_obligations (client_id, due_by)
    WHERE fulfilled_at IS NULL;

-- incident_notifications — routing audit log; one row per person/role notified
-- at the moment of submission. Populated by the application layer from the
-- incident_type → notification_routing matrix defined in the mapping doc.
CREATE TABLE incident_notifications (
    notification_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id          UUID NOT NULL REFERENCES incident_reports (incident_id),
    client_id            UUID NOT NULL REFERENCES clients (client_id),

    -- The role that was targeted (matches routing matrix)
    notification_role    TEXT NOT NULL CHECK (notification_role IN (
                             'venue_manager',
                             'area_manager',
                             'group_ops',
                             'compliance_officer',
                             'ceo'
                         )),

    -- Resolved staff member (nullable; some roles may not be filled for a venue)
    notified_staff_id    UUID,

    notification_method  TEXT NOT NULL CHECK (notification_method IN ('in_app','sms','email')),
    sent_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at      TIMESTAMPTZ,

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (client_id, notified_staff_id) REFERENCES staff (client_id, staff_id)
);
CREATE INDEX idx_incident_notifications_incident ON incident_notifications (incident_id);
CREATE INDEX idx_incident_notifications_client   ON incident_notifications (client_id);

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS incident_notifications;
-- DROP TABLE IF EXISTS incident_reporting_obligations;
-- DROP TABLE IF EXISTS incident_reports;
