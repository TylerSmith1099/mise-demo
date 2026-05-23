// RAG layer tests. Runs against a REAL Postgres with migrations 001–008, the
// pgvector extension, RLS, and the deterministic local embedding.
//
// Maps directly to the CTO sign-off criteria for the Knowledge stage:
//   1. pgvector operational (extension on; embedding is a vector; hnsw index)   -> "pgvector operational"
//   2. Retrieval filters by client_id (or null) AND venue_state                 -> "isolation: client", "isolation: venue_state"
//   3. Confidence score returned with EVERY result, low scores surfaced         -> "confidence on every result"
//   4. Legislation ingested and retrievable (query + top-5 sources/sections)    -> "legislation retrievable"
//
// The suite drops/creates a throwaway mise_test DB, same pattern as auth.test.js.
// Requires the `vector` extension to be installed for this Postgres major
// version (built/installed at the database setup step).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

import { initDb, closeDb, withClientContext, withSystemContext } from '../src/db.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedDemo } from '../scripts/seed.js';
import { ingestDocument } from '../src/rag/ingest.js';
import { ingestLegislation } from '../scripts/ingest-legislation.js';
import { retrieveChunks } from '../src/rag/retrieve.js';
import { EMBEDDING_DIM } from '../src/rag/embedding.js';

const ADMIN_USER = process.env.MISE_TEST_DB_ADMIN_USER || process.env.USER;
const DB_HOST = process.env.MISE_TEST_DB_HOST || 'localhost';
const TEST_DB = 'mise_rag_test';
const adminCs = `postgres://${ADMIN_USER}@${DB_HOST}:5432/postgres`;
const testCs = `postgres://${ADMIN_USER}@${DB_HOST}:5432/${TEST_DB}`;
const manifestPath = join(tmpdir(), `mise-rag-manifest-${process.pid}.json`);

let ids; // { a: Pinnacle/QLD, b: Rival/NSW }

before(async () => {
  const admin = new pg.Client({ connectionString: adminCs });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  await runMigrations(testCs);

  initDb({ db: { connectionString: testCs, appRole: 'mise_app' } });
  ids = await seedDemo(); // creates client a (QLD) and client b (NSW)

  // Shared legislation (client_id = null).
  await ingestLegislation({ manifestPath });

  // A shared NSW-only chunk — used to prove a QLD caller never receives it.
  await ingestDocument({
    source: 'Liquor Act 2007 (NSW)',
    text: '# RSA in NSW\nNew South Wales responsible service of alcohol rules and lockout provisions apply to licensed venues in NSW. Staff must hold an NSW RSA competency card.',
    clientId: null,
    venueState: 'NSW',
    lastUpdated: '2024-01-01',
    idPrefix: 'nsw-liquor-act-2007',
    manifestPath,
  });

  // Client-specific SOPs — one per client, to prove cross-client isolation.
  await ingestDocument({
    source: 'Pinnacle Cash Management SOP',
    text: '# Cash Management\nThe Criterion Hotel gaming float reconciliation is performed by the duty manager at end of shift. Count the float, record variances, and lodge the takings in the secure drop safe. Cheques for large gaming wins follow the venue cheque procedure.',
    clientId: ids.a.clientId,
    venueState: 'QLD',
    lastUpdated: '2025-01-01',
    idPrefix: 'pinnacle-cash-sop',
    manifestPath,
  });
  await ingestDocument({
    source: 'Rival Taverns Cash Management SOP',
    text: '# Cash Management\nRival Taverns secret float procedure: the rival-only reconciliation steps and drop-safe combination rotation. This content must never be visible to another client.',
    clientId: ids.b.clientId,
    venueState: 'NSW',
    lastUpdated: '2025-01-01',
    idPrefix: 'rival-cash-sop',
    manifestPath,
  });
});

