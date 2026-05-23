// Ingestion pipeline: parse -> chunk -> embed -> tag metadata -> store -> log.
//
// Two write paths, both honouring the isolation contract:
//   * SHARED legislation (clientId == null) is written via withSystemContext —
//     a privileged maintenance path. RLS WITH CHECK forbids the tenant role
//     (mise_app) from inserting client_id IS NULL rows, so shared knowledge can
//     only be loaded by the operator. (Production: run the ingestion job as a
//     dedicated BYPASSRLS/owner maintenance role, NEVER as mise_app.)
//   * CLIENT SOPs (clientId set) are written via withClientContext(clientId),
//     so the RLS WITH CHECK validates the row belongs to that client. A client
//     physically cannot ingest a chunk tagged for another client.
//
// Re-ingesting a source SUPERSEDES (never deletes) its prior live chunks: they
// are stamped superseded_at and dropped from retrieval, but kept for audit.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { withClientContext, withSystemContext } from '../db.js';
import { embed, toVectorLiteral, EMBEDDING_MODEL } from './embedding.js';
import { chunkDocument } from './chunker.js';

// Build the text that gets embedded: heading weighted x2, content minus the
// markdown blockquote disclaimer lines (which are identical across docs).
function embeddingInput(section, content) {
  const body = content
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('>'))
    .join('\n');
  const heading = section ? `${section}\n${section}\n` : '';
  return `${heading}${body}`;
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// Insert one chunk row using the supplied scoped query runner `q`. Each ingest
// produces NEW rows (no upsert): re-ingesting a source archives the previous
// rows via superseded_at and inserts a fresh versioned batch, so the prior
// version survives intact for the compliance audit trail.
async function insertChunk(q, c) {
  await q(
    `INSERT INTO document_chunks
       (chunk_id, source, section, content, content_type, client_id, venue_id,
        venue_state, last_updated, token_count, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector)`,
    [
      c.chunkId, c.source, c.section, c.content, c.contentType, c.clientId,
      c.venueId, c.venueState, c.lastUpdated, c.tokenCount, toVectorLiteral(c.embedding),
    ],
  );
}

/**
 * Ingest one document.
 * @param {object} doc
 * @param {string} doc.source        canonical source name (attribution).
 * @param {string} doc.text          raw markdown/plain document text.
 * @param {string|null} doc.clientId null = shared legislation; UUID = client SOP.
 * @param {string|null} doc.venueId   licence_condition only: the venue the chunk
 *                                     is pinned to. NULL for every other layer.
 * @param {string|null} doc.venueState 'QLD' etc., or null = applies to all states.
 * @param {string} [doc.contentType]  four-layer discriminator (industry_standard
 *                                     | legislation | licence_condition | sop).
 *                                     Inferred when omitted: 'sop' if clientId is
 *                                     set, else 'legislation' (the two-layer
 *                                     defaults; pass explicitly for the other
 *                                     two layers).
 * @param {string} doc.lastUpdated   ISO date (currency of the source).
 * @param {string} doc.idPrefix      stable chunk_id prefix, e.g. 'qld-gaming-act-1991'.
 * @param {string[]} [doc.flags]     deploy-stage notes (e.g. "needs full-text load").
 * @returns {Promise<{source, clientId, chunkCount, chunkIds, flags}>}
 */
export async function ingestDocument(doc) {
  const {
    source, text, clientId = null, venueId = null, venueState = null,
    lastUpdated, idPrefix,
  } = doc;
  if (!source || !text || !idPrefix) {
    throw new Error('ingestDocument requires source, text, idPrefix');
  }
  // Default to the two-layer mapping when the caller doesn't specify a layer.
  const contentType = doc.contentType || (clientId != null ? 'sop' : 'legislation');

  // Enforce the per-layer column invariants (migration 011) IN CODE so a caller
  // can't store a chunk the schema CHECK would reject: only licence_condition
  // carries a venue_id; only legislation/licence_condition carry a venue_state;
  // sop and industry_standard carry neither (jurisdiction is implied by the
  // client/shared partition). e.g. an SOP passed venueState:'QLD' is normalised
  // to NULL here rather than failing the insert.
  const venueIdFinal = contentType === 'licence_condition' ? venueId : null;
  const venueStateFinal =
    contentType === 'legislation' || contentType === 'licence_condition' ? venueState : null;

  // A per-ingest version token keeps each batch's chunk_ids unique, so a
  // re-ingest's new rows never collide with the archived (superseded) rows.
  const version = doc.version || Date.now().toString(36);

  // parse -> chunk
  const rawChunks = chunkDocument(text);
  // embed + tag. The embedding input is the topical signal only: the section
  // heading (repeated for weight, headings carry the key terms) plus the chunk
  // content with the ingest-disclaimer blockquote stripped — that boilerplate is
  // identical across documents and would otherwise dilute every vector equally.
  // The STORED content is left faithful and unedited.
  const chunks = rawChunks.map((rc, i) => ({
    chunkId: `${idPrefix}-v${version}-${String(i + 1).padStart(3, '0')}`,
    source,
    section: rc.section,
    content: rc.content,
    contentType,
    clientId,
    venueId: venueIdFinal,
    venueState: venueStateFinal,
    lastUpdated,
    tokenCount: rc.tokenCount,
    embedding: embed(embeddingInput(rc.section, rc.content)),
  }));

  // store — supersede prior live rows from the same source, then insert.
  const run = async (q) => {
    await q(
      `UPDATE document_chunks SET superseded_at = now()
       WHERE source = $1 AND superseded_at IS NULL
         AND client_id IS NOT DISTINCT FROM $2`,
      [source, clientId],
    );
    for (const c of chunks) await insertChunk(q, c);
  };
  if (clientId == null) await withSystemContext(run);
  else await withClientContext(clientId, run);

  // log to manifest
  const entry = {
    source,
    idPrefix,
    clientId,
    venueState,
    lastUpdated,
    chunkCount: chunks.length,
    embeddingModel: EMBEDDING_MODEL,
    ingestedAt: new Date().toISOString(),
    flags: doc.flags ?? [],
  };
  await appendManifest(entry, doc.manifestPath);

  return { source, clientId, chunkCount: chunks.length, chunkIds: chunks.map((c) => c.chunkId), flags: entry.flags };
}

// The manifest is the human-readable record of what is in the knowledge base.
export async function appendManifest(entry, manifestPath = defaultManifestPath()) {
  let manifest = { generatedAt: null, embeddingModel: EMBEDDING_MODEL, documents: [] };
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    /* first write */
  }
  // Replace any existing entry for the same source+client (re-ingest).
  manifest.documents = (manifest.documents || []).filter(
    (d) => !(d.source === entry.source && d.clientId === entry.clientId),
  );
  manifest.documents.push(entry);
  manifest.generatedAt = new Date().toISOString();
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

import { dirname as _dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export function defaultManifestPath() {
  return join(_dirname(fileURLToPath(import.meta.url)), '..', '..', 'Knowledge Base', 'manifest.json');
}
