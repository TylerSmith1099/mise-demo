// =============================================================================
// MIS-392 — Retrieval verification for newly ingested KB documents.
//
// Tests one representative query per ingested document (11 docs).
// Pass criterion: chunk from the expected source appears in top-5 results.
// Target: ≥8/10 pass rate (minimum 8/11 = 9 needed at ≥72.7%).
// Score is reported as X/11 and as X/10 (scaled, per MIS-287 standard).
//
// Run:
//   DB_CONNECTION_STRING=postgres://localhost/mise_eval \
//     CLIENT_ID=<client-uuid> VENUE_STATE=QLD \
//     node scripts/verify-mis392-retrieval.js
// =============================================================================

import { initDb, closeDb } from '../src/db.js';
import { retrieveChunks } from '../src/rag/retrieve.js';

const CLIENT_ID = process.env.CLIENT_ID || '00833ee8-b3a9-42cb-8e42-7b8db2825b94';
const VENUE_ID = process.env.VENUE_ID || null;
const VENUE_STATE = process.env.VENUE_STATE || 'QLD';

// Each entry: { query, expectedIdPrefix, label }
// expectedIdPrefix is the leading token in the chunk_id to match against.
const TESTS = [
  // --- Conflict Management ---
  {
    label: 'Conflict de-escalation',
    query: 'How should staff approach an intoxicated patron without triggering aggression?',
    expectedIdPrefix: 'shared-conflict-de-escalation',
  },
  {
    label: 'Intoxication assessment',
    query: 'What are the observable indicators that a patron is intoxicated versus tired or medicated?',
    expectedIdPrefix: 'shared-intoxication-assessment',
  },
  {
    label: 'Difficult patron management',
    query: 'How do we ask someone to leave the venue without causing a public confrontation?',
    expectedIdPrefix: 'shared-difficult-patron-management',
  },
  {
    label: 'Interpersonal coaching junior staff',
    query: 'What language should junior staff use to escalate a difficult situation to a supervisor?',
    expectedIdPrefix: 'shared-interpersonal-coaching-junior-staff',
  },
  // --- Emergency Response ---
  {
    label: 'Armed robbery response',
    query: 'What should staff do during an armed robbery at the venue?',
    expectedIdPrefix: 'shared-armed-robbery-response',
  },
  {
    label: 'Threat and extortion',
    query: 'How should we respond to a verbal threat or extortion attempt?',
    expectedIdPrefix: 'shared-threat-and-extortion',
  },
  {
    label: 'Welfare and empathy high stress',
    query: 'How should a manager support staff after a traumatic incident?',
    expectedIdPrefix: 'shared-welfare-and-empathy-high-stress',
  },
  // --- Incident Reporting ---
  {
    label: 'OLGR incident reporting QLD',
    query: 'What incidents need to be reported to OLGR under the Queensland Liquor Act?',
    expectedIdPrefix: 'shared-olgr-incident-reporting-qld',
  },
  {
    label: 'AUSTRAC AML/CTF reporting',
    query: 'When must we submit a suspicious matter report to AUSTRAC for gaming?',
    expectedIdPrefix: 'shared-aml-ctf-austrac-reporting',
  },
  {
    label: 'In-house incident reporting',
    query: 'What fields are required in an internal incident report?',
    expectedIdPrefix: 'shared-in-house-incident-reporting',
  },
  {
    label: 'Incident reporting obligations matrix',
    query: 'Which types of incidents trigger reporting obligations to OLGR versus AUSTRAC?',
    expectedIdPrefix: 'shared-incident-reporting-obligations-matrix',
  },
];

async function runVerification() {
  let passed = 0;
  const results = [];

  for (const t of TESTS) {
    const { results: chunks, topScore, lowConfidence } = await retrieveChunks({
      clientId: CLIENT_ID,
      venueId: VENUE_ID,
      venueState: VENUE_STATE,
      queryText: t.query,
    });

    const hit = chunks.some((c) => c.chunkId?.startsWith(t.expectedIdPrefix));
    const top = chunks[0];
    if (hit) passed++;
    results.push({
      label: t.label,
      pass: hit,
      topScore: topScore?.toFixed(3),
      lowConfidence,
      topSource: top?.source ?? '(none)',
      matchedIn: hit
        ? `#${chunks.findIndex((c) => c.chunkId?.startsWith(t.expectedIdPrefix)) + 1}`
        : 'MISS',
    });
  }

  console.log('\n=== MIS-392 Retrieval Verification ===\n');
  for (const r of results) {
    const icon = r.pass ? '✓' : '✗';
    const flag = r.lowConfidence ? ' [low-conf]' : '';
    console.log(`${icon} ${r.label.padEnd(40)} score=${r.topScore}${flag}  pos=${r.matchedIn}`);
    if (!r.pass) console.log(`    top hit: ${r.topSource}`);
  }

  const total = TESTS.length;
  const scaledPer10 = Math.round((passed / total) * 10 * 10) / 10;
  console.log(`\nResult: ${passed}/${total} passed (${scaledPer10}/10 scaled)`);
  console.log(passed >= 9 ? '✓ PASS — meets ≥8/10 standard' : '✗ FAIL — below ≥8/10 standard');
  return { passed, total, scaledPer10 };
}

const cs = process.env.DB_CONNECTION_STRING;
if (!cs) {
  console.error('DB_CONNECTION_STRING is required');
  process.exit(1);
}
initDb({ db: { connectionString: cs, appRole: process.env.DB_APP_ROLE || 'mise_app' } });

runVerification()
  .then(async ({ passed, total, scaledPer10 }) => {
    await closeDb();
    process.exit(passed >= 9 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error('Verification failed:', err.message);
    console.error(err.stack);
    try { await closeDb(); } catch {}
    process.exit(1);
  });
