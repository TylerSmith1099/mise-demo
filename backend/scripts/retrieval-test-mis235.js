// =============================================================================
// MIS-235 — Retrieval tests for all ingested gap-analysis content.
//
// Tests the 7 priority categories from the issue + additional Section B tests.
// PASS = the expected source/concept surfaces in top-5 results with confidence
//        above the model-calibrated floor.
// FAIL = expected source absent from top-5 OR confidence below floor.
//
// Run:
//   DB_CONNECTION_STRING=postgres://localhost/mise_eval \
//     node scripts/retrieval-test-mis235.js <pinnacleClientId>
// =============================================================================

import { initDb, closeDb } from '../src/db.js';
import { retrieveChunks, CONFIDENCE_FLOOR } from '../src/rag/retrieve.js';

const CLIENT_ID = process.argv[2];
const VENUE_ID = null;
const VENUE_STATE = 'QLD';

// ---------------------------------------------------------------------------
// Test definitions. Each test has:
//   q         — natural-language question (as a user would ask)
//   category  — priority category label
//   expect    — array of partial source/section strings that must appear in top-5
//   priority  — P0/P1/P2
// ---------------------------------------------------------------------------
const TESTS = [
  // -------------------------------------------------------------------------
  // PRIORITY CATEGORY 1 — RG Patron Interaction
  // -------------------------------------------------------------------------
  {
    category: 'RG patron interaction',
    q: 'A patron has been at the same machine for four hours. What do I do?',
    expect: ['Responsible Gambling', 'RG'],
    priority: 'P0',
  },
  {
    category: 'RG patron interaction',
    q: 'How do I approach a distressed patron on the gaming floor?',
    expect: ['Responsible Gambling Patron Interaction Script', 'RG'],
    priority: 'P0',
  },
  {
    category: 'RG patron interaction',
    q: 'What do I say to a patron who looks like they are chasing losses?',
    expect: ['Responsible Gambling'],
    priority: 'P0',
  },

  // -------------------------------------------------------------------------
  // PRIORITY CATEGORY 2 — RSA Refusal
  // -------------------------------------------------------------------------
  {
    category: 'RSA refusal',
    q: 'What do I say to refuse a drink to an intoxicated customer?',
    expect: ['RSA Refusal Language', 'Refusal'],
    priority: 'P0',
  },
  {
    category: 'RSA refusal',
    q: 'An intoxicated patron is arguing about being refused alcohol. What do I say?',
    expect: ['RSA', 'Refusal'],
    priority: 'P0',
  },

  // -------------------------------------------------------------------------
  // PRIORITY CATEGORY 3 — EGM Malfunction / Clearance
  // -------------------------------------------------------------------------
  {
    category: 'EGM malfunction/clearance',
    q: 'A gaming machine is showing an error. What is the procedure?',
    expect: ['Gaming Floor', 'EGM'],
    priority: 'P0',
  },
  {
    category: 'EGM malfunction/clearance',
    q: 'How do I clear a gaming machine?',
    expect: ['Clearance', 'EGM Clearance'],
    priority: 'P0',
  },
  {
    category: 'EGM malfunction/clearance',
    q: 'What are the steps for an EGM clearance?',
    expect: ['Clearance'],
    priority: 'P0',
  },

  // -------------------------------------------------------------------------
  // PRIORITY CATEGORY 4 — Cash Management
  // -------------------------------------------------------------------------
  {
    category: 'Cash management',
    q: 'How do I handle a cash variance at the end of a shift?',
    expect: ['Cash', 'Float'],
    priority: 'P0',
  },
  {
    category: 'Cash management',
    q: 'What is the procedure for setting up a bar float?',
    expect: ['Cash', 'Float', 'Bar Float'],
    priority: 'P0',
  },

  // -------------------------------------------------------------------------
  // PRIORITY CATEGORY 5 — Shift Handover
  // -------------------------------------------------------------------------
  {
    category: 'Shift handover',
    q: 'What must a handover note include?',
    expect: ['Shift Handover', 'Handover'],
    priority: 'P0',
  },
  {
    category: 'Shift handover',
    q: 'What does the incoming duty manager need to check at shift start?',
    expect: ['Shift Handover', 'Handover'],
    priority: 'P0',
  },

  // -------------------------------------------------------------------------
  // PRIORITY CATEGORY 6 — Gaming Machine Act Recordkeeping
  // -------------------------------------------------------------------------
  {
    category: 'Gaming Machine Act recordkeeping',
    q: 'When do I take meter reads?',
    expect: ['Meter Read', 'Gaming Floor Log'],
    priority: 'P0',
  },
  {
    category: 'Gaming Machine Act recordkeeping',
    q: 'What goes in the gaming floor log?',
    expect: ['Meter Read', 'Gaming Floor Log'],
    priority: 'P0',
  },
  {
    category: 'Gaming Machine Act recordkeeping',
    q: 'What records does OLGR inspect?',
    expect: ['OLGR', 'Gaming Machine Act'],
    priority: 'P0',
  },

  // -------------------------------------------------------------------------
  // PRIORITY CATEGORY 7 — Fair Work / Hospitality Award
  // -------------------------------------------------------------------------
  {
    category: 'Fair Work / Award rates',
    q: 'What is a casual gaming attendant paid on Sunday?',
    expect: ['Award', 'MA000009', 'Hospitality'],
    priority: 'P0',
  },
  {
    category: 'Fair Work / Award rates',
    q: 'What is the base rate for a Level 1 hospitality casual?',
    expect: ['Award', 'MA000009', '$24.95'],
    priority: 'P0',
  },
  {
    category: 'Fair Work / Award rates',
    q: 'Which award covers gaming venue staff?',
    expect: ['Award', 'MA000009', 'Hospitality'],
    priority: 'P0',
  },

  // -------------------------------------------------------------------------
  // ADDITIONAL SECTION B RETRIEVAL TESTS (from gap analysis spec)
  // -------------------------------------------------------------------------
  {
    category: 'Self-exclusion',
    q: 'How do I register a patron for self-exclusion?',
    expect: ['Self-Exclusion', 'exclusion'],
    priority: 'P0',
  },
  {
    category: 'Self-exclusion',
    q: 'An excluded patron has come back onto the gaming floor. What do I do?',
    expect: ['Self-Exclusion', 'exclusion', 'Responsible Gambling'],
    priority: 'P0',
  },
  {
    category: 'Staff certifications',
    q: 'Which staff need an RSG cert?',
    expect: ['Staff Certification', 'RSG', 'Certification'],
    priority: 'P0',
  },
  {
    category: 'Staff certifications',
    q: 'What happens if a staff member has a lapsed RSA certificate?',
    expect: ['Staff Certification', 'RSA', 'Certification'],
    priority: 'P0',
  },
  {
    category: 'Incident reporting',
    q: 'What incidents do I have to report to WorkSafe?',
    expect: ['Incident', 'WorkSafe', 'Notification Thresholds'],
    priority: 'P0',
  },
  {
    category: 'Incident reporting',
    q: 'What are the mandatory notification thresholds for incidents?',
    expect: ['Incident', 'Notification Thresholds'],
    priority: 'P0',
  },
  {
    category: 'RSA vs barring',
    q: "What's the difference between refusing service and barring someone?",
    expect: ['Aggressive Patron', 'Barring', 'RSA'],
    priority: 'P1',
  },
  {
    category: 'Labour benchmarks',
    q: "What's the target gaming labour percentage?",
    expect: ['Labour Benchmarks', 'RTV', 'gaming'],
    priority: 'P0',
  },
  {
    category: 'Labour benchmarks',
    q: 'Why is gaming labour measured on net revenue not turnover?',
    expect: ['Labour Benchmarks', 'RTV', 'net'],
    priority: 'P0',
  },
];

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
async function runTests(clientId) {
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const t of TESTS) {
    const { results: chunks, topScore, lowConfidence } = await retrieveChunks({
      clientId,
      venueId: VENUE_ID,
      venueState: VENUE_STATE,
      queryText: t.q,
    });

    // Check if ANY expected term appears in top-5 results (source or section text)
    const top5Text = chunks.map((c) => `${c.source} ${c.section ?? ''}`).join(' ');
    const hit = t.expect.some((term) =>
      top5Text.toLowerCase().includes(term.toLowerCase()),
    );

    const topSources = chunks.slice(0, 3).map((c) => c.source.replace(/^Criterion SOP — /, ''));
    const result = {
      category: t.category,
      q: t.q,
      priority: t.priority,
      pass: hit && !lowConfidence,
      hit,
      lowConfidence,
      topScore: topScore.toFixed(3),
      top3Sources: topSources,
    };
    results.push(result);

    if (result.pass) {
      passed++;
      console.log(`  ✓ [${t.priority}] ${t.category}: "${t.q.slice(0, 60)}"`);
      console.log(`      top: ${topSources[0] ?? 'none'} (score ${topScore.toFixed(3)})`);
    } else {
      failed++;
      const reason = !hit ? 'source not in top-5' : 'low confidence';
      console.log(`  ✗ [${t.priority}] ${t.category}: "${t.q.slice(0, 60)}"`);
      console.log(`      FAIL reason: ${reason} | score: ${topScore.toFixed(3)} | floor: ${CONFIDENCE_FLOOR}`);
      console.log(`      top-3: ${topSources.join(' | ')}`);
    }
  }

  return { results, passed, failed, total: TESTS.length };
}

