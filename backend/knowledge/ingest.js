// =============================================================================
// MISE — Knowledge ingestion pipeline for SOPs and licence conditions.
//
// parse(.md) -> chunk (300–600 token, section-bounded, self-contained)
//   -> embed (canonical AU-resident embedder) -> tag (four-layer metadata)
//   -> store (pgvector) -> log (manifest).
//
// Layers handled here:
//   * sop                — tagged with client_id   (NOT venue_id / venue_state)
//   * licence_condition  — tagged with venue_id     (NOT client_id / venue_state)
// (Legislation is ingested by ingest-legislation.py; industry_standard by the
//  same flow with content_type = 'industry_standard'.)
//
// EMBEDDING — divergence from the issue's "embed via Claude API", deliberate:
//   * The Anthropic SDK exposes NO embeddings endpoint, so a literal
//     `client.embeddings.create` would not run.
//   * AU data residency (non-negotiable per src/rag/embedding.js) forbids
//     shipping chunk text to any external service.
//   * Ingest and query MUST share one embedder or cosine search is meaningless,
//     and migration 008 fixes the column at vector(384).
//   So we call the single canonical embedder, src/rag/embedding.js — the
//   documented deploy seam where an AU-hosted semantic model is swapped in at
//   the same 384 dimension. If the board truly wants an external embeddings
//   provider, that is a one-line change here plus a residency decision.
//
// SUPERSEDING: re-ingesting a source stamps its prior live chunks superseded_at
// (dropped from retrieval, retained for audit) — never deletes them.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from 'pg';
import { embed, toVectorLiteral, EMBEDDING_DIM, EMBEDDING_MODEL } from '../src/rag/embedding.js';

export const MIN_TOKENS = 300;
export const MAX_TOKENS = 600;
// Re-exported so retrieve.js and tests share the exact contract.
export { embed, toVectorLiteral, EMBEDDING_DIM, EMBEDDING_MODEL };

// ~4 chars/token heuristic; good enough to keep chunks in the 300–600 band.
export const estimateTokens = (text) => Math.ceil(text.length / 4);

