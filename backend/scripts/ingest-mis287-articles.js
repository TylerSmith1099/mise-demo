// =============================================================================
// MIS-287 — Ingest the 6 QLD compliance/legislation articles authored by the
// R&D Officer (OLGR audit, harm-min, gap-fill, RSA/RSG specificity).
//
// All 6 are shared (client_id = null), QLD-scoped.
//   - 5 articles: contentType = 'legislation' (derived from QLD statute/code)
//   - 1 article:  contentType = 'industry_standard' (operational guidance)
//
// Run:
//   DB_CONNECTION_STRING=postgres://localhost/mise_eval \
//     node scripts/ingest-mis287-articles.js
// =============================================================================

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// From MISE/backend/ up two levels to the project root (_default/).
const KB = join(REPO_ROOT, '..', '..', 'Knowledge Base');

const LAST_UPDATED = '2026-05-25';
const FLAG = 'MIS-287: R&D Officer OLGR/harm-min/RSA/RSG gap-fill; ingested 2026-05-25';

// 5 QLD-legislation articles (statutory requirements, OLGR framework, certification).
export const LEGISLATION_ARTICLES = [
  {
    source: 'Gaming Machine Act 1991 (QLD) — Operational Requirements for Venues',
    file: join(KB, 'Legislation', 'QLD', 'gaming-machine-act-1991-operational-requirements.md'),
    idPrefix: 'qld-gma-1991-operational-requirements',
    venueState: 'QLD',
  },
  {
    source: 'OLGR QLD — Regulatory Framework, Inspections, and Penalties',
    file: join(KB, 'Compliance', 'QLD', 'olgr-regulatory-framework-and-compliance.md'),
    idPrefix: 'qld-olgr-regulatory-framework',
    venueState: 'QLD',
  },
  {
    source: 'QLD Gaming Venues — RSG Certification Requirements (SITHGAM022)',
    file: join(KB, 'Compliance', 'QLD', 'rsg-certification-requirements.md'),
    idPrefix: 'qld-rsg-certification-requirements',
    venueState: 'QLD',
  },
  {
    source: 'QLD Gaming Venues — RSA Certification Requirements (SITHFAB021)',
    file: join(KB, 'Compliance', 'QLD', 'rsa-certification-requirements.md'),
    idPrefix: 'qld-rsa-certification-requirements',
    venueState: 'QLD',
  },
  {
    source: 'QLD Gaming Venues — Self-Exclusion and Exclusion Directions',
    file: join(KB, 'Compliance', 'QLD', 'self-exclusion-and-exclusion-directions.md'),
    idPrefix: 'qld-self-exclusion-directions',
    venueState: 'QLD',
  },
];

// 1 industry_standard article (operational guidance grounded in the RG Code).
export const GUIDANCE_ARTICLES = [
  {
    source: 'Harm Minimisation and Patron Wellbeing — QLD Gaming Floor Guidance',
    file: join(KB, 'Compliance', 'QLD', 'harm-minimisation-and-patron-wellbeing.md'),
    idPrefix: 'qld-harm-minimisation-patron-wellbeing',
    venueState: 'QLD',
  },
];

export async function ingestMis287Articles() {
  const summary = [];

  for (const article of LEGISLATION_ARTICLES) {
    const text = await readFile(article.file, 'utf8');
    const res = await ingestDocument({
      source: article.source,
      text,
      clientId: null,
      contentType: 'legislation',
      venueState: article.venueState,
      lastUpdated: LAST_UPDATED,
      idPrefix: article.idPrefix,
      flags: [FLAG],
    });
    summary.push({ ...res, track: 'legislation' });
    console.log(`  [legislation] ${res.source}: ${res.chunkCount} chunks`);
  }

  for (const article of GUIDANCE_ARTICLES) {
    const text = await readFile(article.file, 'utf8');
    const res = await ingestDocument({
      source: article.source,
      text,
      clientId: null,
      contentType: 'industry_standard',
      venueState: article.venueState,
      lastUpdated: LAST_UPDATED,
      idPrefix: article.idPrefix,
      flags: [FLAG],
    });
    summary.push({ ...res, track: 'industry_standard' });
    console.log(`  [industry_standard] ${res.source}: ${res.chunkCount} chunks`);
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

  console.log('Ingesting MIS-287 QLD compliance articles...');
  ingestMis287Articles()
    .then(async (summary) => {
      const total = summary.reduce((n, s) => n + s.chunkCount, 0);
      console.log(`\n✓ Ingested ${summary.length} articles, ${total} chunks`);
      await closeDb();
    })
    .catch(async (err) => {
      console.error('Ingestion failed:', err.message);
      console.error(err.stack);
      try { await closeDb(); } catch {}
      process.exit(1);
    });
}
