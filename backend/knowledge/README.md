# `knowledge/` — canonical RAG DDL + ingestion reference (KEEP — not dead code)

**Status (MIS-101 review, 2026-05-22): retained deliberately. Do not delete.**

## What this is

This directory is the **canonical source-of-truth reference** for the knowledge /
RAG layer's data model and ingestion contract:

- `schema.sql` — the canonical `document_chunks` DDL (pgvector `vector(384)`,
  four-layer `content_type`, hybrid `content_tsv`). The numbered migrations in
  `../migrations/` (008 / 011 / 012 / 013) are maintained **in lockstep** with
  this file — their headers say so explicitly. The migrations are what actually
  *runs*; `schema.sql` is the single readable definition the migrations mirror.
- `ingest.js`, `retrieve.js`, `ingest-legislation.py` — reference ingestion /
  retrieval implementations for the same model.

## Why it is NOT imported by the running server (and that's expected)

The live Express server imports `../src/rag/*` (`embedding.js`, `ingest.js`,
`retrieve.js`, `synthesize.js`), **not** `knowledge/*`. That is by design:
`src/rag/*` is the running implementation; `knowledge/*` is the canonical spec it
is checked against. Both target the **same** table and the **same** 384-dim
embedding contract (`EMBEDDING_DIM=384`) — they are not two competing models.

> Historical note: an earlier MIS-71 framing referred to `knowledge/*` as the
> "`knowledge_chunks` / 1024" line. That is **outdated** — `schema.sql` here is
> `document_chunks` / `vector(384)`, reconciled to the running stack. The CEO's
> Option-A decision (MIS-71/MIS-98) was settled in place on `document_chunks`/384;
> a literal 1024 rebaseline remains an *optional* future enhancement, not a
> requirement. Any stale "1024" comments still in `scripts/*` should be corrected
> on the next touch.

## Maintenance rule

When a migration changes the `document_chunks` shape, reflect it here too (that is
the lockstep contract). Outstanding: **migration 013** (MIS-101) hardened
`document_chunks.venue_id` to a composite `(client_id, venue_id)` FK; `schema.sql`
should pick this up on the next knowledge rebaseline.
