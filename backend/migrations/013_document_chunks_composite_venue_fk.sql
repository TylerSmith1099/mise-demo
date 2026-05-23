-- =============================================================================
-- Migration 013 — document_chunks.venue_id composite-FK hardening (MIS-101)
--
-- WHY (QA recommendation, MIS-98):
--   Migration 011 added `document_chunks.venue_id` as a SINGLE-column FK
--   (`REFERENCES venues (venue_id)`). Every other client-scoped table in the
--   schema — staff, conversations, compliance_events, shifts, and the demo
--   dataset (001/002/003/004/009) — pins its venue with a COMPOSITE
--   `(client_id, venue_id) REFERENCES venues (client_id, venue_id)`. The
--   single-column FK on document_chunks was the lone exception.
--
--   The single-column FK only proves the venue_id EXISTS; it does not prove the
--   venue belongs to the row's own client. So a `licence_condition` chunk could,
--   in principle, be written with this client's client_id but ANOTHER client's
--   venue_id and still satisfy the FK. RLS (migration 008) + the four-layer
--   retrieve predicate already make this unreachable at query time (QA verified
--   no leak in MIS-98), but defense-in-depth says the data layer should make a
--   cross-client venue pin structurally impossible at WRITE time too — matching
--   the rest of the schema. This migration closes that last gap.
--
-- WHAT:
--   Replace the single-column FK with the composite
--   `(client_id, venue_id) REFERENCES venues (client_id, venue_id)`.
--   The `venues` UNIQUE (client_id, venue_id) target already exists (migration
--   001), so this is the identical pattern used by every sibling table.
--
-- MATCH SIMPLE (the Postgres default) is intentional and required here:
--   document_chunks holds rows where one or both FK columns are NULL by design,
--   per the migration-011 knowledge_layer_invariants CHECK:
--     * legislation / industry_standard -> client_id NULL, venue_id NULL
--     * sop                             -> client_id set,  venue_id NULL
--     * licence_condition               -> client_id set,  venue_id set
--   Under MATCH SIMPLE a composite FK is checked ONLY when EVERY column is
--   non-NULL, so legislation and sop rows skip the FK (correct — they are not
--   venue-pinned), and ONLY licence_condition rows — the per-venue isolation
--   non-negotiable — get the composite check enforced. MATCH FULL would wrongly
--   reject the valid sop case (client_id set, venue_id NULL), so it is not used.
--
-- Additive and non-destructive to data: no columns added or dropped, no rows
-- rewritten. Existing licence_condition rows (none yet under the two-layer
-- backfill; they arrive only on four-layer re-ingest) already satisfy the
-- composite target because their (client_id, venue_id) was seeded from venues.
--
-- Kept in lockstep with MISE/backend/knowledge/schema.sql (the canonical
-- document_chunks DDL reference): the composite FK should be reflected there on
-- the next knowledge rebaseline. Flagged in the MIS-101 issue thread.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- 1. Drop the single-column FK created inline by migration 011. The inline
--    `venue_id UUID REFERENCES venues (venue_id)` produces Postgres' conventional
--    auto-name `document_chunks_venue_id_fkey`. IF EXISTS keeps this idempotent
--    and safe if the constraint was ever renamed/absent.
ALTER TABLE document_chunks
    DROP CONSTRAINT IF EXISTS document_chunks_venue_id_fkey;

-- 2. Add the composite FK — the same (client_id, venue_id) pin every other
--    client-scoped table uses. NOT VALID is unnecessary here (the table is small
--    and existing rows already satisfy it), so we validate inline.
ALTER TABLE document_chunks
    ADD CONSTRAINT document_chunks_client_venue_fkey
        FOREIGN KEY (client_id, venue_id)
        REFERENCES venues (client_id, venue_id);

-- ---------------------------------------------------------------------------
-- DOWN (rollback) — reverses UP in inverse order. Uncomment to roll back.
-- Restores the migration-011 single-column FK.
-- ---------------------------------------------------------------------------
-- ALTER TABLE document_chunks DROP CONSTRAINT IF EXISTS document_chunks_client_venue_fkey;
-- ALTER TABLE document_chunks
--     ADD CONSTRAINT document_chunks_venue_id_fkey
--         FOREIGN KEY (venue_id) REFERENCES venues (venue_id);
