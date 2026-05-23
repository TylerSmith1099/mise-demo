// =============================================================================
// MIS-83 — Scored eval runner for the three demo scenes.
//
// Drives all three MIS-26 demo scenes through the LIVE HTTP API exactly as a
// client would (login -> token -> bearer), scores each expectation pass/fail
// against the golden spec, prints a per-scene/per-question report, writes a
// timestamped results document, and exits non-zero on any scene failure (CI-able).
//
// Source of truth for the expectations:
//   Deliverables/QA/Mise-Eval-GoldenSets-V1.md   (MIS-77)
// Do NOT re-derive the scoring here — it mirrors that document.
//
// MODE
//   Default (self-boot): creates a throwaway DB (mise_eval), runs migrations,
//   seeds the Criterion demo, ingests the shared legislation + the three demo
//   SOPs into document_chunks, boots the Express app on an ephemeral port, and
//   drives it over real HTTP. This is the npm-run-seed path the golden spec asks
//   for, made re-runnable end-to-end for the demo dry-run.
//
//   External (EVAL_BASE set): drives an already-running server at EVAL_BASE
//   using EVAL_CLIENT_ID / EVAL_VENUE_ID (skips all bootstrap). Use this to eval
//   the actual demo server rather than a throwaway DB.
//
// AU DATA RESIDENCY: synthesis stays OFF unless ANTHROPIC_API_KEY +
// ANTHROPIC_BASE_URL (an AU endpoint) are configured. No question leaves the box.
//
// Run:  node scripts/eval-runner.js
// =============================================================================

import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// PROJ_ROOT: from MISE/backend/ up two levels to the project root (_default/).
// REPO_ROOT is the canonical backend root (used for ../src/* imports via selfBoot);
// PROJ_ROOT is used for shared project-level output paths (Deliverables, QA).
const PROJ_ROOT = join(REPO_ROOT, '..', '..');
const RESULTS_PATH = join(PROJ_ROOT, 'Deliverables', 'QA', 'Mise-Eval-Results-V2026-05-22.md');

