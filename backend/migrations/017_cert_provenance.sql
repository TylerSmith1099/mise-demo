-- =============================================================================
-- Migration 017 — Cert provenance: track whether cert data is live-verified
-- =============================================================================
--
-- WHY: Legal bar set in MIS-160. Seeded/last-known RSA/RCG expiry data must
-- carry a provenance disclosure when shown to staff. We track provenance at
-- the row level so the application layer can gate on it without inventing a
-- new flag concept — the is_stale convention is already established in
-- src/integrations/signal-shape.js.
--
-- DEFAULT TRUE: all existing (seeded) rows are unverified. When a live Deputy
-- Training sync writes a cert record it sets is_stale = false explicitly.
-- A cert row with is_stale = true must never be shown as a bare compliance
-- fact — chat-api.js appends the Legal-approved provenance disclosure instead.
--
-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------

ALTER TABLE certifications
  ADD COLUMN is_stale BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- ALTER TABLE certifications DROP COLUMN is_stale;
