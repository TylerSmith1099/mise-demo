// =============================================================================
// MIS-70 — Ingest the three finalised DEMO SOPs (RSA, Gaming Floor, Responsible
// Gambling patron interaction) into the four-layer RAG knowledge base as
// CLIENT-ISOLATED `sop` rows, scoped to Pinnacle Hotel Group / The Criterion
// Hotel (QLD).
//
// Pipeline: src/rag/ingest.js (the RUNNABLE knowledge layer — parse .md ->
// chunk 300–600 tok -> embed offline -> tag content_type='sop' + client_id ->
// store in document_chunks/pgvector -> log to manifest). content_type='sop'
// means each chunk is visible ONLY inside the owning client's partition (RLS on
// app.current_client_id + the explicit four-layer WHERE in retrieve.js), so the
// set is retrieved only for Pinnacle/The Criterion and is cleanly removable as a
// demo set for the Demo->Live swap (MIS-62): supersede/delete by `source`.
//
// MIS-71: this script previously imported a non-existent cross-tree path
// (`../MISE/backend/knowledge/ingest.js`) against the knowledge_chunks/1024
// line. It now uses the canonical running ingest (src/rag/ingest.js), which the
// live Express server retrieves from. SOPs are client-scoped, so venue_state /
// venue_id are not stored on sop rows (enforced by ingestDocument + migration
// 011's layer invariants).
//
// These three .md sources are DEMO-ACTIVE, Content Integrity CLEAR x3 (MIS-59),
// and registered in Knowledge Base/knowledge-base-manifest.md.
//
// Run (after migrate + seed, using the seeded Pinnacle client id):
//   DB_CONNECTION_STRING=... node scripts/ingest-demo-sops.js <pinnacleClientId>
// If no client id is given, a documented demo UUID is used (standalone verify).
// =============================================================================

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Documented standalone-verification fallback. In the real demo DB the Pinnacle
// client id comes from the seed (scripts/seed-demo-criterion.js) and is passed
// as argv[2]; this constant only applies when no id is supplied.
export const PINNACLE_DEMO_CLIENT_ID = 'b54d1b2b-f024-48fe-bbdf-d174a85ffc27';

// The three MIS-70 SOPs. `source` is the clean compliance-attribution name shown
// to the product agent; `file` is the traceable repo path (also the unit the
// demo set is removed by); `idPrefix` is the stable chunk_id prefix.
export const DEMO_SOPS = [
  {
    source: 'Criterion SOP — Responsible Service of Alcohol',
    file: 'Knowledge Base/SOPs/RSA/rsa-procedures.md',
    idPrefix: 'criterion-sop-rsa',
    lastUpdated: '2026-05-01',
  },
  {
    source: 'Criterion SOP — Gaming Floor Procedures',
    file: 'Knowledge Base/SOPs/Gaming/gaming-floor-procedures.md',
    idPrefix: 'criterion-sop-gaming-floor',
    lastUpdated: '2026-05-01',
  },
  {
    source: 'Criterion SOP — Responsible Gambling Patron Interaction',
    file: 'Knowledge Base/SOPs/Risk-Management/responsible-gambling-patron-interaction-procedures.md',
    idPrefix: 'criterion-sop-rg-patron-interaction',
    lastUpdated: '2026-05-01',
  },
];

export async function ingestDemoSops(clientId, { manifestPath } = {}) {
  if (!clientId) throw new Error('ingestDemoSops requires a Pinnacle client id');
  const results = [];
  for (const sop of DEMO_SOPS) {
    const text = await readFile(path.join(REPO_ROOT, sop.file), 'utf8');
    const res = await ingestDocument({
      source: sop.source,
      text,
      contentType: 'sop',
      clientId,
      idPrefix: sop.idPrefix,
      lastUpdated: sop.lastUpdated,
      manifestPath,
      flags: ['demo SOP — original content authored for The Criterion Hotel'],
    });
    results.push({ ...res, file: sop.file });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const clientId = process.argv[2] || PINNACLE_DEMO_CLIENT_ID;
  const cs = process.env.DB_CONNECTION_STRING;
  if (!cs) {
    console.error('DB_CONNECTION_STRING is required');
    process.exit(1);
  }
  initDb({ db: { connectionString: cs, appRole: process.env.DB_APP_ROLE || 'mise_app' } });
  ingestDemoSops(clientId)
    .then(async (rows) => {
      const total = rows.reduce((n, r) => n + r.chunkCount, 0);
      for (const r of rows) console.log(`  - ${r.source}: ${r.chunkCount} chunks  (${r.file})`);
      console.log(`ingested ${rows.length} demo SOPs, ${total} chunks for client ${clientId}`);
      await closeDb();
    })
    .catch(async (e) => {
      console.error('demo SOP ingestion failed:', e.message);
      await closeDb();
      process.exit(1);
    });
}
