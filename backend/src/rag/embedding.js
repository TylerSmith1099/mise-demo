// Deterministic, fully-offline text embedding.
//
// AU DATA RESIDENCY (non-negotiable): the MVP makes NO network calls to any
// embedding service. Text never leaves the machine. This is a hashing-based
// "feature hashing" embedding (a.k.a. the hashing trick): tokens are hashed into
// a fixed-dimension vector with a sign hash to keep distinct terms near-
// orthogonal, weighted by a sub-linear term frequency, then L2-normalised so
// cosine similarity is a dot product.
//
// It is intentionally simple and reproducible — the SAME text always yields the
// SAME vector, at ingest time and at query time, with no model download. It
// captures lexical overlap (shared terminology between a question and a clause),
// which is enough to PROVE the retrieval pipeline, filters, and confidence
// scoring end-to-end.
//
// >>> FLAG FOR DEPLOY STAGE <<<
// This is NOT a semantic model. Before production, swap in a real sentence
// embedding model hosted IN AU (e.g. a self-hosted MiniLM/BGE on AWS
// ap-southeast-2, or AWS Bedrock Titan Embeddings in an AU region). Keep
// EMBEDDING_DIM aligned with the chosen model (384 matches all-MiniLM-L6-v2) so
// migration 008's vector(384) column needs no change. Only this file changes.

import { createHash } from 'node:crypto';

export const EMBEDDING_DIM = 384;

// Marks which embedding implementation produced a vector — recorded so the
// deploy stage can detect chunks that must be re-embedded with the prod model.
export const EMBEDDING_MODEL = 'mise-local-hashing-v1';

const TOKEN_RE = /[a-z0-9]+/g;

function tokenize(text) {
  return (text.toLowerCase().match(TOKEN_RE) || []).filter((t) => t.length > 1);
}

// Stable 32-bit hash derived from SHA-1 (deterministic across processes/runs,
// unlike a JS string hash that could change). Two independent hashes give us a
// bucket index and an independent sign.
function hash32(token, salt) {
  const h = createHash('sha1').update(salt).update(token).digest();
  return h.readUInt32BE(0);
}

/**
 * Embed a piece of text into a unit-length EMBEDDING_DIM vector.
 * @param {string} text
 * @returns {number[]} length EMBEDDING_DIM, L2-normalised.
 */
export function embed(text) {
  const vec = new Float64Array(EMBEDDING_DIM);
  const tokens = tokenize(text);
  if (tokens.length === 0) return Array.from(vec);

  // Raw term frequencies.
  const tf = new Map();
  for (const tok of tokens) tf.set(tok, (tf.get(tok) || 0) + 1);

  for (const [tok, count] of tf) {
    const bucket = hash32(tok, 'idx') % EMBEDDING_DIM;
    const sign = (hash32(tok, 'sign') & 1) === 0 ? 1 : -1;
    // Sub-linear (log) tf damping so a few repeated words don't dominate.
    const weight = 1 + Math.log(count);
    vec[bucket] += sign * weight;
  }

  // L2 normalise -> cosine similarity == dot product, range [-1, 1].
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return Array.from(vec);
  const out = new Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) out[i] = vec[i] / norm;
  return out;
}

// pgvector text format: '[0.1,0.2,...]'. Used when binding the parameter.
export function toVectorLiteral(vector) {
  return `[${vector.join(',')}]`;
}
