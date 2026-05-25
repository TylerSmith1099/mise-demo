// Re-ingest the 3 keyword-enriched documents (MIS-235 fix)
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KB = join(REPO_ROOT, '..', '..', 'Knowledge Base');
const CLIENT_ID = process.argv[2];
const flag = 'MIS-235: re-ingested with keyword-enriched headings (2026-05-24)';

async function main() {
  if (!CLIENT_ID) throw new Error('usage: node scripts/reingest-3-fixed.js <clientId>');
  initDb({ db: { connectionString: process.env.DB_CONNECTION_STRING, appRole: 'mise_app' } });

  let text, r;

  text = await readFile(join(KB, 'SOPs', 'Clearance', 'egm-clearance-procedure.md'), 'utf8');
  r = await ingestDocument({ source: 'Criterion SOP — EGM Clearance Procedure', text, clientId: CLIENT_ID, lastUpdated: '2026-05-24', idPrefix: 'criterion-sop-egm-clearance', flags: [flag] });
  console.log(`clearance: ${r.chunkCount} chunks`);

  text = await readFile(join(KB, 'SOPs', 'Operations', 'shift-handover.md'), 'utf8');
  r = await ingestDocument({ source: 'Criterion SOP — Shift Handover', text, clientId: CLIENT_ID, lastUpdated: '2026-05-24', idPrefix: 'criterion-sop-shift-handover', flags: [flag] });
  console.log(`handover: ${r.chunkCount} chunks`);

  text = await readFile(join(KB, 'Knowledge', 'hospitality-award-rates.md'), 'utf8');
  r = await ingestDocument({ source: 'Hospitality Industry Award MA000009 — Pay Rates Reference', text, clientId: null, contentType: 'industry_standard', venueState: null, lastUpdated: '2026-05-24', idPrefix: 'shared-hospitality-award-rates', flags: [flag] });
  console.log(`award rates: ${r.chunkCount} chunks`);

  await closeDb();
  console.log('done');
}

main().catch(async (err) => { console.error(err.message); try { await closeDb(); } catch {} process.exit(1); });
