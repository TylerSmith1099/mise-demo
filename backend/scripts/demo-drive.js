// MIS-26 Steps 2–5 — live demo driver. Logs in real Tier 7 / Tier 5 staff and
// exercises the three demo scenes against the running server, printing each
// response so the CTO can evaluate it against the issue's criteria.
//
//   BASE=http://localhost:3100 CLIENT_ID=... VENUE_ID=... node scripts/demo-drive.js

const BASE = process.env.BASE || 'http://localhost:3100';
const CLIENT_ID = process.env.CLIENT_ID;
const VENUE_ID = process.env.VENUE_ID;

async function login(email, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, venue_id: VENUE_ID, email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(j)}`);
  return j;
}
async function authed(token, path, method = 'GET', body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: r.status, body: j };
}
const wordCount = (s) => (s ? s.trim().split(/\s+/).length : 0);
const line = (t) => console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`);

async function main() {
  // -- SCENE 1: Gaming Attendant (Tier 7) RG question ----------------------
  line('SCENE 1 — Gaming Attendant (Tier 7): the RG question');
  const grace = await login('grace@pinnacle.test', 'floor-1234');
  console.log(`logged in: ${grace.role_at_login} (tier ${grace.role_tier})`);
  const q1 = "A patron has been sitting at the same machine for four hours and has told me twice that they're fine. What do I need to do?";
  const t0 = Date.now();
  const r1 = await authed(grace.token, '/api/chat', 'POST', { message: q1 });
  const ms = Date.now() - t0;
  console.log(`POST /api/chat -> ${r1.status} in ${ms}ms`);
  if (r1.body && typeof r1.body === 'object') {
    console.log(`\nANSWER:\n${r1.body.answer}`);
    console.log(`\nconfidence: ${r1.body.confidence} | lowConfidence: ${r1.body.lowConfidence} | floor: ${r1.body.confidenceFloor}`);
    console.log('citations:', JSON.stringify(r1.body.citations?.map((c) => `${c.source} — ${c.section} (${c.confidence})`), null, 0));
  } else { console.log(r1.body); }

  // -- SCENE 2: Duty Manager (Tier 5) opening + handover -------------------
  line('SCENE 2 — Duty Manager (Tier 5): opening shift summary + handover');
  const dan = await login('dan@pinnacle.test', 'duty-5678');
  console.log(`logged in: ${dan.role_at_login} (tier ${dan.role_tier})`);
  const sum = await authed(dan.token, '/api/shift-summary');
  console.log(`\nGET /api/shift-summary -> ${sum.status}`);
  const summaryText = sum.body?.summary || sum.body?.text || (typeof sum.body === 'string' ? sum.body : JSON.stringify(sum.body, null, 2));
  console.log(summaryText);
  if (sum.body?.summary) console.log(`\n[word count: ${wordCount(sum.body.summary)} — must be < 150]`);
  const ho = await authed(dan.token, '/api/handover');
  console.log(`\nGET /api/handover -> ${ho.status}`);
  console.log(typeof ho.body === 'string' ? ho.body : JSON.stringify(ho.body, null, 2));

  // -- SCENE 3: Compliance Monitor 10s Critical alert ----------------------
  line('SCENE 3 — Compliance Monitor: activate, wait 10s, Critical alert');
  const act = await authed(dan.token, '/api/compliance/activate', 'POST', {});
  console.log(`POST /api/compliance/activate -> ${act.status}: ${JSON.stringify(act.body)}`);
  console.log('waiting 11s for the trigger to fire...');
  const tStart = Date.now();
  await new Promise((r) => setTimeout(r, 11000));
  const alerts = await authed(dan.token, '/api/compliance/alerts');
  console.log(`\nGET /api/compliance/alerts -> ${alerts.status} (after ${Math.round((Date.now() - tStart) / 1000)}s)`);
  console.log(JSON.stringify(alerts.body, null, 2));
  // try to dismiss/ack
  const list = Array.isArray(alerts.body) ? alerts.body : (alerts.body?.alerts || []);
  const critical = list.find((a) => (a.severity || '').toLowerCase() === 'critical');
  if (critical) {
    const id = critical.eventId || critical.event_id || critical.id;
    // First prove dismissal WITHOUT a note is rejected (acknowledgement required).
    const noNote = await authed(dan.token, `/api/compliance/alerts/${id}/ack`, 'POST', {});
    console.log(`\n[guard] ack with NO note -> ${noNote.status}: ${JSON.stringify(noNote.body)} (expect 400)`);
    const ack = await authed(dan.token, `/api/compliance/alerts/${id}/ack`, 'POST', { note: 'Acknowledged — pulling a second attendant to the gaming floor now. — Dan' });
    console.log(`POST /api/compliance/alerts/${id}/ack (with note) -> ${ack.status}: ${JSON.stringify(ack.body)}`);
    const after = await authed(dan.token, '/api/compliance/alerts');
    console.log(`alerts after ack -> ${(after.body?.alerts || []).length} active (expect 0)`);
  } else {
    console.log('\n(no critical alert found to acknowledge)');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('DRIVE ERROR:', e.message); process.exit(1); });
