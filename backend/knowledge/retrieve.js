// =============================================================================
// MISE — Knowledge retrieval: HYBRID search (dense vector + BM25-style lexical)
// fused with Reciprocal Rank Fusion, under the FOUR-LAYER isolation filter.
//
// WHY HYBRID (MIS-72): pure vector search can surface a plausible but WRONG
// section of the Gaming Machine Act and Mise would cite it with confidence. The
// lexical (full-text) leg anchors retrieval to exact statutory terminology
// ("gaming nominee", "s55") that the deterministic-local embedder under-weights;
// the vector leg catches semantically-close clauses worded differently. We fuse
// the two ranked lists with RRF (score = Σ 1/(k + rank)) — order-based, so the
// two legs' incomparable score units never need normalising.
//
// A chunk is retrievable iff:
//     industry_standard
//  OR (legislation       AND venue_state matches the caller's state)
//  OR (licence_condition AND venue_id    = the caller's venue)
//  OR (sop               AND client_id   = the caller's client)
//
// The filter is enforced TWICE for defence in depth:
//   1. RLS (schema.sql) — the GUCs app.current_client_id / current_venue_id /
//      current_venue_state are bound from the verified session, never user input.
//   2. The explicit WHERE clause below (the `base` CTE) — so the contract is
//      legible at the call site and survives even if RLS is ever relaxed for a
//      maintenance role. BOTH retrieval legs read from `base`, so isolation
//      applies identically to the vector and the lexical search.
//
// Returns top-5 chunks (by fused rank), each carrying `source` + `section` (the
// compliance audit trail) and a 0.00–1.00 `confidence` (cosine -> [0,1]).
// `lowConfidence` / `topScore` are SURFACED, never suppressed, so the product
// agent hedges below the floor instead of answering with false certainty.
// =============================================================================

import { Client } from 'pg';
import { embed, toVectorLiteral } from './ingest.js';

export const TOP_K = 5;
export const CONFIDENCE_FLOOR = 0.6;
// Candidates pulled from EACH leg before fusion — wider than TOP_K so a chunk
// strong on one leg and absent from the other still reaches the fusion.
export const CANDIDATE_K = 20;
// RRF damping constant. 60 is the value from the original Cormack et al. RRF
// paper and the de-facto default; larger flattens the contribution of rank.
export const RRF_K = 60;

// cosine distance (pgvector <=>) in [0,2] -> similarity in [0,1].
const toConfidence = (distance) => Math.max(0, Math.min(1, 1 - distance / 2));

/**
 * @param {object} ctx
 * @param {string}  ctx.query        natural-language question from the product agent
 * @param {string} [ctx.clientId]    verified session client (enables sop layer)
 * @param {string} [ctx.venueId]     verified session venue  (enables licence_condition layer)
 * @param {string} [ctx.venueState]  e.g. 'QLD' (scopes the legislation layer)
 * @param {object} [ctx.pg]          optional pg Client (else one is opened/closed)
 * @returns {Promise<{chunks: Array, topScore: number, lowConfidence: boolean}>}
 */