// ---------------------------------------------------------------------------
// Summary report
// ---------------------------------------------------------------------------
function printSummary(summary) {
  const { results, passed, failed, total } = summary;
  console.log('\n' + '='.repeat(70));
  console.log(`MIS-235 Retrieval Test Results — ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  // Group by category
  const byCat = {};
  for (const r of results) {
    if (!byCat[r.category]) byCat[r.category] = [];
    byCat[r.category].push(r);
  }
  for (const [cat, rs] of Object.entries(byCat)) {
    const catPass = rs.filter((r) => r.pass).length;
    console.log(`\n${cat}: ${catPass}/${rs.length}`);
    for (const r of rs) {
      const icon = r.pass ? '✓' : '✗';
      console.log(`  ${icon} ${r.q.slice(0, 70)}`);
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`TOTAL: ${passed}/${total} PASS | ${failed} FAIL`);
  console.log(`Floor: ${CONFIDENCE_FLOOR} (model: mise-local-hashing-v1)`);
  if (failed > 0) {
    const failedCats = [...new Set(results.filter((r) => !r.pass).map((r) => r.category))];
    console.log(`Failed categories: ${failedCats.join(', ')}`);
  }
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!CLIENT_ID) {
    console.error('Usage: DB_CONNECTION_STRING=... node scripts/retrieval-test-mis235.js <clientId>');
    process.exit(1);
  }
  const cs = process.env.DB_CONNECTION_STRING;
  if (!cs) {
    console.error('DB_CONNECTION_STRING is required');
    process.exit(1);
  }
  initDb({ db: { connectionString: cs, appRole: process.env.DB_APP_ROLE || 'mise_app' } });

  console.log('MIS-235 — Running retrieval tests...\n');
  runTests(CLIENT_ID)
    .then(async (summary) => {
      printSummary(summary);
      await closeDb();
      if (summary.failed > 0) process.exit(1);
    })
    .catch(async (err) => {
      console.error('Test run failed:', err.message);
      try { await closeDb(); } catch {}
      process.exit(1);
    });
}

export { runTests };
