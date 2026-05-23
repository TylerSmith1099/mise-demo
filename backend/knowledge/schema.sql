-- =============================================================================
-- MISE — Knowledge / RAG layer schema (pgvector + document_chunks)
-- FOUR-LAYER content model. AUTHORITATIVE DDL for the vector store.
--
-- ARCHITECTURE (updated — four content layers, content_type on every chunk):
--   1. industry_standard   — generic hospitality best-practice. Visible to ALL.
--   2. legislation         — public law, scoped by venue_state (NULL = national).
--   3. licence_condition   — venue-specific licence terms, scoped by venue_id.
--   4. sop                 — client-authored procedures, scoped by client_id.
--
-- Every chunk carries `content_type` and the scoping key for its layer. The
-- other scoping columns are NULL for that layer.
--
-- AU DATA RESIDENCY: pgvector lives in the SAME PostgreSQL instance as the
-- relational schema. No separate vector service; no data leaves AWS
-- ap-southeast-* (AU).
--
-- FOUR-LAYER RETRIEVAL FILTER (non-negotiable, enforced at query time, EVERY
-- query, via RLS). A row is visible iff:
--     content_type = 'industry_standard'
--  OR (content_type = 'legislation'       AND venue_state matches the venue)
--  OR (content_type = 'licence_condition' AND venue_id    = this venue)
--  OR (content_type = 'sop'               AND client_id   = this client)
--
--   Bound from the verified session via GUCs (never user input):
--     app.current_client_id, app.current_venue_id, app.current_venue_state.
--   Fail-closed: unset GUCs -> NULL -> match nothing but industry_standard.
--   A QLD venue can never see another client's SOP, another venue's licence
--   condition, or an NSW-only legislative chunk.
--
-- EMBEDDINGS: vector(384) — the dimension contract shared with the canonical
-- embedder src/rag/embedding.js (EMBEDDING_DIM=384) and the live migration
-- 008. ingest.js / retrieve.js / ingest-legislation.py all embed through that
-- one function so ingest-time and query-time vectors are identical. The deploy
-- stage swaps in an AU-hosted semantic model at the SAME dimension (384 matches
-- all-MiniLM-L6-v2) so this column needs no change.
--
-- NOTE: this four-layer table SUPERSEDES the two-layer table in migration 008.
-- It is applied via a new numbered migration (the schema here is the source of
-- truth for that migration); they are kept in lockstep — change both together.
--
-- SUPERSEDING: chunks are never hard-deleted. A re-ingested source stamps the
-- prior live rows `superseded_at` and excludes them from retrieval, retaining
-- them for the compliance audit trail.
--
-- HYBRID SEARCH (MIS-72): retrieval fuses dense vector cosine with BM25-style
-- lexical full-text ranking (Reciprocal Rank Fusion), so a query that shares
-- exact statutory terminology with a clause ("gaming nominee", "s55") is not
-- lost when the deterministic-local embedder under-weights it, and a clause that
-- is semantically close but lexically different is not lost by full-text alone.
-- Two columns support this:
--   * content_tsv — a GENERATED tsvector over context+section+source+content,
--     GIN-indexed; this is the lexical (BM25-style) side. We use Postgres native
--     full-text ranking (ts_rank_cd, cover density) rather than adding the rum /
--     pg_search extension — RRF over ranks makes the absolute score units moot,
--     and it keeps the MVP dependency-free. Deploy flag: swap ts_rank_cd for a
--     true Okapi BM25 via pg_search/ParadeDB if lexical precision needs lifting.
--   * context — a one-sentence retrieval blurb ("This excerpt from the Gaming
--     Machine Act 1991 (QLD) … defines the obligations of gaming nominees …")
--     prepended to the chunk BEFORE embedding (contextual retrieval), so section
--     context is baked into both the vector and the lexical index. The raw
--     `content` returned to the product agent is unchanged — citation integrity
--     is preserved; only the indexed representation is enriched.
-- =============================================================================

SET timezone = 'UTC';

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
    chunk_id      TEXT PRIMARY KEY,                -- stable business id, e.g. qld-gma-1991-s55-001
    source        TEXT NOT NULL,                   -- "Queensland Gaming Machine Act 1991"
    section       TEXT,                            -- "s55 — Gaming machine areas"
    content       TEXT NOT NULL,                   -- chunk text passed to the product agent (raw, cited verbatim)
    context       TEXT,                            -- one-sentence retrieval blurb prepended before embedding (contextual retrieval); NOT shown to the user
    content_type  TEXT NOT NULL
        CHECK (content_type IN ('industry_standard','legislation','licence_condition','sop')),
    client_id     UUID,                            -- set iff content_type = 'sop'
    venue_id      UUID,                            -- set iff content_type = 'licence_condition'
    venue_state   TEXT CHECK (venue_state IN ('QLD','NSW','VIC','SA','WA','TAS','NT','ACT')),
                                                   -- set for legislation; NULL = national
    last_updated  DATE,                            -- currency of the source document
    token_count   INTEGER,                         -- chunk size at ingest (300–600 target)
    embedding     vector(384) NOT NULL,            -- contract with src/rag/embedding.js EMBEDDING_DIM=384
    -- Lexical (BM25-style) side of hybrid search. Generated, so it can never
    -- drift from the columns it indexes. 'english' config is immutable, so it is
    -- legal in a GENERATED expression. context is weighted with content/section/
    -- source so the contextual blurb participates in lexical ranking too.
    content_tsv   tsvector GENERATED ALWAYS AS (
                      to_tsvector('english',
                          coalesce(context, '') || ' ' ||
                          coalesce(section, '') || ' ' ||
                          coalesce(source,  '') || ' ' ||
                          coalesce(content, ''))
                  ) STORED,
    superseded_at TIMESTAMPTZ,                      -- NULL = live; non-NULL = archived prior version
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Each layer must carry exactly its own scoping key and no foreign ones.
    CONSTRAINT chunk_layer_scoping CHECK (
        (content_type = 'industry_standard'
            AND client_id IS NULL AND venue_id IS NULL AND venue_state IS NULL)
     OR (content_type = 'legislation'
            AND client_id IS NULL AND venue_id IS NULL)
     OR (content_type = 'licence_condition'
            AND venue_id IS NOT NULL AND client_id IS NULL AND venue_state IS NULL)
     OR (content_type = 'sop'
            AND client_id IS NOT NULL AND venue_id IS NULL AND venue_state IS NULL)
    )
);