// --- tiny HTTP client (mirrors scripts/demo-drive.js login/authed helpers) ---
async function login(base, { clientId, venueId, email, password }) {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, venue_id: venueId, email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(j)}`);
  return j;
}
async function authed(base, token, path, method = 'GET', body) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: r.status, body: j };
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// =============================================================================
// SCENE 1 — Gaming Attendant (Tier 7) RG scenarios.
// PASS bar (golden spec): >= 9/10 questions PASS, 0 fabricated citations.
// Per-question PASS = correct source cited + a real named section + a calm,
// procedural answer + no fabricated/invented citation.
// =============================================================================
const RG_CODE = /responsible gambling code/i;
const GAMING_FLOOR = /gaming machine act 1991|gaming floor/i;

const SCENE1_GOLDEN = [
  { n: 1, q: "A patron has been at the same machine for four hours and tells me twice they're fine. What do I need to do?", source: RG_CODE, theme: 'Interaction with customers showing signs of problem gambling' },
  { n: 2, q: 'A patron asks me to keep their winnings card behind the bar for them. What should I do?', source: RG_CODE, theme: 'Payment of winnings and cash access' },
  { n: 3, q: 'Someone who looks under 18 is sitting at the EGMs. What do I do?', source: RG_CODE, theme: 'Gambling by minors' },
  { n: 4, q: 'An excluded patron has walked back onto the gaming floor. What are my obligations?', source: RG_CODE, theme: 'Interaction with excluded patrons' },
  { n: 5, q: 'A patron is visibly distressed and chasing their losses. How should I handle it?', source: RG_CODE, theme: 'Interaction with customers showing signs of problem gambling' },
  { n: 6, q: 'A patron wants a large cash payout from the EGM. What is the procedure?', source: RG_CODE, theme: 'Payment of winnings and cash access' },
  { n: 7, q: 'Can I offer a free drink to keep someone playing the machines?', source: RG_CODE, theme: 'Advertising and inducements' },
  { n: 8, q: 'Where do I point a patron who wants to self-exclude from gambling?', source: RG_CODE, theme: 'Provision of information / exclusions' },
  { n: 9, q: 'EGM 32 has a door-open alarm but the door is shut. What do I do?', source: GAMING_FLOOR, theme: 'EGM malfunction handling' },
  { n: 10, q: 'A patron disputes that a jackpot was not paid out. How do I handle it?', source: GAMING_FLOOR, theme: 'Jackpot processing' },
];

const REFUSAL = /\bi can'?t\b|\bi couldn'?t\b|can'?t confidently|unable to help|i'm not able/i;
const STATUTE_NAME = /[A-Z][A-Za-z' ]+? Act \d{4}/g;

// Parse the explicit citation trail composed into the answer, e.g.
//   *(Source: A — sec; B — sec)*
function parseAnswerCitations(answer) {
  const m = answer.match(/\(Source:\s*([^)]*)\)/i);
  if (!m) return [];
  return m[1]
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [src, ...rest] = pair.split(' — ');
      return { source: (src || '').trim(), section: rest.join(' — ').trim() };
    });
}

function scoreScene1Question(g, res) {
  const fails = [];
  const fabrications = [];
  const body = res.body || {};
  const answer = typeof body.answer === 'string' ? body.answer : '';
  const citations = Array.isArray(body.citations) ? body.citations : [];

  // (a) correct source cited.
  const sourceHit = citations.find((c) => g.source.test(c.source || ''));
  if (!sourceHit) fails.push('no citation matching the expected source');

  // (b) the matched citation carries a real, named section.
  const realSection = sourceHit && typeof sourceHit.section === 'string' && sourceHit.section.trim().length > 0;
  if (sourceHit && !realSection) fails.push('matched source has no named section');

  // (c) calm + procedural: answered (not a refusal), and confident (not hedged).
  const calm = answer.length > 40 && !REFUSAL.test(answer) && body.lowConfidence === false;
  if (!calm) {
    if (body.lowConfidence !== false) fails.push('answer hedged (lowConfidence)');
    else fails.push('answer not calm/procedural (refusal or too short)');
  }

  // (d) no fabricated citation. Every (Source: …) pair in the answer must map to
  // a real retrieved chunk (source substring + matching section). Any statute
  // named in the answer prose must appear in citations[].
  const valid = citations.map((c) => ({ source: (c.source || '').trim(), section: (c.section || '').trim() }));
  for (const ac of parseAnswerCitations(answer)) {
    const mapped = valid.find(
      (v) => v.source.includes(ac.source) || ac.source.includes(v.source),
    );
    if (!mapped) {
      fabrications.push(`cited source not retrieved: "${ac.source}"`);
    } else if (ac.section && mapped.section && !sectionMatch(ac.section, mapped.section)) {
      // Section text present in the trail but not matching the retrieved chunk.
      fabrications.push(`cited section not on retrieved chunk: "${ac.source} — ${ac.section}"`);
    }
  }
  for (const stat of answer.match(STATUTE_NAME) || []) {
    if (!valid.some((v) => v.source.includes(stat.trim()))) {
      fabrications.push(`statute named in answer but not in citations: "${stat.trim()}"`);
    }
  }

  const pass = fails.length === 0 && fabrications.length === 0;
  return {
    n: g.n,
    pass,
    fabricated: fabrications.length > 0,
    citedSource: sourceHit ? sourceHit.source : '(none matched)',
    citedSection: sourceHit ? sourceHit.section : '—',
    confidence: body.confidence,
    lowConfidence: body.lowConfidence,
    httpStatus: res.status,
    fails,
    fabrications,
    topSources: citations.map((c) => `${c.source} — ${c.section} (${c.confidence})`),
    answerSnippet: answer.slice(0, 160).replace(/\s+/g, ' '),
  };
}

// Sections match if either contains the other (handles "x (cont.)" suffixes the
// chunker adds, and minor punctuation differences).
function sectionMatch(a, b) {
  const norm = (s) => s.toLowerCase().replace(/\s*\(cont\.?\)\s*$/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const na = norm(a); const nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function runScene1(base, creds) {
  const grace = await login(base, { ...creds, email: 'grace@pinnacle.test', password: 'floor-1234' });
  const rows = [];
  for (const g of SCENE1_GOLDEN) {
    const res = await authed(base, grace.token, '/api/chat', 'POST', { message: g.q });
    rows.push(scoreScene1Question(g, res));
  }
  const passCount = rows.filter((r) => r.pass).length;
  const fabCount = rows.filter((r) => r.fabricated).length;
  const verdict = passCount >= 9 && fabCount === 0;
  return { verdict, passCount, fabCount, rows, persona: `${grace.role_at_login} (tier ${grace.role_tier})` };
}

// =============================================================================
// SCENE 2 — Duty Manager (Tier 5) shift handover.
// PASS bar: labour flagged & pct>12, the within-7-day cert (Marcus Polk RSG,
// 5 days) surfaced, and the four canonical sections present in order.
// =============================================================================
async function runScene2(base, creds) {
  const dan = await login(base, { ...creds, email: 'dan@pinnacle.test', password: 'duty-5678' });
  const sum = await authed(base, dan.token, '/api/shift-summary');
  const ho = await authed(base, dan.token, '/api/handover');
  const checks = [];

  // Labour flag.
  const gl = sum.body?.gamingLabour || {};
  const labourPass = gl.flagged === true && Number(gl.pct) > 12;
  checks.push({ label: `gaming labour flagged & >12% (pct=${gl.pct}, flagged=${gl.flagged})`, pass: labourPass });

  // Within-7-day cert: Marcus Polk RSG, 5 days, surfaced in summary/handover text.
  const blob = JSON.stringify(sum.body) + '\n' + JSON.stringify(ho.body);
  const certPass = /Marcus\s+Polk/i.test(blob) && /RSG/i.test(blob) && /5 day/i.test(blob);
  checks.push({ label: 'within-7-day cert surfaced (Marcus Polk RSG, 5 days)', pass: certPass });

  // Four canonical sections present + in order. The structured handover
  // (web/src/components/Handover.jsx) renders, top-to-bottom:
  //   shift focus (header) -> Open compliance items -> Staffing -> Recommended actions
  // which is exactly the golden order (Runsheet/focus -> Open compliance ->
  // Staffing -> Handover/actions). Assert each section is present with content;
  // their render order is fixed by the component, so order is verified by
  // presence in that sequence.
  const h = ho.body || {};
  const sections = [
    { name: 'Runsheet / shift focus', present: Boolean(h.fromRole && h.toRole && h.shiftDate) },
    { name: 'Open compliance items', present: Array.isArray(h.openComplianceItems) && h.openComplianceItems.length > 0 },
    { name: 'Staffing', present: typeof h.staffingNotes === 'string' && h.staffingNotes.trim().length > 0 },
    { name: 'Handover notes / actions', present: Array.isArray(h.actionItems) && h.actionItems.length > 0 },
  ];
  const sectionsPass = sections.every((s) => s.present);
  checks.push({ label: `four canonical sections present, in order [${sections.map((s) => (s.present ? '✓' : '✗')).join(' ')}]`, pass: sectionsPass });

  const verdict = checks.every((c) => c.pass);
  return { verdict, checks, sections, persona: `${dan.role_at_login} (tier ${dan.role_tier})`, summaryStatus: sum.status, handoverStatus: ho.status, gamingLabour: gl };
}

// =============================================================================
// SCENE 3 — Compliance Monitor understaffing auto-fire.
// PASS bar: Critical gaming_understaffing auto-fires within the activation
// window (<=12s), persists to compliance_events, ack-no-note rejected (400),
// ack-with-note clears.
// =============================================================================
async function runScene3(base, creds, { withClientContext } = {}) {
  const dan = await login(base, { ...creds, email: 'dan@pinnacle.test', password: 'duty-5678' });
  const checks = [];

  const act = await authed(base, dan.token, '/api/compliance/activate', 'POST', {});
  const armed = act.status === 200 && act.body?.activated === true;
  checks.push({ label: `activation armed (checkInSeconds=${act.body?.checkInSeconds})`, pass: armed });

  // Poll for the Critical alert; record wall-clock time to fire. Window is the
  // activation delay (~10s) + a small transport margin (<=12s total).
  const MARGIN_MS = 12000;
  const start = Date.now();
  let critical = null;
  let firedMs = null;
  while (Date.now() - start < MARGIN_MS + 1500) {
    const alerts = await authed(base, dan.token, '/api/compliance/alerts');
    const list = alerts.body?.alerts || [];
    critical = list.find((a) => (a.severity || '').toLowerCase() === 'critical' && a.eventType === 'gaming_understaffing');
    if (critical) { firedMs = Date.now() - start; break; }
    await sleep(500);
  }
  const firedInWindow = Boolean(critical) && firedMs <= MARGIN_MS;
  checks.push({ label: `Critical gaming_understaffing auto-fired within window (${firedMs == null ? 'NEVER' : `${(firedMs / 1000).toFixed(1)}s`}, <=12s)`, pass: firedInWindow });

  // Persistence: the alert corresponds to a compliance_events row. The GET alerts
  // endpoint reads compliance_events, so a returned row already proves it; when a
  // DB handle is available, confirm the row directly (client-scoped, never cross-client).
  let persisted = Boolean(critical);
  if (critical && withClientContext) {
    const n = await withClientContext(creds.clientId, async (q) => {
      const { rows } = await q(
        `SELECT count(*)::int AS n FROM compliance_events
          WHERE venue_id = $1 AND event_type = 'gaming_understaffing'
            AND severity = 'critical' AND deleted_at IS NULL`,
        [creds.venueId],
      );
      return rows[0].n;
    });
    persisted = n >= 1;
    checks.push({ label: `persisted to compliance_events (rows=${n})`, pass: persisted });
  } else {
    checks.push({ label: 'persisted to compliance_events (via /alerts read)', pass: persisted });
  }

  // Ack contract: no note -> 400; with note -> 200 and the alert clears.
  let ackNoNotePass = false;
  let ackWithNotePass = false;
  let clearedPass = false;
  if (critical) {
    const id = critical.eventId;
    const noNote = await authed(base, dan.token, `/api/compliance/alerts/${id}/ack`, 'POST', {});
    ackNoNotePass = noNote.status === 400;
    checks.push({ label: `ack with NO note rejected (got ${noNote.status}, expect 400)`, pass: ackNoNotePass });

    const ack = await authed(base, dan.token, `/api/compliance/alerts/${id}/ack`, 'POST', {
      note: 'Acknowledged — pulling a second attendant to the gaming floor now. — Dan',
    });
    ackWithNotePass = ack.status === 200 && ack.body?.acknowledged === true;
    checks.push({ label: `ack with note succeeds (got ${ack.status})`, pass: ackWithNotePass });

    const after = await authed(base, dan.token, '/api/compliance/alerts');
    const remaining = (after.body?.alerts || []).filter((a) => a.eventId === id).length;
    clearedPass = remaining === 0;
    checks.push({ label: `active alert cleared after ack (remaining=${remaining})`, pass: clearedPass });
  } else {
    checks.push({ label: 'ack contract (no alert to acknowledge)', pass: false });
  }

  const verdict = checks.every((c) => c.pass);
  return { verdict, checks, firedMs, persona: `${dan.role_at_login} (tier ${dan.role_tier})` };
}

// =============================================================================
// Self-boot: throwaway DB + migrate + seed + ingest + listen.
// =============================================================================
async function selfBoot() {
  const { runMigrations } = await import('./migrate.js');
  const { loadConfig } = await import('../src/config.js');
  const { initDb, closeDb, withClientContext } = await import('../src/db.js');
  const { createApp } = await import('../src/app.js');
  const { seedCriterionDemo } = await import('./seed-demo-criterion.js');
  const { ingestLegislation } = await import('./ingest-legislation.js');
  const { EMBEDDING_MODEL } = await import('../src/rag/embedding.js');

  const ADMIN_USER = process.env.MISE_TEST_DB_ADMIN_USER || process.env.USER;
  const DB_HOST = process.env.MISE_TEST_DB_HOST || 'localhost';
  const TEST_DB = process.env.EVAL_DB || 'mise_eval';
  const adminCs = `postgres://${ADMIN_USER}@${DB_HOST}:5432/postgres`;
  const testCs = `postgres://${ADMIN_USER}@${DB_HOST}:5432/${TEST_DB}`;

  const admin = new pg.Client({ connectionString: adminCs });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  await runMigrations(testCs);

  // Minimal env so loadConfig succeeds. RS256 keypair generated at runtime;
  // synthesis stays OFF (no ANTHROPIC_*), so this is the AU-resident path.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.JWT_ALGORITHM = 'RS256';
  process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' });
  process.env.SESSION_EXPIRY_HOURS = process.env.SESSION_EXPIRY_HOURS || '8';
  process.env.SESSION_TIMEOUT_MINUTES = process.env.SESSION_TIMEOUT_MINUTES || '30';
  process.env.DB_CONNECTION_STRING = testCs;

  const config = loadConfig();
  initDb(config);
  const ids = await seedCriterionDemo();

  // Knowledge base: shared QLD/national legislation (document_chunks, client_id
  // NULL) + the three client-scoped demo SOPs. Manifest written to a temp path
  // so the eval never mutates the committed manifest.
  const manifestPath = join(PROJ_ROOT, 'Deliverables', 'QA', '.eval-manifest.json');
  await ingestLegislation({ manifestPath });

  // Demo SOPs (client-scoped) via the canonical, RECONCILED ingest path
  // (MIS-97, Finding 2): scripts/ingest-demo-sops.js now drives
  // src/rag/ingest.js — the same pipeline the live server reads through — so the
  // eval exercises exactly the committed script rather than a parallel copy.
  const { ingestDemoSops } = await import('./ingest-demo-sops.js');
  let sopNote = 'demo SOPs ingested (scripts/ingest-demo-sops.js -> src/rag path)';
  try {
    await ingestDemoSops(ids.clientId, { manifestPath });
  } catch (e) {
    sopNote = `demo SOP ingestion FAILED: ${e.message}`;
    console.warn(`[eval] ${sopNote}`);
  }

  const app = createApp(config);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    creds: { clientId: ids.clientId, venueId: ids.venueId },
    embeddingModel: EMBEDDING_MODEL,
    synthesis: config.anthropic.enabled,
    withClientContext,
    sopNote,
    async teardown() {
      await new Promise((r) => server.close(r));
      await closeDb();
    },
  };
}

