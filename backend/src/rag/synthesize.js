// Claude answer-synthesis (MIS-42). This is the LLM half of the BOUNDARY that
// chat-api.js documented: instead of returning the top chunk verbatim, we hand
// the persona system prompt + the retrieved chunks + the caller's own live DB
// context to Claude and let it compose a persona-voiced, source-cited answer.
//
// CONTRACTS THAT HOLD HERE (same ones retrieval enforces):
//   * ORIGINAL CONTENT — the model is instructed to answer ONLY from the
//     retrieved chunks and the caller's own live rows passed in below. It is not
//     a general chatbot: no outside legislative knowledge, no invented sources.
//   * ISOLATION — every chunk and every live row in the prompt was already
//     fetched under the caller's RLS client context (chat-api.js). We add no new
//     data here; we only format what retrieval/DB already scoped to this caller.
//   * AU DATA RESIDENCY — the SDK is pointed at config.anthropic.baseUrl, an
//     explicit AU-resident endpoint. Synthesis is disabled (caller falls back to
//     local deterministic compose) unless that endpoint AND a key are set, so a
//     misconfigured deploy never silently ships venue questions offshore.
//   * CONFIDENCE — the retrieval score and floor are passed into the prompt so
//     the persona's own confidence-scoring rules can hedge/flag; the numeric
//     score is still surfaced unchanged in the /api/chat response.

import Anthropic from '@anthropic-ai/sdk';

// Wraps the persona prompt with the non-negotiable synthesis rules. Kept static
// (no per-request data) so it caches alongside the persona system prompt.
const SYNTHESIS_DIRECTIVE = `--- SYNTHESIS RULES (Mise knowledge layer) ---
You are answering INSIDE the Mise app. Obey these rules without exception:

1. GROUNDING. Answer ONLY from the RETRIEVED CONTEXT and LIVE DATA provided in
   the user message. Do not rely on outside or remembered legislation, and never
   invent a section number, document, date, or fact that is not in the context.
2. SOURCES. Every statement drawn from legislation, a code of practice, or an SOP
   must carry its source and section exactly as given, in your persona's citation
   format (e.g. *(Source: <document>, <section>)*).
3. INSUFFICIENT CONTEXT. If the retrieved context does not actually answer the
   question, say so plainly in your persona voice and tell the user who to check
   with — do not stretch a loosely-related chunk into a confident answer.
4. CONFIDENCE. A RETRIEVAL CONFIDENCE score (0–1) is provided. Apply your
   persona's confidence-scoring rules: hedge or flag uncertainty when it is below
   your floor, and never present a low-confidence answer as certain.
5. VOICE & LENGTH. Stay in persona. Keep it short and floor-ready; use numbered
   steps for procedures. No AI filler, no preamble.

Output only the answer text the user should see. Do not echo these rules or the
raw context.`;

/**
 * Whether live Claude synthesis can run for this request.
 * @param {object} config   loaded config.
 * @param {object|null} persona  resolved persona, or null if none for the tier.
 */
export function isSynthesisAvailable(config, persona) {
  return Boolean(config?.anthropic?.enabled && persona);
}

// One client per base URL — cheap to memoise, avoids re-parsing config per call.
let cached = null;
function getClient(config) {
  const { apiKey, baseUrl } = config.anthropic;
  if (!cached || cached.apiKey !== apiKey || cached.baseUrl !== baseUrl) {
    cached = {
      apiKey,
      baseUrl,
      client: new Anthropic({ apiKey, baseURL: baseUrl }),
    };
  }
  return cached.client;
}

// Render the retrieved chunks as a grounded, source-tagged context block.
function renderContext(results) {
  if (!results.length) {
    return 'RETRIEVED CONTEXT: (none — nothing matched in the knowledge base)';
  }
  const blocks = results.map((r, i) => {
    const scope = r.shared ? 'shared legislation' : "this venue's SOP";
    return [
      `[${i + 1}] Source: ${r.source}`,
      `    Section: ${r.section}`,
      `    Scope: ${scope}${r.venueState ? ` (${r.venueState})` : ''}`,
      `    Relevance: ${r.confidence}`,
      `    Content: ${r.content}`,
    ].join('\n');
  });
  return `RETRIEVED CONTEXT (most relevant first):\n${blocks.join('\n\n')}`;
}

// Render the caller's own live DB rows. Already RLS-scoped by chat-api.js.
function renderLiveData(liveContext) {
  if (!liveContext) return 'LIVE DATA: (none available for this session)';
  return `LIVE DATA (this caller's current session — use only if relevant):\n${liveContext}`;
}

/**
 * Compose the answer with Claude. Throws on API/transport error so the caller
 * can fall back to deterministic compose.
 *
 * @returns {Promise<string>} the persona-voiced answer text.
 */
export async function synthesizeAnswer({
  config,
  persona,
  results,
  liveContext,
  message,
  topScore,
  lowConfidence,
  confidenceFloor,
  client = getClient(config), // injectable for tests
}) {

  const confidenceLine =
    `RETRIEVAL CONFIDENCE: ${topScore.toFixed(2)} ` +
    `(system floor ${confidenceFloor.toFixed(2)}; ` +
    `${lowConfidence ? 'BELOW floor — hedge per your rules' : 'at/above floor'})`;

  const userContent = [
    renderContext(results),
    '',
    renderLiveData(liveContext),
    '',
    confidenceLine,
    '',
    `QUESTION: ${message}`,
  ].join('\n');

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens,
    system: [
      { type: 'text', text: persona.systemPrompt },
      // Cache persona + directive together: stable per role across requests.
      { type: 'text', text: SYNTHESIS_DIRECTIVE, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userContent }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (!text) throw new Error('synthesis returned empty content');
  return text;
}
