-- =============================================================================
-- Migration 016 — Vendor config column on integration_connections
--
-- Ported from root migrations/013_keypay_config.sql (MIS-103/MIS-159).
-- Renumbered to 016 (after 015_integration_framework which creates the table).
--
-- Adds a JSONB config column to store vendor-specific, non-secret settings
-- alongside the connection row (e.g. KeyPay businessId, Deputy subdomain).
--
-- Rationale: credentials (API keys, tokens) live in integration_credentials;
-- non-secret identifiers needed at sync time belong here rather than in
-- credential storage or application-level hardcoding.
--
-- Additive, non-breaking — existing rows default to '{}'.
-- =============================================================================

SET timezone = 'UTC';

ALTER TABLE integration_connections
    ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