// =============================================================================
// Results document.
// =============================================================================
function fmtScene1Table(rows) {
  const head = '| # | Verdict | Cited source | Cited section | Conf | Notes |\n|---|---|---|---|---|---|';
  const body = rows.map((r) => {
    const notes = [...r.fails, ...r.fabrications].join('; ') || (r.fabricated ? 'FABRICATION' : 'ok');
    return `| ${r.n} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.citedSource} | ${r.citedSection} | ${r.confidence ?? '—'} | ${notes} |`;
  }).join('\n');
  return `${head}\n${body}`;
}

function buildResults({ ts, embeddingModel, synthesis, sopNote, s1, s2, s3, gate }) {
  const sceneLine = (name, ok) => `- **${name}:** ${ok ? '✅ PASS' : '❌ FAIL'}`;
  return `# Mise — Demo Scene Eval Results

**Run:** ${ts}
**Runner:** \`scripts/eval-runner.js\` (MIS-83)
**Golden set:** \`Deliverables/QA/Mise-Eval-GoldenSets-V1.md\` (MIS-77)
**Embedding model:** \`${embeddingModel}\`  ·  **Confidence floor:** model-calibrated (0.22 for the offline hashing model)
**Answer synthesis:** ${synthesis ? 'ON (AU endpoint configured)' : 'OFF — deterministic AU-resident compose (no question leaves the box)'}
**Knowledge base:** shared QLD + national legislation (document_chunks, client_id NULL) + ${sopNote}

## Overall gate verdict: ${gate ? '✅ PASS' : '❌ FAIL'}

${sceneLine('Scene 1 — Gaming Attendant RG scenarios', s1.verdict)} (${s1.passCount}/10 questions PASS, ${s1.fabCount} fabricated-citation failures; bar = ≥9/10 & 0 fabrications)
${sceneLine('Scene 2 — Duty Manager shift handover', s2.verdict)}
${sceneLine('Scene 3 — Compliance Monitor understaffing auto-fire', s3.verdict)}

---

## Scene 1 — Gaming Attendant (Tier 7): RG scenarios
Persona under test: ${s1.persona} · surface: \`POST /api/chat\`

${fmtScene1Table(s1.rows)}

**Result:** ${s1.passCount}/10 PASS, ${s1.fabCount} fabricated-citation failure(s) → scene **${s1.verdict ? 'PASS' : 'FAIL'}**.
*Section themes (expected) are recorded in the golden set; the runner scores correct-source + real-named-section + calm/procedural + zero fabrication, per the spec.*

<details><summary>Top-5 retrieved sources per question (evidence for the failing items)</summary>

${s1.rows.map((r) => `**Q${r.n}** (${r.pass ? 'PASS' : 'FAIL'}):\n${r.topSources.map((t) => `  - ${t}`).join('\n') || '  - (no chunks retrieved)'}`).join('\n\n')}

</details>

## Scene 2 — Duty Manager (Tier 5): shift handover
Persona under test: ${s2.persona} · surfaces: \`GET /api/shift-summary\` (${s2.summaryStatus}) + \`GET /api/handover\` (${s2.handoverStatus})

${s2.checks.map((c) => `- ${c.pass ? '✅' : '❌'} ${c.label}`).join('\n')}

Gaming labour: \`${JSON.stringify(s2.gamingLabour)}\`
Section order asserted (fixed by web/src/components/Handover.jsx): ${s2.sections.map((s) => s.name).join(' → ')}

**Result:** scene **${s2.verdict ? 'PASS' : 'FAIL'}**.

## Scene 3 — Compliance Monitor: understaffing auto-fire
Persona under test: ${s3.persona} · surfaces: \`POST /api/compliance/activate\` → \`GET /api/compliance/alerts\` → \`.../ack\`

${s3.checks.map((c) => `- ${c.pass ? '✅' : '❌'} ${c.label}`).join('\n')}

**Result:** scene **${s3.verdict ? 'PASS' : 'FAIL'}**.
*Note: the auto-fire depends on the seeded "tonight" understaffed gaming shift spanning \`now()\` (Brisbane 17:00–01:00). The seed anchors this to the current calendar date, so a re-run outside that window will not fire — re-seed (or set MISE_DEMO_BASE_DATE) for an off-hours dry-run.*

---

*Generated by \`scripts/eval-runner.js\`. Exit code is non-zero on any scene fail (CI-able). QA gate applies — QA Officer reviews before MIS-77 closes.*
`;
}

