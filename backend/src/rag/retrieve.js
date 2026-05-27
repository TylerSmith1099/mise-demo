// Retrieval: return the top-5 most relevant chunks for a query, with a
// confidence score, source, and section on EVERY result.
//
// HYBRID SEARCH (MIS-72, ported into the canonical tree by MIS-97): the result
// set is the Reciprocal-Rank-Fusion of two ranked legs over the SAME isolated
// candidate set:
//   * dense  — cosine nearest-neighbour on the embedding (semantic match).
//   * lexical — ts_rank_cd over content_tsv (migration 012), a BM25-style
//               full-text leg that anchors retrieval to EXACT statutory
//               terminology ("responsible gambling", "excluded patron") which
//               the offline hashing embedder under-weights. This is what
//               surfaces the QLD RG Code of Practice into top-5 (fixes Scene 1).
// RRF (score = Σ 1/(k + rank)) is order-based, so the two legs' incomparable
// score units never need normalising. The final `confidence` is still a true
// cosine score, recomputed for the survivors so a chunk that reached the result
// via the lexical leg alone still carries an honest confidence.
//
// ISOLATION (enforced at query time, every time) — FOUR LAYERS (MIS-71):
//   * client_id filtering is done by RLS (migration 008): the row is visible iff
//     client_id = app.current_client_id OR client_id IS NULL. We never put a
//     client_id in the SQL — withClientContext binds the verified id to the
//     transaction, so a QLD client can only ever see its own SOPs + shared
//     legislation. There is no code path to ask for another client's chunks.
//     BOTH legs read from the one `base` CTE, so isolation applies identically.
//   * The content_type predicate (migration 011) narrows further to the layer
//     relevant to THIS request:
//       - industry_standard : always in scope (shared, jurisdiction-agnostic).
//       - legislation       : the caller's venue_state, or state-agnostic
//                             national law (venue_state IS NULL).
//       - licence_condition : ONLY the caller's own venue_id — a venue can never
//                             receive ANOTHER venue's licence conditions, even
//                             within the same client.
//       - sop               : the client's own SOPs (RLS-scoped).
//
// CONFIDENCE: cosine similarity (1 - cosine distance) clamped to [0,1]. Returned
// on every result and NEVER suppressed. The caller (product agent) is told when
// the top score is below the floor via `lowConfidence` so it can hedge rather
// than answer with false certainty.

import { withClientContext } from '../db.js';
import { embed, toVectorLiteral, EMBEDDING_MODEL } from './embedding.js';

export const TOP_K = 5;
// Candidates pulled from EACH leg before fusion — wider than TOP_K so a chunk
// strong on one leg but absent from the other still reaches the fusion.
export const CANDIDATE_K = 20;
// RRF damping constant. 60 is the value from the original Cormack et al. RRF
// paper and the de-facto default; larger flattens the contribution of rank.
export const RRF_K = 60;

// The confidence floor is CALIBRATED TO THE ACTIVE EMBEDDING MODEL. The offline
// hashing stand-in (mise-local-hashing-v1) compresses cosine into a low band —
// a strong topical match lands ~0.25–0.35 while a genuinely off-topic query
// lands ~0.0 — so the 0.60 floor that suits a semantic model would mark every
// real answer "uncertain" and make the product hedge constantly. We use a
// model-specific floor that preserves the same meaning (real match = confident,
// off-topic = flagged). When the AU-hosted semantic model is provisioned this
// falls back to 0.60. (MIS-29 deploy carryover, resolved for the offline model.)
const FLOOR_BY_MODEL = { 'mise-local-hashing-v1': 0.22 };
export const CONFIDENCE_FLOOR = FLOOR_BY_MODEL[EMBEDDING_MODEL] ?? 0.6;

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Retrieve the top-K chunks for a query within one client's isolation context.
 * @param {object} args
 * @param {string} args.clientId    verified client id (RLS context).
 * @param {string|null} args.venueId     caller's venue id — gates licence_condition.
 * @param {string|null} args.venueState  caller's venue state, e.g. 'QLD'.
 * @param {string} args.queryText   the natural-language question.
 * @param {string[]} [args.domains] persona domain scope (MIS-590). When set, hard-filters
 *                                  to chunks whose domain is in this list OR domain='general'.
 *                                  Example: ['liquor_rsa','gambling_rsg'] for gaming attendants.
 *                                  Omit or pass [] to retrieve across all domains.
 * @param {number} [args.topK]      default 5.
 * @returns {Promise<{results: Array, lowConfidence: boolean, topScore: number}>}
 */
