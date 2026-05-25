// =============================================================================
// MIS-287 — Targeted retrieval tests for the 6 new QLD compliance articles.
// Validates that RSA/RSG/harm-min/self-exclusion queries now surface the
// correct specific source (rather than falling back to generic legislation).
//
// Run:
//   DB_CONNECTION_STRING=postgres://localhost/mise_eval \
//     node scripts/retrieval-test-mis287.js [clientId]
// =============================================================================

import { initDb, closeDb } from '../src/db.js';
import { retrieveChunks, CONFIDENCE_FLOOR } from '../src/rag/retrieve.js';

// Pinnacle Hotel Group (QLD) — the demo client
const DEFAULT_CLIENT_ID = '00833ee8-b3a9-42cb-8e42-7b8db2825b94';
const VENUE_STATE = 'QLD';

const TESTS = [
  {
    label: 'RSG cert — what training is required for gaming staff?',
    q: 'What RSG training does a gaming attendant need and how long do they have to get it?',
    expectSource: /RSG Certification|SITHGAM022/i,
    expectTerms: ['SITHGAM022', '3 months', 'three months', '3-month'],
    category: 'RSG',
  },
  {
    label: 'RSG cert — post-2013 expiry question',
    q: 'Does my RSG certificate expire? When do I need to renew it?',
    expectSource: /RSG Certification|SITHGAM022/i,
    expectTerms: ['SITHGAM022', 'Statement of Attainment', 'does not expire', 'no expiry'],
    category: 'RSG',
  },
  {
    label: 'RSA cert — intoxicated patron obligations',
    q: 'What RSA qualification do I need to refuse service to an intoxicated person?',
    expectSource: /RSA Certification|SITHFAB021/i,
    expectTerms: ['SITHFAB021', 'intoxicated', 'refuse'],
    category: 'RSA',
  },
  {
    label: 'RSA cert — what does RSA require?',
    q: 'What does RSA cover and which unit of competency is it?',
    expectSource: /RSA Certification|SITHFAB021/i,
    expectTerms: ['SITHFAB021'],
    category: 'RSA',
  },
  {
    label: 'Harm min — patron showing problem gambling signs',
    q: 'A patron has been playing for five hours and is distressed. What are my harm minimisation obligations?',
    expectSource: /Harm Minimisation|Patron Wellbeing/i,
    expectTerms: ['1800 858 858', 'Gambling Help', 'problem gambling'],
    category: 'HARM_MIN',
  },
  {
    label: 'Harm min — referral pathway',
    q: 'Where do I refer a patron who wants help with their gambling?',
    expectSource: /Harm Minimisation|Patron Wellbeing|Responsible Gambling/i,
    expectTerms: ['1800 858 858', 'Gambling Help Online'],
    category: 'HARM_MIN',
  },
  {
    label: 'Self-exclusion — how does the process work?',
    q: 'A patron wants to self-exclude from the gaming machines. What is the process?',
    expectSource: /Self-Exclusion|Exclusion Directions|Responsible Gambling/i,
    expectTerms: ['self-exclusion', 'self-exclu', 'CLO', 'cooling'],
    category: 'SELF_EXCL',
  },
  {
    label: 'Self-exclusion — venue-initiated exclusion',
    q: 'Can the venue exclude a patron from gaming without their consent?',
    expectSource: /Self-Exclusion|Exclusion Directions|Gaming Machine Act/i,
    expectTerms: ['exclusion direction', 'venue-initiated', 'patron'],
    category: 'SELF_EXCL',
  },
  {
    label: 'OLGR — penalty for breach',
    q: 'What are the penalties for breaching the Gaming Machine Act in QLD?',
    expectSource: /OLGR|Regulatory Framework|Gaming Machine Act/i,
    expectTerms: ['penalty unit', '$166.90', 'OLGR'],
    category: 'OLGR',
  },
  {
    label: 'OLGR — inspection powers',
    q: 'Can OLGR inspectors enter the venue without notice?',
    expectSource: /OLGR|Regulatory Framework/i,
    expectTerms: ['inspector', 'OLGR', 'authorised'],
    category: 'OLGR',
  },
];

function checkTerms(content, terms) {
  const lower = content.toLowerCase();
  return terms.filter((t) => lower.includes(t.toLowerCase()));
}

async function runTests(clientId) {
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const test of TESTS) {
    const { results: chunks, topScore, lowConfidence } = await retrieveChunks({
      clientId,
      venueState: VENUE_STATE,
      queryText: test.q,
    });

    const top5Sources = chunks.map((c) => c.source);
    const sourceMatch = chunks.some((c) => test.expectSource.test(c.source));
    const top1Source = chunks[0]?.source ?? '(no results)';
    const top1Content = chunks[0]?.content ?? '';
    const top3Content = chunks.slice(0, 3).map((c) => c.content).join(' ');
    const termsFound = checkTerms(top3Content, test.expectTerms);
    const termsMissing = test.expectTerms.filter((t) => !termsFound.some((f) => f.toLowerCase() === t.toLowerCase()));

    const pass = sourceMatch && termsFound.length > 0;
    if (pass) passed++; else failed++;

    results.push({
      ...test,
      pass,
      topScore: topScore.toFixed(3),
      lowConfidence,
      top1Source,
      sourceMatch,
      termsFound,
      termsMissing,
      top5Sources,
    });
  }

  return { results, passed, failed, total: TESTS.length };
}

function printReport(report) {
  const { results, passed, failed, total } = report;
  console.log(`\n${'='.repeat(72)}`);
  console.log(`MIS-287 Retrieval Test Report — ${new Date().toISOString()}`);
  console.log(`DB: mise_eval | Model: mise-local-hashing-v1 | Conf floor: ${CONFIDENCE_FLOOR}`);
  console.log(`Score: ${passed}/${total} PASS (${failed} FAIL)\n`);

  let lastCat = null;
  for (const r of results) {
    if (r.category !== lastCat) {
      console.log(`\n── ${r.category} ──`);
      lastCat = r.category;
    }
    const icon = r.pass ? '✓' : '✗';
    console.log(`${icon} [${r.topScore}${r.lowConfidence ? '⚠' : ''}] ${r.label}`);
    console.log(`    Top source: ${r.top1Source}`);
    if (r.termsFound.length > 0) {
      console.log(`    Terms found: ${r.termsFound.join(', ')}`);
    }
    if (r.termsMissing.length > 0 && !r.pass) {
      console.log(`    MISSING terms: ${r.termsMissing.join(', ')}`);
    }
    if (!r.sourceMatch) {
      console.log(`    Expected source matching: ${r.expectSource}`);
      console.log(`    Got top-5: ${r.top5Sources.slice(0, 3).join(' | ')}`);
    }
  }
  console.log(`\n${'='.repeat(72)}`);
  console.log(`Result: ${passed}/${total} PASS\n`);
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const clientId = process.argv[2] || DEFAULT_CLIENT_ID;
  const cs = process.env.DB_CONNECTION_STRING;
  if (!cs) {
    console.error('DB_CONNECTION_STRING is required');
    process.exit(1);
  }
  initDb({ db: { connectionString: cs, appRole: process.env.DB_APP_ROLE || 'mise_app' } });

  runTests(clientId)
    .then(async (report) => {
      printReport(report);
      await closeDb();
      if (report.failed > 0) process.exit(1);
    })
    .catch(async (err) => {
      console.error('Test run failed:', err.message);
      try { await closeDb(); } catch {}
      process.exit(1);
    });
}

export { runTests, printReport };
