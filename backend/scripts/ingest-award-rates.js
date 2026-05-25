// =============================================================================
// MIS-422 — Ingest MA000009 award rates knowledge article.
//
// Ingests Knowledge Base/Knowledge/hospitality-award-rates.md which now
// contains verbatim Sunday and Public Holiday penalty dollar amounts for
// Level 1, Level 2, and Level 3 casual employees extracted from the official
// FWO Pay Guide MA000009 (effective 01/07/2025, published 15/01/2026).
//
// Source type: industry_standard (national award — all states).
// client_id: null (shared, visible to all clients).
// venueState: null (MA000009 is a national award).
//
// Run:
//   DB_CONNECTION_STRING=postgres://localhost/mise_eval \
//     node scripts/ingest-award-rates.js
// =============================================================================

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KB = join(REPO_ROOT, '..', '..', 'Knowledge Base');

const ARTICLES = [
  {
    source: 'Hospitality Industry (General) Award MA000009 — Pay Rates Reference (Level 1–3, Casual, Sunday & PH)',
    file: join(KB, 'Knowledge', 'hospitality-award-rates.md'),
    idPrefix: 'shared-ma000009-award-rates',
    venueState: null,
    lastUpdated: '2026-05-25',
  },
];

const FLAG = 'MIS-422: verbatim Sunday + PH penalty rates ingested from FWO Pay Guide MA000009 (eff 01/07/2025); Knowledge Agent 2026-05-25';

async function ingestAwardRates() {
  const summary = [];
  for (const article of ARTICLES) {
    const text = await readFile(article.file, 'utf8');
    const res = await ingestDocument({
      source: article.source,
      text,
      clientId: null,
      contentType: 'industry_standard',
      venueState: article.venueState,
      lastUpdated: article.lastUpdated,
      idPrefix: article.idPrefix,
      flags: [FLAG],
    });
    summary.push(res);
    console.log(`  [award-rates] ${res.source}: ${res.chunkCount} chunks`);
  }
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cs = process.env.DB_CONNECTION_STRING;
  if (!cs) {
    console.error('DB_CONNECTION_STRING is required');
    process.exit(1);
  }
  initDb({ db: { connectionString: cs, appRole: process.env.DB_APP_ROLE || 'mise_app' } });

  ingestAwardRates()
    .then(async (summary) => {
      const totalChunks = summary.reduce((n, s) => n + s.chunkCount, 0);
      console.log(`\n✓ Award rates ingested: ${summary.length} documents, ${totalChunks} chunks`);
      await closeDb();
    })
    .catch(async (err) => {
      console.error('Award rates ingestion failed:', err.message);
      console.error(err.stack);
      try { await closeDb(); } catch {}
      process.exit(1);
    });
}

export { ingestAwardRates };