// ---------------------------------------------------------------------------
// Chunking: split on Markdown headings / numbered clauses, then pack sections
// into self-contained chunks of MIN..MAX tokens. The source heading is carried
// into `section` so each chunk stands alone.
// ---------------------------------------------------------------------------
export function chunkDocument(markdown, { source }) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let current = { heading: null, body: [] };
  const headingRe = /^(#{1,6}\s+.*|(\d+(\.\d+)*)\s+\S.*)/;

  for (const line of lines) {
    const t = line.trim();
    if (headingRe.test(t)) {
      if (current.body.join('').trim()) blocks.push(current);
      current = { heading: t.replace(/^#{1,6}\s+/, ''), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.join('').trim() || current.heading) blocks.push(current);

  const chunks = [];
  let buf = { heading: null, text: '' };
  const flush = () => {
    const text = buf.text.trim();
    if (text) {
      chunks.push({
        section: buf.heading || null,
        content: text,
        token_count: estimateTokens(text),
      });
    }
    buf = { heading: null, text: '' };
  };

  for (const block of blocks) {
    const blockText = `${block.heading ? block.heading + '\n' : ''}${block.body.join('\n')}`.trim();
    if (!blockText) continue;
    if (buf.heading === null) buf.heading = block.heading;
    const combined = buf.text ? `${buf.text}\n\n${blockText}` : blockText;
    if (estimateTokens(combined) > MAX_TOKENS && buf.text) {
      flush();
      buf = { heading: block.heading, text: blockText };
    } else {
      buf.text = combined;
    }
    if (estimateTokens(buf.text) >= MIN_TOKENS) flush();
  }
  flush();
  return chunks;
}

// Embedding (embed / toVectorLiteral / EMBEDDING_DIM) is the canonical
// AU-resident implementation imported from src/rag/embedding.js above — one
// embedder shared by ingest and query so cosine similarity is meaningful.

// ---------------------------------------------------------------------------
// Contextual retrieval (MIS-72): a one-sentence blurb that situates a chunk in
// its parent document, prepended to the chunk text BEFORE embedding so section
// context is baked into the vector and the lexical index, not lost at the chunk
// boundary. The raw `content` is unchanged and still cited verbatim — only the
// indexed representation is enriched.
//
// RESIDENCY-SAFE DEFAULT: this builder is DETERMINISTIC and fully offline — it
// composes the blurb from the chunk's own source/section/type metadata, so no
// chunk text (including client SOPs and licence conditions) is shipped to any
// external LLM. The issue's example phrasing
//   "This subsection of the Gaming Machine Act 1991 (QLD) defines the
//    obligations of gaming nominees regarding…"
// is reproduced from metadata we already hold.
//
// >>> FLAG FOR DEPLOY STAGE <<<
// To generate a richer LLM-written blurb, set CONTEXT_BLURB_FN to an async
// function (text, meta) => string. For PUBLIC legislation that may route to the
// Claude API; client SOP / licence_condition text must NOT — see the Questions
// log entry (MIS-72). Until that residency decision is made, the offline
// builder is the only one wired in.
const TYPE_PHRASE = {
  legislation: 'sets out the statutory requirements in',
  licence_condition: 'records a venue licence condition under',
  industry_standard: 'gives hospitality best-practice guidance from',
  sop: 'describes the client procedure in',
};

export function buildContext({ source, section, contentType }) {
  const what = TYPE_PHRASE[contentType] || 'is an excerpt from';
  const where = section ? `${source}, ${section},` : `${source}`;
  return `This excerpt from ${where} ${what} ${source}.`.replace(/\s+/g, ' ').trim();
}

// Text actually handed to the embedder: blurb + chunk. Shared by ingest and any
// re-embed path so ingest-time and query-time representations stay consistent.
export const embedText = (context, content) =>
  (context ? `${context}\n\n${content}` : content);

// ---------------------------------------------------------------------------
// Tagging: validate and apply the four-layer metadata contract before write.
// ---------------------------------------------------------------------------
function tagChunk(chunk, { source, contentType, clientId, venueId, lastUpdated }, idx) {
  if (contentType === 'sop' && !clientId) throw new Error('sop chunks require clientId');
  if (contentType === 'licence_condition' && !venueId) {
    throw new Error('licence_condition chunks require venueId');
  }
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    chunk_id: `${slug}-${String(idx).padStart(3, '0')}`,
    source,
    section: chunk.section,
    content: chunk.content,
    context: buildContext({ source, section: chunk.section, contentType }),
    content_type: contentType,
    client_id: contentType === 'sop' ? clientId : null,
    venue_id: contentType === 'licence_condition' ? venueId : null,
    venue_state: null, // legislation only — set by ingest-legislation.py
    last_updated: lastUpdated || null,
    token_count: chunk.token_count,
  };
}

// ---------------------------------------------------------------------------
// Store: supersede prior live rows for this source, then insert new chunks.
// ---------------------------------------------------------------------------
async function store(pg, rows, { contentType, clientId }) {
  await pg.query('BEGIN');
  try {
    // Bind session GUC so RLS WITH CHECK admits sop writes.
    if (contentType === 'sop') {
      await pg.query("SELECT set_config('app.current_client_id', $1, true)", [clientId]);
    }
    if (rows.length) {
      await pg.query(
        `UPDATE document_chunks SET superseded_at = now()
           WHERE source = $1 AND superseded_at IS NULL`,
        [rows[0].source],
      );
    }
    for (const r of rows) {
      // Contextual retrieval: embed the blurb + the chunk so section context is
      // in the vector. content_tsv is GENERATED from context too (schema.sql).
      const vec = embed(embedText(r.context, r.content)); // canonical embedder is synchronous
      await pg.query(
        `INSERT INTO document_chunks
           (chunk_id, source, section, content, context, content_type, client_id, venue_id,
            venue_state, last_updated, token_count, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (chunk_id) DO UPDATE SET
           content = EXCLUDED.content, context = EXCLUDED.context,
           embedding = EXCLUDED.embedding,
           token_count = EXCLUDED.token_count, superseded_at = NULL`,
        [r.chunk_id, r.source, r.section, r.content, r.context, r.content_type, r.client_id,
         r.venue_id, r.venue_state, r.last_updated, r.token_count, toVectorLiteral(vec)],
      );
    }
    await pg.query('COMMIT');
  } catch (err) {
    await pg.query('ROLLBACK');
    throw err;
  }
}

export function defaultManifestPath() {
  return path.resolve(process.cwd(), 'Knowledge Base', 'manifest.json');
}

export function appendManifest(entry, manifestPath = defaultManifestPath()) {
  let manifest = { ingested: [] };
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
  if (!Array.isArray(manifest.ingested)) manifest.ingested = [];
  manifest.ingested.push({ ...entry, at: new Date().toISOString() });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

// ---------------------------------------------------------------------------
// Public entrypoint: ingest one .md file as sop / licence_condition / industry_standard.
// ---------------------------------------------------------------------------
export async function ingestDocument({
  filePath, source, contentType, clientId = null, venueId = null,
  lastUpdated = null, pg = null,
}) {
  if (!['sop', 'licence_condition', 'industry_standard'].includes(contentType)) {
    throw new Error(`ingest.js handles sop/licence_condition/industry_standard, not ${contentType}`);
  }
  const markdown = fs.readFileSync(filePath, 'utf8');
  const chunks = chunkDocument(markdown, { source });
  const rows = chunks.map((c, i) =>
    tagChunk(c, { source, contentType, clientId, venueId, lastUpdated }, i + 1));

  const ownPg = !pg;
  pg = pg || new Client({ connectionString: process.env.DB_CONNECTION_STRING });
  if (ownPg) await pg.connect();
  try {
    await store(pg, rows, { contentType, clientId });
  } finally {
    if (ownPg) await pg.end();
  }

  appendManifest({
    source, content_type: contentType, client_id: clientId, venue_id: venueId,
    chunk_count: rows.length, file: path.basename(filePath),
    sha256: crypto.createHash('sha256').update(markdown).digest('hex').slice(0, 12),
  });
  return { source, chunk_count: rows.length };
}

// CLI: node ingest.js <file.md> <sop|licence_condition> <clientId|venueId>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , file, type, scope] = process.argv;
  if (!file || !type) {
    console.error('usage: node ingest.js <file.md> <sop|licence_condition|industry_standard> [clientId|venueId]');
    process.exit(1);
  }
  ingestDocument({
    filePath: file,
    source: path.basename(file, '.md'),
    contentType: type,
    clientId: type === 'sop' ? scope : null,
    venueId: type === 'licence_condition' ? scope : null,
  })
    .then((r) => console.log(`ingested ${r.chunk_count} chunks from ${r.source}`))
    .catch((e) => { console.error(e); process.exit(1); });
}