export async function retrieveChunks({ query, clientId = null, venueId = null, venueState = null, pg = null }) {
  if (!query || !query.trim()) throw new Error('retrieveChunks: query is required');

  const vec = embed(query); // canonical AU-resident embedder (shared with ingest), synchronous

  const ownPg = !pg;
  pg = pg || new Client({ connectionString: process.env.DB_CONNECTION_STRING });
  if (ownPg) await pg.connect();
  try {
    // Bind session GUCs so RLS applies the same four-layer filter (defence in depth).
    await pg.query("SELECT set_config('app.current_client_id',   $1, true)", [clientId || '']);
    await pg.query("SELECT set_config('app.current_venue_id',    $1, true)", [venueId || '']);
    await pg.query("SELECT set_config('app.current_venue_state', $1, true)", [venueState || '']);

    // Hybrid retrieval in ONE round trip:
    //   base — the four-layer-filtered live candidate set (defence in depth).
    //   vec  — top CANDIDATE_K by cosine distance (dense leg).
    //   fts  — top CANDIDATE_K by ts_rank_cd over content_tsv (BM25-style lexical
    //          leg); websearch_to_tsquery tolerates free-text queries safely.
    //   fused — RRF over the two leg ranks.
    // Final SELECT recomputes cosine distance for the ≤TOP_K survivors so the
    // surfaced `confidence` is a true cosine score even for a chunk that reached
    // the result via the lexical leg only.
    const { rows } = await pg.query(
      `WITH base AS (
         SELECT chunk_id, source, section, content, content_type,
                venue_state, last_updated, embedding, content_tsv
           FROM document_chunks
          WHERE superseded_at IS NULL
            AND (
                  content_type = 'industry_standard'
               OR (content_type = 'legislation'
                     AND (venue_state IS NULL OR venue_state = $2))
               OR (content_type = 'licence_condition'
                     AND venue_id = NULLIF($3, '')::uuid)
               OR (content_type = 'sop'
                     AND client_id = NULLIF($4, '')::uuid)
                )
       ),
       vec AS (
         SELECT chunk_id,
                row_number() OVER (ORDER BY embedding <=> $1 ASC) AS rank
           FROM base
          ORDER BY embedding <=> $1 ASC
          LIMIT $6
       ),
       fts AS (
         SELECT chunk_id,
                row_number() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rank
           FROM base, websearch_to_tsquery('english', $7) AS q
          WHERE content_tsv @@ q
          ORDER BY ts_rank_cd(content_tsv, q) DESC
          LIMIT $6
       ),
       fused AS (
         SELECT COALESCE(vec.chunk_id, fts.chunk_id) AS chunk_id,
                COALESCE(1.0 / ($8 + vec.rank), 0)
              + COALESCE(1.0 / ($8 + fts.rank), 0) AS rrf
           FROM vec FULL OUTER JOIN fts ON vec.chunk_id = fts.chunk_id
       )
       SELECT b.chunk_id, b.source, b.section, b.content, b.content_type,
              b.venue_state, b.last_updated,
              (b.embedding <=> $1) AS distance,
              fused.rrf
         FROM fused JOIN base b ON b.chunk_id = fused.chunk_id
        ORDER BY fused.rrf DESC, distance ASC
        LIMIT $5`,
      [toVectorLiteral(vec), venueState, venueId, clientId, TOP_K, CANDIDATE_K, query, RRF_K],
    );

    const chunks = rows.map((r) => ({
      chunk_id: r.chunk_id,
      source: r.source,            // compliance attribution — always passed through
      section: r.section,
      content: r.content,
      content_type: r.content_type,
      venue_state: r.venue_state,
      last_updated: r.last_updated,
      confidence: Number(toConfidence(Number(r.distance)).toFixed(2)),
    }));

    // Fused order need not put the highest-cosine chunk first, so the floor
    // check uses the BEST cosine confidence among the returned chunks — "do we
    // hold anything we are confident in?" — not just chunks[0].
    const topScore = chunks.reduce((m, c) => Math.max(m, c.confidence), 0);
    return {
      chunks,
      topScore,
      // Surfaced, never suppressed: product agent must hedge below the floor.
      lowConfidence: topScore < CONFIDENCE_FLOOR,
    };
  } finally {
    if (ownPg) await pg.end();
  }
}

// CLI: DB_CONNECTION_STRING=... node retrieve.js "question" [venueState] [clientId] [venueId]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , query, venueState, clientId, venueId] = process.argv;
  if (!query) {
    console.error('usage: node retrieve.js "question" [venueState] [clientId] [venueId]');
    process.exit(1);
  }
  retrieveChunks({ query, venueState, clientId, venueId })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error(e); process.exit(1); });
}