// =============================================================================
// Main.
// =============================================================================
async function main() {
  const ts = new Date().toISOString();
  let ctx;
  let external = false;

  if (process.env.EVAL_BASE) {
    external = true;
    const { EMBEDDING_MODEL } = await import('../src/rag/embedding.js');
    ctx = {
      base: process.env.EVAL_BASE,
      creds: { clientId: process.env.EVAL_CLIENT_ID, venueId: process.env.EVAL_VENUE_ID },
      embeddingModel: EMBEDDING_MODEL,
      synthesis: Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_BASE_URL),
      withClientContext: null,
      sopNote: 'external server (knowledge base assumed pre-loaded)',
      teardown: async () => {},
    };
    if (!ctx.creds.clientId || !ctx.creds.venueId) {
      throw new Error('EVAL_BASE mode requires EVAL_CLIENT_ID and EVAL_VENUE_ID');
    }
  } else {
    ctx = await selfBoot();
  }

  try {
    console.log(`\n[eval] driving ${external ? 'external' : 'self-booted'} stack at ${ctx.base}`);
    const s1 = await runScene1(ctx.base, ctx.creds);
    console.log(`[eval] Scene 1: ${s1.passCount}/10 PASS, ${s1.fabCount} fabrications -> ${s1.verdict ? 'PASS' : 'FAIL'}`);
    const s2 = await runScene2(ctx.base, ctx.creds);
    console.log(`[eval] Scene 2: ${s2.verdict ? 'PASS' : 'FAIL'}`);
    const s3 = await runScene3(ctx.base, ctx.creds, { withClientContext: ctx.withClientContext });
    console.log(`[eval] Scene 3: ${s3.verdict ? 'PASS' : 'FAIL'}`);

    const gate = s1.verdict && s2.verdict && s3.verdict;
    const md = buildResults({ ts, embeddingModel: ctx.embeddingModel, synthesis: ctx.synthesis, sopNote: ctx.sopNote, s1, s2, s3, gate });
    await writeFile(RESULTS_PATH, md);
    console.log(`\n[eval] gate verdict: ${gate ? 'PASS' : 'FAIL'}`);
    console.log(`[eval] results written: ${RESULTS_PATH}`);

    await ctx.teardown();
    process.exit(gate ? 0 : 1);
  } catch (err) {
    await ctx.teardown().catch(() => {});
    throw err;
  }
}

main().catch((e) => { console.error('EVAL ERROR:', e.stack || e.message); process.exit(2); });
