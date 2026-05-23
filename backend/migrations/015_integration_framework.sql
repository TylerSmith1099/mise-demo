-- =============================================================================
-- Migration 015 — Integration Framework
--
-- Ported from root migrations/012_integration_framework.sql (MIS-103/MIS-159).
-- Renumbered to 015 because MISE/backend 012–014 were already taken.
--
-- Adds the shared foundation every external connector sits on:
--   • integration_connections — one row per (client, vendor) connection.
--   • integration_credentials — encrypted-at-rest OAuth tokens / API keys.
--   • integration_sync_log   — idempotent sync audit trail.
--
-- CLIENT ISOLATION (mandatory per architecture):
--   Every table carries client_id + RLS, identical to the pattern in 005.
--   connection A data is structurally invisible under client B.
--
-- CREDENTIAL SECURITY:
--   Tokens are stored as opaque ciphertext. The encryption key never enters
--   the database — it lives in MISE_CREDENTIAL_ENCRYPTION_KEY env var only.
--   The schema stores: algorithm tag, iv, auth_tag, ciphertext — everything
--   the app layer needs to decrypt, nothing that helps an attacker who only
--   has a DB dump.
--
-- SOFT-DELETES ONLY — no DELETE grant on mise_app, status columns instead.
-- ALL TIMESTAMPS UTC — venue timezone conversion happens in the app layer.
-- =============================================================================

SET timezone = 'UTC';

-- ---------------------------------------------------------------------------
-- integration_connections
-- One row = one active (or disabled) connection between a client and a vendor.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_connections (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID        NOT NULL REFERENCES clients(client_id),
    vendor              TEXT        NOT NULL,           -- e.g. 'deputy', 'keypay'
    display_name        TEXT        NOT NULL DEFAULT '', -- human label, e.g. venue name
    status              TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','disabled','error')),
    -- last sync outcome
    last_synced_at      TIMESTAMPTZ,
    last_sync_status    TEXT        CHECK (last_sync_status IN ('ok','partial','failed', NULL)),
    last_sync_error     TEXT,
    -- staleness marker — set when falling back to seeded / last-known data
    is_stale            BOOLEAN     NOT NULL DEFAULT false,
    stale_since         TIMESTAMPTZ,
    stale_reason        TEXT,
    -- soft-delete support
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, vendor)                          -- one connection per vendor per client
);

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connections FORCE  ROW LEVEL SECURITY;
CREATE POLICY integration_connections_isolation ON integration_connections
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON integration_connections TO mise_app;

-- ---------------------------------------------------------------------------
-- integration_credentials
-- Stores encrypted-at-rest secrets for a connection.
-- One row = one logical credential (access token, refresh token, api key, …).
-- The app layer encrypts before INSERT and decrypts after SELECT.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_credentials (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id   UUID        NOT NULL REFERENCES integration_connections(id),
    client_id       UUID        NOT NULL REFERENCES clients(client_id), -- denormalised for RLS
    credential_type TEXT        NOT NULL
                        CHECK (credential_type IN ('access_token','refresh_token','api_key','partner_key')),
    -- Envelope encryption fields — algorithm, iv, auth_tag, ciphertext are all
    -- required; the app rejects any credential row that lacks any of them.
    enc_algorithm   TEXT        NOT NULL DEFAULT 'aes-256-gcm',
    enc_iv          TEXT        NOT NULL,   -- hex-encoded 12-byte IV
    enc_auth_tag    TEXT        NOT NULL,   -- hex-encoded 16-byte GCM auth tag
    enc_ciphertext  TEXT        NOT NULL,   -- hex-encoded ciphertext
    -- token lifecycle
    expires_at      TIMESTAMPTZ,            -- NULL = no expiry (e.g. API keys)
    is_expired      BOOLEAN     NOT NULL DEFAULT false,
    -- soft-delete / rotation: mark old tokens superseded rather than deleting
    superseded_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_credentials FORCE  ROW LEVEL SECURITY;
CREATE POLICY integration_credentials_isolation ON integration_credentials
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON integration_credentials TO mise_app;

-- ---------------------------------------------------------------------------
-- integration_sync_log
-- Idempotent sync audit trail. Each scheduled sync run appends a row.
-- Used for backoff, staleness detection, and debugging.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_sync_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id   UUID        NOT NULL REFERENCES integration_connections(id),
    client_id       UUID        NOT NULL REFERENCES clients(client_id),
    idempotency_key TEXT        NOT NULL,   -- {vendor}:{client_id}:{ISO-date} — prevents double-runs
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    status          TEXT        CHECK (status IN ('running','ok','partial','failed')),
    records_fetched INT,
    error_detail    TEXT,
    UNIQUE (idempotency_key)
);

ALTER TABLE integration_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY integration_sync_log_isolation ON integration_sync_log
    USING      (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid)
    WITH CHECK (client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON integration_sync_log TO mise_app;

-- ---------------------------------------------------------------------------
-- Trigger: auto-bump updated_at on integration_connections
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_integration_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_integration_connections_updated_at
    BEFORE UPDATE ON integration_connections
    FOR EACH ROW EXECUTE FUNCTION update_integration_updated_at();

CREATE TRIGGER trg_integration_credentials_updated_at
    BEFORE UPDATE ON integration_credentials
    FOR EACH ROW EXECUTE FUNCTION update_integration_updated_at();
