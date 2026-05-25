// =============================================================================
// MIS-289 — Ingest the 5 MIS-287 compliance/OLGR knowledge articles.
//
// These are shared (clientId = null), contentType = 'industry_standard',
// venue_state = 'QLD'. They are purpose-written citable articles covering:
//
//   C.1  RSA certification requirements (QLD)  — Compliance/QLD/rsa-certification-requirements.md
//   C.2  RSG certification requirements (QLD)  — Compliance/QLD/rsg-certification-requirements.md
//   C.3  Harm minimisation + patron wellbeing   — Compliance/QLD/harm-minimisation-and-patron-wellbeing.md
//   C.4  OLGR regulatory framework + penalties  — Compliance/QLD/olgr-regulatory-framework-and-compliance.md
//   C.5  Self-exclusion + exclusion directions  — Compliance/QLD/self-exclusion-and-exclusion-directions.md
//
// These supersede thin RG Code + Liquor Act chunks for certification/OLGR
// questions. No client ID needed — they are visible to all QLD clients.
//
// Run:
//   DB_CONNECTION_STRING=postgres://localhost/mise_eval \
//     node scripts/ingest-compliance-articles.js
// =============================================================================

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPLIANCE_KB = join(REPO_ROOT, '..', '..', 'Knowledge Base', 'Compliance', 'QLD');

const ARTICLES = [
  {
    source: 'OLGR — RSA Certification Requirements (QLD)',
    file: join(COMPLIANCE_KB, 'rsa-certification-requirements.md'),
    idPrefix: 'shared-qld-rsa-cert-requirements',
    venueState: 'QLD',
    lastUpdated: '2026-05-25',
  },
  {
    source: 'OLGR — RSG Certification Requirements (QLD)',
    file: join(COMPLIANCE_KB, 'rsg-certification-requirements.md'),
    idPrefix: 'shared-qld-rsg-cert-requirements',
    venueState: 'QLD',
    lastUpdated: '2026-05-25',
  },
  {
    source: 'Harm Minimisation and Patron Wellbeing — QLD Gaming Floor',
    file: join(COMPLIANCE_KB, 'harm-minimisation-and-patron-wellbeing.md'),
    idPrefix: 'shared-qld-harm-minimisation',
    venueState: 'QLD',
    lastUpdated: '2026-05-25',
  },
  {
    source: 'OLGR Regulatory Framework, Inspections and Penalties (QLD)',
    file: join(COMPLIANCE_KB, 'olgr-regulatory-framework-and-compliance.md'),
    idPrefix: 'shared-qld-olgr-framework',
    venueState: 'QLD',
    lastUpdated: '2026-05-25',
  },
  {
    source: 'Self-Exclusion and Exclusion Directions — QLD Gaming Floor',
    file: join(COMPLIANCE_KB, 'self-exclusion-and-exclusion-directions.md'),
    idPrefix: 'shared-qld-self-exclusion',
    venueState: 'QLD',
    lastUpdated: '2026-05-25',
  },
];

const FLAG = 'MIS-287: R&D citable compliance article (industry_standard); ingested 2026-05-25';

async function ingestComplianceArticles() {
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
      flags: [FLAG, 'non-client-IP regulatory guidance; DEPLOY FLAG: confirm figures against live OLGR before production'],
    });
    summary.push(res);
    console.log(`  [compliance] ${res.source}: ${res.chunkCount} chunks`);
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

  ingestComplianceArticles()
    .then(async (summary) => {
      const totalChunks = summary.reduce((n, s) => n + s.chunkCount, 0);
      console.log(`\n✓ Compliance articles ingested: ${summary.length} documents, ${totalChunks} chunks`);
      await closeDb();
    })
    .catch(async (err) => {
      console.error('Compliance article ingestion failed:', err.message);
      console.error(err.stack);
      try { await closeDb(); } catch {}
      process.exit(1);
    });
}

export { ingestComplianceArticles };
