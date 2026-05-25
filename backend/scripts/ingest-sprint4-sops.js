// =============================================================================
// MIS-286 — Ingest Sprint 4 Task 1 SOPs authored by the Technical Writer.
//
// 8 SOPs — all CLIENT-scoped (Pinnacle Hotel Group):
//   1. Cash Management Procedures
//   2. RSA Procedures (supersedes thin Sprint 3 version)
//   3. RSG Patron Interaction Procedures (supersedes thin Sprint 3 version)
//   4. Modern Slavery Procedures
//   5. Values and Behaviours
//   6. Code of Conduct Procedures
//   7. HR and Payroll Procedures
//   8. Opening and Closing Procedures (DM + Gaming Attendant)
//
// Source names for RSA and RSG deliberately match the existing DB rows so the
// supersede-on-reingest mechanism archives the thin Sprint 3 versions.
//
// Run:
//   DB_CONNECTION_STRING=postgres://localhost/mise_eval \
//     node scripts/ingest-sprint4-sops.js <pinnacleClientId>
// =============================================================================

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KB = join(REPO_ROOT, '..', '..', 'Knowledge Base');
const SOPS_DIR = join(KB, 'SOPs');

const SPRINT4_SOPS = [
  {
    // Supersedes "Criterion SOP — Cash Management" (not yet ingested from Sprint 3)
    source: 'Criterion SOP — Cash Management Procedures',
    file: join(SOPS_DIR, 'Cash-Management', 'cash-management-procedures.md'),
    idPrefix: 'criterion-sop-cash-management',
    lastUpdated: '2026-05-25',
  },
  {
    // Supersedes "Criterion SOP — Responsible Service of Alcohol" (3 thin chunks in DB)
    source: 'Criterion SOP — Responsible Service of Alcohol',
    file: join(SOPS_DIR, 'RSA', 'rsa-procedures.md'),
    idPrefix: 'criterion-sop-rsa',
    lastUpdated: '2026-05-25',
  },
  {
    // Supersedes "Criterion SOP — Responsible Gambling Patron Interaction" (2 thin chunks in DB)
    source: 'Criterion SOP — Responsible Gambling Patron Interaction',
    file: join(SOPS_DIR, 'Risk-Management', 'responsible-gambling-patron-interaction-procedures.md'),
    idPrefix: 'criterion-sop-rg-interaction',
    lastUpdated: '2026-05-25',
  },
  {
    source: 'Criterion SOP — Modern Slavery Procedures',
    file: join(SOPS_DIR, 'Risk-Management', 'modern-slavery-procedures.md'),
    idPrefix: 'criterion-sop-modern-slavery',
    lastUpdated: '2026-05-25',
  },
  {
    source: 'Criterion SOP — Values and Behaviours',
    file: join(SOPS_DIR, 'HR-Onboarding', 'values-and-behaviours.md'),
    idPrefix: 'criterion-sop-values-behaviours',
    lastUpdated: '2026-05-25',
  },
  {
    source: 'Criterion SOP — Code of Conduct Procedures',
    file: join(SOPS_DIR, 'HR-Onboarding', 'code-of-conduct-procedures.md'),
    idPrefix: 'criterion-sop-code-of-conduct',
    lastUpdated: '2026-05-25',
  },
  {
    source: 'Criterion SOP — HR and Payroll Procedures',
    file: join(SOPS_DIR, 'HR-Onboarding', 'hr-and-payroll-procedures.md'),
    idPrefix: 'criterion-sop-hr-payroll',
    lastUpdated: '2026-05-25',
  },
  {
    source: 'Criterion SOP — Opening and Closing Procedures',
    file: join(SOPS_DIR, 'HR-Onboarding', 'opening-closing-procedures.md'),
    idPrefix: 'criterion-sop-opening-closing',
    lastUpdated: '2026-05-25',
  },
];

async function ingestSprint4Sops(clientId) {
  const summary = [];
  const flag = 'MIS-286: Sprint 4 Task 1 SOPs — authored by Technical Writer, ingested 2026-05-25';

  for (const sop of SPRINT4_SOPS) {
    const text = await readFile(sop.file, 'utf8');
    const res = await ingestDocument({
      source: sop.source,
      text,
      clientId,
      venueState: null,
      lastUpdated: sop.lastUpdated,
      idPrefix: sop.idPrefix,
      flags: [flag, 'original non-client-IP industry procedure; QLD standards'],
    });
    summary.push(res);
    console.log(`  ✓ ${res.source}: ${res.chunkCount} chunks`);
  }

  return summary;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const clientId = process.argv[2];
  if (!clientId) {
    console.error('Usage: DB_CONNECTION_STRING=... node scripts/ingest-sprint4-sops.js <pinnacleClientId>');
    process.exit(1);
  }
  const cs = process.env.DB_CONNECTION_STRING;
  if (!cs) {
    console.error('DB_CONNECTION_STRING is required');
    process.exit(1);
  }
  initDb({ db: { connectionString: cs, appRole: process.env.DB_APP_ROLE || 'mise_app' } });

  ingestSprint4Sops(clientId)
    .then(async (summary) => {
      const totalChunks = summary.reduce((n, s) => n + s.chunkCount, 0);
      console.log(`\n✓ Sprint 4 SOP ingestion complete: ${summary.length} SOPs, ${totalChunks} chunks total`);
      console.log(`  Client: ${clientId}`);
      await closeDb();
    })
    .catch(async (err) => {
      console.error('Sprint 4 SOP ingestion failed:', err.message);
      console.error(err.stack);
      try { await closeDb(); } catch {}
      process.exit(1);
    });
}

export { ingestSprint4Sops };
