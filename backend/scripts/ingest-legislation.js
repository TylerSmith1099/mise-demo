// Ingest the shared legislation corpus (client_id = null) into the knowledge
// base. Reusable as a module (ingestLegislation) and as a CLI:
//
//   DB_CONNECTION_STRING=... node scripts/ingest-legislation.js
//
// NOTE ON PATH/LANGUAGE: the Knowledge Agent brief referenced an
// `ingest-legislation.py`. The Mise app stack is Node/Express/pg (matching
// migrations/ + src/), so the pipeline is implemented in Node for consistency
// with the rest of the codebase, not Python. The behaviour is identical:
// parse -> chunk -> embed -> tag -> store -> log to manifest.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';

const KB = join(dirname(fileURLToPath(import.meta.url)), '..', 'Knowledge Base', 'Legislation');

// The shared legislation set required by the brief. QLD statutes are tagged
// venue_state 'QLD'; national instruments are state-agnostic (null = all states).
export const LEGISLATION = [
  { file: join(KB, 'QLD', 'gaming-machine-act-1991.md'),                source: 'Gaming Machine Act 1991 (QLD)',                          idPrefix: 'qld-gaming-machine-act-1991',  venueState: 'QLD',  lastUpdated: '2024-01-01', domain: 'gambling_rsg' },
  { file: join(KB, 'QLD', 'responsible-gambling-code-of-practice.md'),  source: 'Queensland Responsible Gambling Code of Practice',       idPrefix: 'qld-rg-code',                   venueState: 'QLD',  lastUpdated: '2024-01-01', domain: 'gambling_rsg' },
  { file: join(KB, 'QLD', 'liquor-act-1992.md'),                        source: 'Liquor Act 1992 (QLD)',                                 idPrefix: 'qld-liquor-act-1992',           venueState: 'QLD',  lastUpdated: '2024-01-01', domain: 'liquor_rsa' },
  { file: join(KB, 'QLD', 'work-health-safety-act-2011.md'),            source: 'Work Health and Safety Act 2011 (QLD)',                 idPrefix: 'qld-whs-act-2011',              venueState: 'QLD',  lastUpdated: '2024-01-01', domain: 'wphs' },
  { file: join(KB, 'National', 'fair-work-act-2009.md'),                source: 'Fair Work Act 2009 (Cth)',                              idPrefix: 'cth-fair-work-act-2009',        venueState: null,   lastUpdated: '2024-01-01', domain: 'employment' },
  { file: join(KB, 'National', 'hospitality-industry-general-award-2020.md'), source: 'Hospitality Industry (General) Award 2020',     idPrefix: 'cth-hospitality-award-2020',    venueState: null,   lastUpdated: '2024-07-01', domain: 'employment' },
  // AML/CTF Tranche-1 (commenced 31 Mar 2026). Legal-authored summary (MIS-92);
  // DEPLOY-FLAGGED pending solicitor sign-off — do NOT present as execution-ready.
  { file: join(KB, 'National', 'aml-ctf-act-2006.md'),                  source: 'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth)', idPrefix: 'cth-aml-ctf-act-2006', venueState: null, lastUpdated: '2026-03-31', domain: 'incident_reporting',
    flags: ['DEPLOY FLAG — Legal-drafted summary; solicitor sign-off pending (Ops/Questions.md). Confirm thresholds/dates/mechanics and load full consolidated statute + AUSTRAC rules before production.'] },
];

const DEPLOY_FLAG = 'representative sectioned summary — load full statute/award text at deploy';

export async function ingestLegislation(opts = {}) {
  const summary = [];
  for (const item of LEGISLATION) {
    const text = await readFile(item.file, 'utf8');
    const res = await ingestDocument({
      source: item.source,
      text,
      clientId: null, // shared legislation
      venueState: item.venueState,
      lastUpdated: item.lastUpdated,
      idPrefix: item.idPrefix,
      domain: item.domain ?? 'general',
      flags: item.flags ?? [DEPLOY_FLAG, 'production embedding model TBD at deploy (AU-hosted)'],
      manifestPath: opts.manifestPath,
    });
    summary.push(res);
  }
  return summary;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const cs = process.env.DB_CONNECTION_STRING;
  if (!cs) {
    console.error('DB_CONNECTION_STRING is required');
    process.exit(1);
  }
  initDb({ db: { connectionString: cs, appRole: process.env.DB_APP_ROLE || 'mise_app' } });
  ingestLegislation()
    .then((s) => {
      const total = s.reduce((n, d) => n + d.chunkCount, 0);
      console.log(`ingested ${s.length} documents, ${total} chunks (shared legislation)`);
      for (const d of s) console.log(`  - ${d.source}: ${d.chunkCount} chunks`);
    })
    .catch((err) => {
      console.error('ingestion failed:', err.message);
      process.exit(1);
    });
}
