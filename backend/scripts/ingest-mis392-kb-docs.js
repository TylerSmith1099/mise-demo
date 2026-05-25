// =============================================================================
// MIS-392 — Ingest new KB documents produced by R&D (MIS-377: Knowledge
// Enrichment for RSA Response Redesign). Three topic areas:
//
//   Conflict-Management (4 docs, shared industry_standard, venueState=null)
//   Emergency-Response  (3 docs, shared industry_standard, venueState=null)
//                       NOTE: first-aid-principles.md EXCLUDED pending Legal
//                       clearance (MIS-379). Ingest after Legal approves.
//   Incident-Reporting  (4 docs, shared industry_standard)
//                       olgr-*: venueState='QLD'; austrac/in-house/matrix: null
//
// All are client_id=null (shared layer), per MIS-377 recommendation.
//
// Run:
//   DB_CONNECTION_STRING=postgres://localhost/mise_eval \
//     node scripts/ingest-mis392-kb-docs.js
// =============================================================================

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KB = join(REPO_ROOT, '..', '..', 'Knowledge Base');

const LAST_UPDATED = '2026-05-25';
const FLAG = 'MIS-392: R&D Officer MIS-377 knowledge enrichment (conflict, emergency, incident-reporting); ingested 2026-05-25';

// ---------------------------------------------------------------------------
// Conflict Management — 4 docs, shared, no state restriction.
// ---------------------------------------------------------------------------
const CONFLICT_DOCS = [
  {
    source: 'Hospitality Conflict De-escalation — Voice, Posture, and Approach',
    file: join(KB, 'Hospitality', 'Conflict-Management', 'conflict-de-escalation.md'),
    idPrefix: 'shared-conflict-de-escalation',
    venueState: null,
  },
  {
    source: 'Intoxication Assessment — Observable Indicators and Approach',
    file: join(KB, 'Hospitality', 'Conflict-Management', 'intoxication-assessment.md'),
    idPrefix: 'shared-intoxication-assessment',
    venueState: null,
  },
  {
    source: 'Difficult Patron Management — Asking to Leave, Security, Refusal',
    file: join(KB, 'Hospitality', 'Conflict-Management', 'difficult-patron-management.md'),
    idPrefix: 'shared-difficult-patron-management',
    venueState: null,
  },
  {
    source: 'Interpersonal Coaching for Junior Staff — Confidence and Escalation Language',
    file: join(KB, 'Hospitality', 'Conflict-Management', 'interpersonal-coaching-junior-staff.md'),
    idPrefix: 'shared-interpersonal-coaching-junior-staff',
    venueState: null,
  },
];

// ---------------------------------------------------------------------------
// Emergency Response — 3 docs (first-aid EXCLUDED until MIS-379 Legal clears).
// ---------------------------------------------------------------------------
const EMERGENCY_DOCS = [
  {
    source: 'Armed Robbery Response — Compliance, Documentation, and Staff Safety',
    file: join(KB, 'Hospitality', 'Emergency-Response', 'armed-robbery-response.md'),
    idPrefix: 'shared-armed-robbery-response',
    venueState: null,
  },
  {
    source: 'Threat and Extortion — Verbal, Written, Who to Call, Documentation',
    file: join(KB, 'Hospitality', 'Emergency-Response', 'threat-and-extortion.md'),
    idPrefix: 'shared-threat-and-extortion',
    venueState: null,
  },
  {
    source: 'Welfare and Empathy Under High Stress — Tone, Phrasing, and Staff Debriefing',
    file: join(KB, 'Hospitality', 'Emergency-Response', 'welfare-and-empathy.md'),
    idPrefix: 'shared-welfare-and-empathy-high-stress',
    venueState: null,
  },
];

// ---------------------------------------------------------------------------
// Incident Reporting — 4 docs.
// OLGR is QLD-scoped. AUSTRAC/in-house/matrix are national (venueState=null).
// ---------------------------------------------------------------------------
const INCIDENT_DOCS = [
  {
    source: 'OLGR QLD — Incident Reporting: Liquor Act 1992 and Gaming Machine Act 1991',
    file: join(KB, 'Compliance', 'Incident-Reporting', 'olgr-reporting-qld.md'),
    idPrefix: 'shared-olgr-incident-reporting-qld',
    venueState: 'QLD',
  },
  {
    source: 'AUSTRAC AML/CTF Reporting — SMR, TTR, Tipping-Off, Gaming Pub Reference',
    file: join(KB, 'Compliance', 'Incident-Reporting', 'aml-ctf-austrac-reporting.md'),
    idPrefix: 'shared-aml-ctf-austrac-reporting',
    venueState: null,
  },
  {
    source: 'In-House Incident Reporting — Standard Format and Field Requirements',
    file: join(KB, 'Compliance', 'Incident-Reporting', 'in-house-incident-reporting.md'),
    idPrefix: 'shared-in-house-incident-reporting',
    venueState: null,
  },
  {
    source: 'Incident-Type to Reporting-Obligation Matrix — QLD Venues (OLGR + AUSTRAC + In-House)',
    file: join(KB, 'Compliance', 'Incident-Reporting', 'incident-reporting-obligations-matrix.md'),
    idPrefix: 'shared-incident-reporting-obligations-matrix',
    venueState: 'QLD',
  },
];

const ALL_DOCS = [
  { track: 'conflict', docs: CONFLICT_DOCS },
  { track: 'emergency', docs: EMERGENCY_DOCS },
  { track: 'incident-reporting', docs: INCIDENT_DOCS },
];

async function ingestMis392KbDocs() {
  const summary = [];

  for (const { track, docs } of ALL_DOCS) {
    for (const doc of docs) {
      const text = await readFile(doc.file, 'utf8');
      const res = await ingestDocument({
        source: doc.source,
        text,
        clientId: null,
        contentType: 'industry_standard',
        venueState: doc.venueState,
        lastUpdated: LAST_UPDATED,
        idPrefix: doc.idPrefix,
        flags: [FLAG],
      });
      summary.push({ ...res, track });
      console.log(`  [${track}] ${res.source}: ${res.chunkCount} chunks`);
    }
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

  ingestMis392KbDocs()
    .then(async (summary) => {
      const totalChunks = summary.reduce((n, s) => n + s.chunkCount, 0);
      console.log(`\n✓ MIS-392 ingestion complete: ${summary.length} documents, ${totalChunks} chunks`);
      const byTrack = {};
      for (const s of summary) {
        byTrack[s.track] = (byTrack[s.track] || 0) + s.chunkCount;
      }
      for (const [track, chunks] of Object.entries(byTrack)) {
        console.log(`  ${track}: ${chunks} chunks`);
      }
      console.log('\nNOTE: first-aid-principles.md NOT ingested — awaiting Legal clearance (MIS-379).');
      await closeDb();
    })
    .catch(async (err) => {
      console.error('MIS-392 ingestion failed:', err.message);
      console.error(err.stack);
      try { await closeDb(); } catch {}
      process.exit(1);
    });
}

export { ingestMis392KbDocs };
