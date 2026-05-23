-- =============================================================================
-- Migration 008 — RAG layer: pgvector + document_chunks (knowledge base)
--
-- Stage 3 of the build (Knowledge Agent). Sits on top of the Database + Auth
-- isolation model: the same `app.current_client_id` RLS contract from migration
-- 005 is applied here, with ONE difference required by the knowledge domain —
-- shared legislation rows carry client_id IS NULL and are visible to every
-- client. So the visibility rule is:
--
--     client_id = app.current_client_id   (this client's own SOPs)
--   OR client_id IS NULL                   (shared legislation — all clients)
--
-- A client never sees ANOTHER client's chunks; it only ever additionally sees
-- the shared (NULL) legislation. Enforced at query time by RLS, every time.
--
-- EMBEDDINGS: vector(384). 384 matches common sentence-embedding models
-- (e.g. all-MiniLM-L6-v2), so the production embedding service can be swapped
-- in at the deploy stage without a schema change. The dimension is a deliberate
-- contract between this migration and src/rag/embedding.js (EMBEDDING_DIM).
--
-- SUPERSEDING: documents are never hard-deleted (consistent with the soft-delete
-- convention). When a source is re-ingested, the old rows are stamped
-- `superseded_at` and excluded from retrieval, but retained for audit.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

-- pgvector. Reversible (see DOWN). Requires the `vector` extension to be
-- installed on the server (built for this Postgres major version).
CREATE EXTENSION IF NOT EXISTS vector;

-- document_chunks — one retrievable unit of knowledge.
--   client_id NULL  -> shared legislation (visible to all clients)
--   client_id UUID  -> a specific client's SOP (visible only to that client)
CREATE TABLE document_chunks (
    chunk_id     TEXT PRIMARY KEY,                 -- stable business id, e.g. rg-code-2024-s3.4-001
    source       TEXT NOT NULL,                    -- "QLD Responsible Gambling Code of Practice 2024"
    section      TEXT,                             -- "3.4 — Interaction with Excluded Patrons"
    content      TEXT NOT NULL,                    -- the chunk text passed to the product agent
    client_id    UUID REFERENCES clients (client_id),  -- NULL = shared legislation
    venue_state  TEXT CHECK (venue_state IN ('QLD','NSW','VIC','SA','WA','TAS','NT','ACT')),
                                                   -- NULL = applies to every state (e.g. national law)
    last_updated DATE,                             -- currency of the source document
    token_count  INTEGER,                          -- chunk size at ingest (300–600 target)
    embedding    vector(384) NOT NULL,             -- deterministic-local now; prod model swaps in at deploy
    superseded_at TIMESTAMPTZ,                      -- NULL = live; non-NULL = archived prior version
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approximate-NN index for fast top-k cosine retrieval. HNSW needs no training
-- data (unlike ivfflat), so it works on a small/empty table and as it grows.
-- Embeddings are L2-normalised at ingest, so cosine is the right operator class.
CREATE INDEX idx_document_chunks_embedding
    ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- Metadata filters used alongside the vector search.
CREATE INDEX idx_document_chunks_client ON document_chunks (client_id);
CREATE INDEX idx_document_chunks_state  ON document_chunks (venue_state);
CREATE INDEX idx_document_chunks_source ON document_chunks (source);
-- Live rows only (most queries filter superseded_at IS NULL).
CREATE INDEX idx_document_chunks_live ON document_chunks (chunk_id) WHERE superseded_at IS NULL;

-- RLS — identical mechanism to migration 005, extended with the NULL-is-shared
-- rule. Secure default remains "see nothing": an unset variable yields NULL and
-- the first disjunct is false; only the explicit `client_id IS NULL` shared rows
-- would still show, which is correct (legislation is public to all tenants).
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE  ROW LEVEL SECURITY;

CREATE POLICY client_isolation ON document_chunks
    USING (
        client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
        OR client_id IS NULL
    )
    WITH CHECK (
        -- A client may only write its OWN chunks. Shared legislation (client_id
        -- IS NULL) is loaded by the ingestion pipeline running as the table owner
        -- (not under the mise_app role), so tenants cannot inject shared rows.
        client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
    );

-- mise_app already holds SELECT/INSERT/UPDATE via the ALTER DEFAULT PRIVILEGES
-- in migration 005 (it runs before this migration), and intentionally has no
-- DELETE grant — superseding is an UPDATE of superseded_at, not a delete.

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP POLICY IF EXISTS client_isolation ON document_chunks;
-- DROP INDEX IF EXISTS idx_document_chunks_live;
-- DROP INDEX IF EXISTS idx_document_chunks_source;
-- DROP INDEX IF EXISTS idx_document_chunks_state;
-- DROP INDEX IF EXISTS idx_document_chunks_client;
-- DROP INDEX IF EXISTS idx_document_chunks_embedding;
-- DROP TABLE IF EXISTS document_chunks;
-- DROP EXTENSION IF EXISTS vector;