-- Approximate-NN index for fast top-k cosine retrieval. HNSW needs no training
-- data, so it works on a small/empty table and scales as it grows. Embeddings
-- are L2-normalised at ingest, so cosine is the right operator class.
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
    ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- Metadata filters used alongside the vector search (four-layer isolation).
CREATE INDEX IF NOT EXISTS idx_document_chunks_type   ON document_chunks (content_type);
CREATE INDEX IF NOT EXISTS idx_document_chunks_client ON document_chunks (client_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_venue  ON document_chunks (venue_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_state  ON document_chunks (venue_state);
CREATE INDEX IF NOT EXISTS idx_document_chunks_source ON document_chunks (source);
-- Full-text (BM25-style) lexical index for the hybrid-search lexical leg.
CREATE INDEX IF NOT EXISTS idx_document_chunks_tsv
    ON document_chunks USING gin (content_tsv);
-- Live rows only (every retrieval filters superseded_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_document_chunks_live
    ON document_chunks (chunk_id) WHERE superseded_at IS NULL;

-- RLS — the four-layer filter. Secure default is "see only industry_standard":
-- an unset GUC yields NULL, so the legislation/licence/sop disjuncts are false.
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS four_layer_isolation ON document_chunks;
CREATE POLICY four_layer_isolation ON document_chunks
    USING (
        content_type = 'industry_standard'
        OR (
            content_type = 'legislation'
            AND (
                venue_state IS NULL
                OR venue_state = NULLIF(current_setting('app.current_venue_state', true), '')
            )
        )
        OR (
            content_type = 'licence_condition'
            AND venue_id = NULLIF(current_setting('app.current_venue_id', true), '')::uuid
        )
        OR (
            content_type = 'sop'
            AND client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
        )
    )
    WITH CHECK (
        -- A tenant may only write its OWN sop rows. industry_standard,
        -- legislation and licence_condition are loaded by the ingestion
        -- pipeline running as the maintenance/owner role (NOT mise_app), so
        -- tenants cannot inject shared or cross-venue rows.
        content_type = 'sop'
        AND client_id = NULLIF(current_setting('app.current_client_id', true), '')::uuid
    );

-- mise_app holds SELECT/INSERT/UPDATE and intentionally has NO DELETE grant —
-- superseding is an UPDATE of superseded_at, never a delete.