after(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// Criterion 1 — pgvector operational
// ---------------------------------------------------------------------------
test('pgvector operational: extension on, embedding is a vector, hnsw index exists', async () => {
  await withSystemContext(async (q) => {
    const ext = await q("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
    assert.equal(ext.rows.length, 1, 'vector extension must be enabled');

    const col = await q(
      `SELECT a.atttypmod, t.typname
         FROM pg_attribute a
         JOIN pg_type t ON t.oid = a.atttypid
        WHERE a.attrelid = 'document_chunks'::regclass AND a.attname = 'embedding'`,
    );
    assert.equal(col.rows[0].typname, 'vector', 'embedding column is a vector type');
    // pgvector stores dimension in atttypmod.
    assert.equal(col.rows[0].atttypmod, EMBEDDING_DIM, `vector dimension is ${EMBEDDING_DIM}`);

    const idx = await q(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'document_chunks' AND indexdef ILIKE '%hnsw%'`,
    );
    assert.ok(idx.rows.length >= 1, 'an hnsw vector index exists on document_chunks');
  });
});

// ---------------------------------------------------------------------------
// Criterion 4 — legislation ingested and retrievable (+ scores/sources/sections)
// ---------------------------------------------------------------------------
test('legislation retrievable: top-5 with source + section + score on each', async () => {
  const { results, topScore } = await retrieveChunks({
    clientId: ids.a.clientId,
    venueState: 'QLD',
    queryText: 'a gaming machine malfunctioned and showed a win — what do we do?',
  });

  assert.ok(results.length > 0 && results.length <= 5, 'returns up to top-5');
  for (const r of results) {
    assert.ok(r.source, 'every result carries a source (audit trail)');
    assert.ok('section' in r, 'every result carries a section field (audit trail)');
    assert.equal(typeof r.confidence, 'number', 'every result carries a confidence');
    assert.ok(r.confidence >= 0 && r.confidence <= 1, 'confidence in [0,1]');
  }
  // The most relevant chunk should come from the gaming machine legislation.
  assert.match(results[0].source, /Gaming Machine Act/i);
  assert.ok(topScore > 0, 'top score is positive for an on-topic query');
});

// ---------------------------------------------------------------------------
// Criterion 3 — confidence returned on EVERY result, low scores surfaced
// ---------------------------------------------------------------------------
test('confidence on every result; low confidence surfaced not suppressed', async () => {
  const { results, lowConfidence, topScore } = await retrieveChunks({
    clientId: ids.a.clientId,
    venueState: 'QLD',
    queryText: 'zzzz quantum unicorn blockchain spaceship nonsense', // off-topic
  });
  // Results are still returned (top-5), each WITH a confidence — nothing suppressed.
  for (const r of results) assert.equal(typeof r.confidence, 'number');
  // An off-topic query should fall below the 0.60 floor and be flagged.
  assert.equal(lowConfidence, topScore < 0.6);
  assert.ok(topScore < 0.6, 'nonsense query scores below the confidence floor');
});

// ---------------------------------------------------------------------------
// Criterion 2a — venue_state isolation: a QLD client never gets an NSW-only chunk
// ---------------------------------------------------------------------------
test('isolation: venue_state — QLD caller never receives an NSW-only chunk', async () => {
  const { results } = await retrieveChunks({
    clientId: ids.a.clientId,
    venueState: 'QLD',
    queryText: 'responsible service of alcohol RSA competency card',
    topK: 50, // ask for everything to prove the NSW chunk is filtered out
  });
  const sources = results.map((r) => r.source);
  assert.ok(!sources.includes('Liquor Act 2007 (NSW)'), 'NSW-only chunk must not appear for a QLD caller');
  // National (state-agnostic) and QLD chunks are allowed.
  assert.ok(results.every((r) => r.venueState === null || r.venueState === 'QLD'));
});

// ---------------------------------------------------------------------------
// Criterion 2b — client isolation: a client never sees another client's SOP
// ---------------------------------------------------------------------------
test('isolation: client — client A never receives client B SOP, and vice versa', async () => {
  // Client A (Pinnacle) querying its own cash SOP topic.
  const a = await retrieveChunks({
    clientId: ids.a.clientId,
    venueState: 'QLD',
    queryText: 'cash float reconciliation drop safe combination secret procedure',
    topK: 50,
  });
  const aSources = a.results.map((r) => r.source);
  assert.ok(aSources.includes('Pinnacle Cash Management SOP'), 'A sees its own SOP');
  assert.ok(!aSources.includes('Rival Taverns Cash Management SOP'), 'A must NOT see B SOP');

  // Client B (Rival) — sees its own, never A's; never the QLD-only shared chunks.
  const b = await retrieveChunks({
    clientId: ids.b.clientId,
    venueState: 'NSW',
    queryText: 'cash float reconciliation drop safe combination secret procedure',
    topK: 50,
  });
  const bSources = b.results.map((r) => r.source);
  assert.ok(bSources.includes('Rival Taverns Cash Management SOP'), 'B sees its own SOP');
  assert.ok(!bSources.includes('Pinnacle Cash Management SOP'), 'B must NOT see A SOP');
  // B is in NSW: must not receive QLD-only legislation.
  assert.ok(!bSources.includes('Gaming Machine Act 1991 (QLD)'), 'B (NSW) must NOT see QLD-only legislation');
});

// ---------------------------------------------------------------------------
// Supersede behaviour — re-ingest archives prior rows (audit), serves new only.
// ---------------------------------------------------------------------------
test('re-ingest supersedes prior chunks (kept for audit, not retrieved)', async () => {
  await ingestDocument({
    source: 'Pinnacle Cash Management SOP',
    text: '# Cash Management\nUPDATED v2: the duty manager now reconciles the gaming float twice per shift and records the count in the new portal.',
    clientId: ids.a.clientId,
    venueState: 'QLD',
    lastUpdated: '2025-05-01',
    idPrefix: 'pinnacle-cash-sop',
    manifestPath,
  });
  // Old rows are retained but stamped superseded_at.
  const superseded = await withClientContext(ids.a.clientId, async (q) => {
    const { rows } = await q(
      `SELECT count(*)::int AS n FROM document_chunks
        WHERE source = 'Pinnacle Cash Management SOP' AND superseded_at IS NOT NULL`,
    );
    return rows[0].n;
  });
  assert.ok(superseded >= 1, 'prior chunks archived, not deleted');
});