export async function retrieveChunks({ clientId, venueId = null, venueState = null, queryText, domains, topK = TOP_K }) {
  if (!queryText || !queryText.trim()) throw new Error('queryText is required');
  const qvec = toVectorLiteral(embed(queryText));
  const hasDomainScope = Array.isArray(domains) && domains.length > 0;

  const rows = await withClientContext(clientId, async (q) => {
    // Hybrid retrieval in ONE round trip.
    //   base  — the isolation-filtered live candidate set. Applies BOTH layers:
    //     1. RLS already restricts rows to shared (client_id IS NULL) OR this
    //        client's rows. Both legs read from here, so isolation is identical.
    //     2. content_type predicate (four-layer, migration 011): narrows to the
    //        layers in scope for this caller. venue_state gates legislation;
    //        venue_id gates licence_condition; sop is RLS-scoped already.
    //     3. Domain filter (MIS-590, migration 035): when domains[] is set,
    //        restricts to chunks in those domains OR domain='general'. Prevents
    //        RSA (liquor) questions from returning RSG (gambling) content.
    //   vec   — top CANDIDATE_K by cosine distance (dense leg).
    //   q     — OR-semantics tsquery for the lexical leg (handles natural
    //           language questions that have no single chunk matching all terms).
    //   fts   — top CANDIDATE_K by ts_rank_cd over content_tsv (lexical leg).
    //   fused — RRF over the two leg ranks.
    // Final SELECT recomputes cosine for the <=TOP_K survivors so `confidence`
    // is a true cosine score even for a chunk surfaced via the lexical leg only.

    // Build domain predicate (positional param $8 when hasDomainScope is true).
    const domainClause = hasDomainScope
      ? `AND (domain = ANY($8::text[]) OR domain = 'general')`
      : '';

    const baseParams = [qvec, venueState, venueId, topK, CANDIDATE_K, queryText, RRF_K];
    if (hasDomainScope) baseParams.push(domains);

    const { rows } = await q(
      `WITH base AS (
         SELECT chunk_id, source, section, content, content_type, venue_state,
                last_updated, client_id IS NULL AS shared, embedding, content_tsv
           FROM document_chunks
          WHERE superseded_at IS NULL
            AND (
                   content_type = 'industry_standard'
                OR (content_type = 'legislation'       AND ($2::text IS NULL OR venue_state IS NULL OR venue_state = $2))
                OR (content_type = 'licence_condition' AND venue_id = $3::uuid)
                OR (content_type = 'sop')
                )
            ${domainClause}
       ),
       vec AS (
         SELECT chunk_id,
                row_number() OVER (ORDER BY embedding <=> $1::vector ASC) AS rank
           FROM base
          ORDER BY embedding <=> $1::vector ASC
          LIMIT $5
       ),
       q AS (
         -- Build an OR-semantics lexical query. websearch_to_tsquery AND-joins
         -- terms, so a whole natural-language question matches NO chunk (no chunk
         -- holds every word) and the lexical leg goes dark. We reuse the parser's
         -- tokenisation/stemming/stopword removal, then swap '&' for '|' so a
         -- chunk matching ANY salient term participates and ts_rank_cd ranks it by
         -- how many it matches + proximity. NULLIF guards an empty query.
         SELECT NULLIF(
                  replace(websearch_to_tsquery('english', $6)::text, ' & ', ' | '),
                  ''
                )::tsquery AS query
       ),
       fts AS (
         SELECT chunk_id,
                row_number() OVER (ORDER BY ts_rank_cd(content_tsv, q.query) DESC) AS rank
           FROM base, q
          WHERE q.query IS NOT NULL AND content_tsv @@ q.query
          ORDER BY ts_rank_cd(content_tsv, q.query) DESC
          LIMIT $5
       ),
       fused AS (
         SELECT COALESCE(vec.chunk_id, fts.chunk_id) AS chunk_id,
                COALESCE(1.0 / ($7 + vec.rank), 0)
              + COALESCE(1.0 / ($7 + fts.rank), 0) AS rrf
           FROM vec FULL OUTER JOIN fts ON vec.chunk_id = fts.chunk_id
       )
       SELECT b.chunk_id, b.source, b.section, b.content, b.content_type,
              b.venue_state, b.last_updated, b.shared,
              1 - (b.embedding <=> $1::vector) AS cosine_similarity
         FROM fused JOIN base b ON b.chunk_id = fused.chunk_id
        ORDER BY fused.rrf DESC, b.embedding <=> $1::vector ASC
        LIMIT $4`,
      baseParams,
    );
    return rows;
  });

  const results = rows.map((r) => ({
    chunkId: r.chunk_id,
    source: r.source,            // compliance audit trail
    section: r.section,          // compliance audit trail
    content: r.content,
    contentType: r.content_type, // which of the four layers this chunk belongs to
    venueState: r.venue_state,
    lastUpdated: r.last_updated,
    shared: r.shared,            // true = shared legislation, false = this client's SOP
    confidence: Number(clamp01(Number(r.cosine_similarity)).toFixed(4)),
  }));

  // Fused order need not put the highest-cosine chunk first, so the floor check
  // uses the BEST cosine confidence among the survivors — "do we hold anything
  // we are confident in?" — not just results[0].
  const topScore = results.reduce((m, r) => Math.max(m, r.confidence), 0);
  return {
    results,
    topScore,
    // Surfaced, never suppressed: the product agent must hedge below the floor.
    lowConfidence: topScore < CONFIDENCE_FLOOR,
  };
}
