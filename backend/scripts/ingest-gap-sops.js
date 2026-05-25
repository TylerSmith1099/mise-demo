// =============================================================================
// MIS-235 — Ingest all Section B authored SOPs and knowledge articles from the
// MIS-233 Knowledge Gap Analysis (V1).
//
// Two ingestion tracks:
//   CLIENT SOPs (contentType='sop', clientId=pinnacleClientId):
//     B.1  EGM clearance procedure
//     B.2  Meter read and gaming floor log
//     B.3  Shift handover SOP
//     B.4  RG patron interaction step-by-step script
//     B.5  Self-exclusion registration process
//     B.6  Staff certification RSA/RSG
//     B.7  RSA refusal language
//     B.10 Cash, bar float, and department open/close
//     B.11 Incident reporting notification thresholds
//     B.12 Aggressive patron, removal and barring
//
//   SHARED KNOWLEDGE (contentType='industry_standard', clientId=null):
//     B.8  Hospitality Award MA000009 rate reference
//     B.9  Labour benchmarks and gaming RTV
//     B.13 Fair Work — right to disconnect
//     B.14 CCTV retention guidance
//     B.15 OLGR context
//
// Run:
//   DB_CONNECTION_STRING=postgres://localhost/mise_eval \
//     node scripts/ingest-gap-sops.js <pinnacleClientId>
// =============================================================================

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KB = join(REPO_ROOT, '..', '..', 'Knowledge Base');

// ---------------------------------------------------------------------------
// CLIENT SOPs — bound to Pinnacle Hotel Group / The Criterion Hotel demo.
// ---------------------------------------------------------------------------
const CLIENT_SOPS = [
  {
    source: 'Criterion SOP — EGM Clearance Procedure',
    file: join(KB, 'SOPs', 'Clearance', 'egm-clearance-procedure.md'),
    idPrefix: 'criterion-sop-egm-clearance',
    lastUpdated: '2026-05-24',
  },
  {
    source: 'Criterion SOP — Meter Read and Gaming Floor Log',
    file: join(KB, 'SOPs', 'Clearance', 'meter-read-gaming-floor-log.md'),
    idPrefix: 'criterion-sop-meter-read',
    lastUpdated: '2026-05-24',
  },
  {
    source: 'Criterion SOP — Shift Handover',
    file: join(KB, 'SOPs', 'Operations', 'shift-handover.md'),
    idPrefix: 'criterion-sop-shift-handover',
    lastUpdated: '2026-05-24',
  },
  {
    source: 'Criterion SOP — Responsible Gambling Patron Interaction Script',
    file: join(KB, 'SOPs', 'Gaming', 'rg-patron-interaction-script.md'),
    idPrefix: 'criterion-sop-rg-interaction-script',
    lastUpdated: '2026-05-24',
  },
  {
    source: 'Criterion SOP — Self-Exclusion Registration',
    file: join(KB, 'SOPs', 'Gaming', 'self-exclusion-registration.md'),
    idPrefix: 'criterion-sop-self-exclusion',
    lastUpdated: '2026-05-24',
  },
  {
    source: 'Criterion SOP — Staff Certification RSA and RSG',
    file: join(KB, 'SOPs', 'Certifications', 'staff-certification-rsa-rsg.md'),
    idPrefix: 'criterion-sop-staff-certs',
    lastUpdated: '2026-05-24',
  },
  {
    source: 'Criterion SOP — RSA Refusal Language',
    file: join(KB, 'SOPs', 'RSA', 'rsa-refusal-language.md'),
    idPrefix: 'criterion-sop-rsa-refusal',
    lastUpdated: '2026-05-24',
  },
  {
    source: 'Criterion SOP — Cash Management, Bar Float, and Department Open/Close',
    file: join(KB, 'SOPs', 'Operations', 'cash-float-operations.md'),
    idPrefix: 'criterion-sop-cash-float',
    lastUpdated: '2026-05-24',
  },
  {
    source: 'Criterion SOP — Incident Reporting: Mandatory Notification Thresholds',
    file: join(KB, 'SOPs', 'Operations', 'incident-notification-thresholds.md'),
    idPrefix: 'criterion-sop-incident-thresholds',
    lastUpdated: '2026-05-24',
  },
  {
    source: 'Criterion SOP — Aggressive Patron, Removal, and Barring',
    file: join(KB, 'SOPs', 'Operations', 'aggressive-patron-barring.md'),
    idPrefix: 'criterion-sop-aggressive-patron',
    lastUpdated: '2026-05-24',
  },
];

