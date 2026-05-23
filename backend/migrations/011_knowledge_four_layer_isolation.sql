-- =============================================================================
-- Migration 011 — Knowledge four-layer isolation (MIS-71 reconciliation)
--
-- WHY (MIS-71 / MIS-76, CEO decision: Option A canonical):
--   The MIS-60-signed canonical knowledge contract isolates knowledge into FOUR
--   layers via `content_type`, with a per-venue `licence_condition` layer that
--   the running `document_chunks` two-layer model (migration 008) cannot express.
--   Per-venue licence-condition isolation is a CLIENT-ISOLATION non-negotiable:
--   a venue must never receive ANOTHER venue's licence conditions, even within
--   the same client. This migration brings the running stack up to the canonical
--   four-layer isolation IN PLACE — no table rename, no re-embed (the offline
--   384 embedding already satisfies AU residency + the demo's zero-network
--   requirement; dimension was explicitly not the deciding factor).
--
-- Adds to document_chunks:
--   * content_type  — the four-layer discriminator (industry_standard |
--                     legislation | licence_condition | sop).
--   * venue_id      — the per-venue key required by the licence_condition layer.
--   * a CHECK that enforces the per-layer column invariants so a mis-tagged
--     chunk (e.g. an SOP carrying another venue's id, or legislation that leaked
--     a client_id) can never be stored.
--
-- Isolation remains enforced at TWO levels, both at query time:
--   1. RLS (migration 008, unchanged) — client_id = app.current_client_id OR
--      client_id IS NULL. Cross-client leakage stays structurally impossible.
--   2. The four-layer predicate in src/rag/retrieve.js — narrows further so a
--      venue only sees its OWN licence conditions and its state's legislation.
-- =============================================================================
SET timezone = 'UTC';

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------

-- 1. New columns. Nullable first so the backfill can populate existing rows
--    before the NOT NULL / CHECK constraints are enforced.
ALTER TABLE document_chunks
    ADD COLUMN IF NOT EXISTS content_type TEXT,
    ADD COLUMN IF NOT EXISTS venue_id     UUID REFERENCES venues (venue_id);

-- 2. Backfill content_type for rows loaded under the two-layer model:
--      shared row (client_id IS NULL)  -> legislation  (statutes, codes, awards;
--                                         national instruments keep venue_state
--                                         NULL — see the legislation invariant)
--      client row (client_id present)  -> sop
--    The two-layer era loaded only statutes/awards as shared rows and SOPs as
--    client rows; it never produced licence_condition or industry_standard
--    chunks. Those arrive only via re-ingest under the four-layer pipeline.
UPDATE document_chunks
   SET content_type = CASE
         WHEN client_id IS NULL THEN 'legislation'
         ELSE                        'sop'
       END
 WHERE content_type IS NULL;

-- 3. Normalise existing SOP rows to the 'sop' invariant (client-scoped, not
--    venue- or state-scoped). Two-layer SOPs may carry a venue_state; clear it
--    so the layer-invariants CHECK below holds. Venue-specific obligations
--    belong to the licence_condition layer, populated on re-ingest.
UPDATE document_chunks
   SET venue_state = NULL
 WHERE content_type = 'sop' AND venue_state IS NOT NULL;

-- 4. Lock the discriminator down: allowed values, NOT NULL, and the per-layer
--    column invariants (mirrors the canonical knowledge_layer_invariants).
ALTER TABLE document_chunks
    ALTER COLUMN content_type SET NOT NULL;

ALTER TABLE document_chunks
    ADD CONSTRAINT document_chunks_content_type_check
        CHECK (content_type IN
            ('industry_standard', 'legislation', 'licence_condition', 'sop'));

ALTER TABLE document_chunks
    ADD CONSTRAINT knowledge_layer_invariants CHECK (
        CASE content_type
          -- industry_standard / legislation are SHARED (client_id NULL) and
          -- never carry a venue_id. legislation may be state-scoped or national
          -- (venue_state NULL = applies to every state), matching the running
          -- stack's national-law convention. (Canonical MIS-60 represents
          -- national legislation as venue_state='National'; the NULL-vs-'National'
          -- representation is flagged for the Knowledge Agent to unify on
          -- re-ingest — it is isolation-safe either way, as both are shared.)
          WHEN 'industry_standard' THEN client_id IS NULL     AND venue_id IS NULL
          WHEN 'legislation'       THEN client_id IS NULL     AND venue_id IS NULL
          -- The non-negotiable: a licence condition is pinned to ONE venue.
          WHEN 'licence_condition' THEN client_id IS NOT NULL AND venue_id IS NOT NULL AND venue_state IS NOT NULL
          WHEN 'sop'               THEN client_id IS NOT NULL AND venue_id IS NULL     AND venue_state IS NULL
        END
    );

-- 5. Indexes fronting the four-layer retrieval predicate (live rows only).
CREATE INDEX IF NOT EXISTS idx_document_chunks_layer
    ON document_chunks (content_type, venue_state)
    WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_document_chunks_venue
    ON document_chunks (venue_id)
    WHERE superseded_at IS NULL;

-- ---------------------------------------------------------------------------
-- DOWN (rollback) — reverses UP in the inverse order. Uncomment to roll back.
-- ---------------------------------------------------------------------------
-- DROP INDEX IF EXISTS idx_document_chunks_venue;
-- DROP INDEX IF EXISTS idx_document_chunks_layer;
-- ALTER TABLE document_chunks DROP CONSTRAINT IF EXISTS knowledge_layer_invariants;
-- ALTER TABLE document_chunks DROP CONSTRAINT IF EXISTS document_chunks_content_type_check;
-- ALTER TABLE document_chunks ALTER COLUMN content_type DROP NOT NULL;
-- ALTER TABLE document_chunks DROP COLUMN IF EXISTS venue_id;
-- ALTER TABLE document_chunks DROP COLUMN IF EXISTS content_type;
