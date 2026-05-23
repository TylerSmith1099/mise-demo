-- =============================================================================
-- Migration 012 — RAG hybrid search + contextual retrieval (MIS-72)
--
-- Upgrades the knowledge layer from pure vector search to HYBRID retrieval:
-- dense vector cosine + BM25-style lexical full-text, fused with Reciprocal
-- Rank Fusion at query time (retrieve.js). Pure vector can surface a plausible
-- but WRONG section of the Gaming Machine Act and cite it with confidence; the
-- lexical leg anchors retrieval to exact statutory terminology ("gaming
-- nominee", "s55"), and contextual retrieval bakes section context into the
-- embedding so it is not lost at chunk boundaries.
--
-- Kept in lockstep with MISE/backend/knowledge/schema.sql (the source of truth
-- for the document_chunks DDL). Two additive columns + one GIN index:
--   * context      — one-sentence retrieval blurb, prepended to the chunk text
--                    BEFORE embedding (contextual retrieval). Not user-facing;
--                    the raw `content` is still cited verbatim.
--   * content_tsv  — GENERATED tsvector over context+section+source+content,
--                    GIN-indexed: the lexical (BM25-style) leg. We use Postgres
--                    native full-text (ts_rank_cd) rather than adding rum /
--                    pg_search; RRF over ranks makes absolute score units moot.
--
-- Additive and non-destructive: existing rows get context = NULL and a tsvector
-- built from their existing content/section/source. Re-ingesting a source
-- (ingest.js / ingest-legislation.py) backfills `context` and re-embeds with
-- the blurb prepended.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------
SET timezone = 'UTC';

ALTER TABLE document_chunks
    ADD COLUMN IF NOT EXISTS context TEXT;

-- 'english' config is immutable, so to_tsvector(...) is legal in a GENERATED
-- expression. context participates so the contextual blurb is lexically ranked.
ALTER TABLE document_chunks
    ADD COLUMN IF NOT EXISTS content_tsv tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english',
            coalesce(context, '') || ' ' ||
            coalesce(section, '') || ' ' ||
            coalesce(source,  '') || ' ' ||
            coalesce(content, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_document_chunks_tsv
    ON document_chunks USING gin (content_tsv);

-- ---------------------------------------------------------------------------
-- DOWN (rollback)
-- ---------------------------------------------------------------------------
-- DROP INDEX IF EXISTS idx_document_chunks_tsv;
-- ALTER TABLE document_chunks DROP COLUMN IF EXISTS content_tsv;
-- ALTER TABLE document_chunks DROP COLUMN IF EXISTS context;