// ---------------------------------------------------------------------------
// SHARED KNOWLEDGE ARTICLES — clientId=null, contentType='industry_standard'.
// Available to all clients and all states.
// ---------------------------------------------------------------------------
const SHARED_KNOWLEDGE = [
  {
    source: 'Hospitality Industry Award MA000009 — Pay Rates Reference',
    file: join(KB, 'Knowledge', 'hospitality-award-rates.md'),
    idPrefix: 'shared-hospitality-award-rates',
    lastUpdated: '2026-05-24',
    venueState: null,
  },
  {
    source: 'Labour Benchmarks and Gaming RTV',
    file: join(KB, 'Knowledge', 'labour-benchmarks-gaming-rtv.md'),
    idPrefix: 'shared-labour-benchmarks',
    lastUpdated: '2026-05-24',
    venueState: null,
  },
  {
    source: 'Fair Work Act 2009 — Right to Disconnect',
    file: join(KB, 'Knowledge', 'fair-work-right-to-disconnect.md'),
    idPrefix: 'shared-fair-work-right-to-disconnect',
    lastUpdated: '2026-05-24',
    venueState: null,
  },
  {
    source: 'CCTV Retention Guidance',
    file: join(KB, 'Knowledge', 'cctv-retention-guidance.md'),
    idPrefix: 'shared-cctv-retention',
    lastUpdated: '2026-05-24',
    venueState: null,
  },
  {
    source: 'OLGR — Role, Inspection Powers, and Compliance Context',
    file: join(KB, 'Knowledge', 'olgr-context.md'),
    idPrefix: 'shared-olgr-context',
    lastUpdated: '2026-05-24',
    venueState: 'QLD',
  },
];

async function ingestGapSops(clientId) {
  const summary = [];
  const demoFlag = 'MIS-235: gap-analysis authored content (non-client-IP); ingested 2026-05-24';

  // --- Client SOPs ---
  for (const sop of CLIENT_SOPS) {
    const text = await readFile(sop.file, 'utf8');
    const res = await ingestDocument({
      source: sop.source,
      text,
      clientId,
      venueState: null, // sop layer: venue_state normalised to NULL by ingestDocument
      lastUpdated: sop.lastUpdated,
      idPrefix: sop.idPrefix,
      flags: [demoFlag, 'original non-client-IP industry procedure'],
    });
    summary.push({ ...res, track: 'sop' });
    console.log(`  [sop]  ${res.source}: ${res.chunkCount} chunks`);
  }

  // --- Shared knowledge articles ---
  for (const article of SHARED_KNOWLEDGE) {
    const text = await readFile(article.file, 'utf8');
    const res = await ingestDocument({
      source: article.source,
      text,
      clientId: null,
      contentType: 'industry_standard',
      venueState: article.venueState ?? null,
      lastUpdated: article.lastUpdated,
      idPrefix: article.idPrefix,
      flags: [demoFlag, 'shared knowledge article (industry_standard layer)'],
    });
    summary.push({ ...res, track: 'shared' });
    console.log(`  [shared] ${res.source}: ${res.chunkCount} chunks`);
  }

  return summary;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const clientId = process.argv[2];
  if (!clientId) {
    console.error('Usage: DB_CONNECTION_STRING=... node scripts/ingest-gap-sops.js <pinnacleClientId>');
    process.exit(1);
  }
  const cs = process.env.DB_CONNECTION_STRING;
  if (!cs) {
    console.error('DB_CONNECTION_STRING is required');
    process.exit(1);
  }
  initDb({ db: { connectionString: cs, appRole: process.env.DB_APP_ROLE || 'mise_app' } });

  ingestGapSops(clientId)
    .then(async (summary) => {
      const sops = summary.filter((s) => s.track === 'sop');
      const shared = summary.filter((s) => s.track === 'shared');
      const totalChunks = summary.reduce((n, s) => n + s.chunkCount, 0);
      console.log(`\n✓ Ingestion complete: ${summary.length} documents, ${totalChunks} chunks`);
      console.log(`  SOPs (client ${clientId}): ${sops.length} docs, ${sops.reduce((n, s) => n + s.chunkCount, 0)} chunks`);
      console.log(`  Shared knowledge: ${shared.length} docs, ${shared.reduce((n, s) => n + s.chunkCount, 0)} chunks`);
      await closeDb();
    })
    .catch(async (err) => {
      console.error('Gap SOP ingestion failed:', err.message);
      console.error(err.stack);
      try { await closeDb(); } catch {}
      process.exit(1);
    });
}

export { ingestGapSops };
