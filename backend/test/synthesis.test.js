// Synthesis-layer tests (MIS-42). These run OFFLINE — no real Claude call, no
// DB. A fake Anthropic client captures the request so we can assert the prompt
// honours the grounding/citation/confidence/isolation contracts, plus that the
// persona-gating and the empty-response guard behave.
//
// The end-to-end acceptance (Tier 7 / Tier 5 sessions returning persona-voiced,
// QLD-cited answers from live mise_demo data) additionally requires an
// AU-resident Claude key, which is operator-provisioned and not available in CI
// — see RAG.md "Claude synthesis (MIS-42)".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadPersona } from '../src/personas.js';
import { isSynthesisAvailable, synthesizeAnswer } from '../src/rag/synthesize.js';

const CONFIG = { anthropic: { enabled: true, model: 'claude-opus-4-7', maxTokens: 1024 } };

// A QLD RG-Code chunk like retrieve.js would return for the Scene-1 question.
const RESULTS = [
  {
    chunkId: 'rg-code-2024-s4.2-001',
    source: 'QLD Responsible Gambling Code of Practice 2024',
    section: '4.2 — Patron Interaction Obligations',
    content:
      'A mandatory patron interaction is required when a patron has gambled continuously for an extended period. Approach calmly, check wellbeing, offer a break, and document the interaction.',
    venueState: 'QLD',
    shared: true,
    confidence: 0.82,
  },
];

function fakeClient(capture, reply = 'Approach the patron... *(Source: QLD Responsible Gambling Code of Practice 2024, s.4.2)*') {
  return {
    messages: {
      create: async (req) => {
        capture.req = req;
        return { content: [{ type: 'text', text: reply }] };
      },
    },
  };
}

test('isSynthesisAvailable gates on config + persona', () => {
  const ga = loadPersona(7);
  assert.equal(isSynthesisAvailable(CONFIG, ga), true);
  assert.equal(isSynthesisAvailable({ anthropic: { enabled: false } }, ga), false);
  assert.equal(isSynthesisAvailable(CONFIG, null), false);
});

test('prompt carries persona, retrieved sources/sections, confidence and the question', async () => {
  const capture = {};
  const persona = loadPersona(7); // Gaming Attendant
  const answer = await synthesizeAnswer({
    config: CONFIG,
    persona,
    results: RESULTS,
    liveContext: 'Your shift: Gaming Attendant (gaming), active.',
    message: 'A patron has been sitting at the same machine for four hours...',
    topScore: 0.82,
    lowConfidence: false,
    confidenceFloor: 0.6,
    client: fakeClient(capture),
  });

  assert.match(answer, /Source: QLD Responsible Gambling/);

  // System: persona prompt + the static synthesis directive.
  const systemText = capture.req.system.map((b) => b.text).join('\n');
  assert.match(systemText, /Gaming Attendant Agent/);
  assert.match(systemText, /SYNTHESIS RULES/);
  assert.match(systemText, /Answer ONLY from the RETRIEVED CONTEXT/);
  // Persona+directive cached together for cross-request reuse.
  assert.equal(capture.req.system.at(-1).cache_control.type, 'ephemeral');

  // User: grounded context with source + section, live data, confidence, question.
  const userText = capture.req.messages[0].content;
  assert.match(userText, /QLD Responsible Gambling Code of Practice 2024/);
  assert.match(userText, /4\.2 — Patron Interaction Obligations/);
  assert.match(userText, /shared legislation \(QLD\)/);
  assert.match(userText, /Your shift: Gaming Attendant/);
  assert.match(userText, /RETRIEVAL CONFIDENCE: 0\.82/);
  assert.match(userText, /four hours/);

  assert.equal(capture.req.model, 'claude-opus-4-7');
});

test('low confidence is flagged to the model for hedging', async () => {
  const capture = {};
  await synthesizeAnswer({
    config: CONFIG,
    persona: loadPersona(5), // Duty Manager
    results: RESULTS,
    liveContext: null,
    message: 'edge-case question',
    topScore: 0.41,
    lowConfidence: true,
    confidenceFloor: 0.6,
    client: fakeClient(capture),
  });
  const userText = capture.req.messages[0].content;
  assert.match(userText, /BELOW floor — hedge per your rules/);
  assert.match(userText, /LIVE DATA: \(none available/);
});

test('empty model output throws so the caller can fall back', async () => {
  await assert.rejects(
    synthesizeAnswer({
      config: CONFIG,
      persona: loadPersona(7),
      results: RESULTS,
      liveContext: null,
      message: 'q',
      topScore: 0.7,
      lowConfidence: false,
      confidenceFloor: 0.6,
      client: { messages: { create: async () => ({ content: [] }) } },
    }),
    /empty content/,
  );
});
