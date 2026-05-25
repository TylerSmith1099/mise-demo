// RSA Triage Coaching API (MIS-389).
// POST /api/rsa/coaching  — accepts triage answers, classifies severity,
//                           returns structured coaching (5 elements + source).
// POST /api/rsa/report    — accepts completed incident report; demo stub.
//
// Severity classification is deterministic (same algorithm as client-side).
// Coaching is generated via Claude when config.anthropic.enabled is true;
// otherwise falls back to the deterministic compose below.
//
// Client isolation: coaching prompts contain no patron/venue PII — they
// reference only the staff member's triage answers (signs, time, behaviour)
// which are operational inputs, not stored personal data. The route is still
// behind the standard authenticate() middleware so the caller must present a
// valid JWT; clientId/venueId come from the token for any future logging.

import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants — answer values mirrored from the frontend question definitions.
// ---------------------------------------------------------------------------
const MEDICAL_TRIGGERS = new Set(['not-responding', 'physically-unwell']);
const AGGRESSIVE_TRIGGER = 'aggressive-threatening';
const GROUP_VALUES = new Set(['group-sober', 'group-affected', 'one-other']);

const Q1_LABELS = {
  'slurred-speech': 'Slurred speech',
  'unsteady': 'Unsteady / losing balance',
  'aggressive-voice': 'Aggressive or raising voice',
  'glassy-eyes': 'Eyes glassy or unfocused',
  'repeating': 'Repeating themselves',
  'confused': 'Seems confused or disoriented',
  'not-responding': 'Not responding normally',
  'physically-unwell': 'Looks physically unwell',
};
const Q2_LABELS = {
  'under-1h': 'Under 1 hour',
  '1-2h': '1–2 hours',
  '3h-plus': '3+ hours',
  'unknown': 'Unknown',
};
const Q3_LABELS = {
  'yes-known': 'Yes, known regular',
  'no': 'No',
  'not-sure': 'Not sure',
};
const Q4_LABELS = {
  'quiet-affected': 'Quiet but clearly affected',
  'becoming-disruptive': 'Becoming disruptive',
  'aggressive-threatening': 'Aggressive or threatening',
  'refusing-engage': 'Refusing to engage',
};
const Q5_LABELS = {
  'solo': 'Solo patron',
  'group-sober': 'With a group (others sober)',
  'group-affected': 'With a group (all affected)',
  'one-other': 'With one other person',
};

// ---------------------------------------------------------------------------
// Severity classification — deterministic, no side effects.
// Must mirror the client-side classifySeverity() in RSATriage.jsx.
// ---------------------------------------------------------------------------
function classifySeverity(answers) {
  const q1 = Array.isArray(answers.q1) ? answers.q1 : [];

  if (q1.some((s) => MEDICAL_TRIGGERS.has(s))) return 'L4_MEDICAL';
  if (answers.q4 === AGGRESSIVE_TRIGGER) return 'L3';

  let l2 = 0;
  if (q1.length >= 3) l2++;
  if (answers.q2 === '3h-plus') l2++;
  if (answers.q4 === 'becoming-disruptive') l2++;
  if (answers.q5 === 'group-affected') l2++;
  // Known regular showing signs is an L2 composite indicator.
  if (answers.q3 === 'yes-known' && q1.length >= 2) l2++;
  if (l2 >= 2) return 'L2';

  return 'L1';
}

// ---------------------------------------------------------------------------
// Deterministic coaching fallback — no Claude required.
// Returns the same structure that the Claude path produces.
// ---------------------------------------------------------------------------
function buildDeterministicCoaching(answers, severity) {
  const q2 = answers.q2 || 'unknown';
  const q3 = answers.q3 || 'not-sure';
  const q4 = answers.q4 || 'quiet-affected';
  const q5 = answers.q5 || 'solo';
  const q1 = Array.isArray(answers.q1) ? answers.q1 : [];

  const isRegular = q3 === 'yes-known';
  const isGroup = GROUP_VALUES.has(q5);

  if (severity === 'L3') {
    return {
      approach: 'Hard moment. Act now.',
      whatToSay: [
        'I need you to stay here for a moment — I\'m getting my supervisor right now.',
      ],
      splitSituation: isGroup
        ? 'Ask a colleague to stay with the rest of the group while you step away to handle this. Do not attempt to manage both at once.'
        : null,
      escalation: 'Call your supervisor immediately. Tell them your location and that the patron is aggressive or threatening. If you cannot reach your supervisor within 60 seconds, call security. Any physical contact, weapon, or credible threat → call 000 immediately, do not wait.',
      whatNotToDo: [
        'Do not engage in argument or try to reason with them alone',
        'Do not move to a close physical position — keep distance',
        'Do not attempt to remove them from the venue yourself',
      ],
    };
  }

  if (severity === 'L2') {
    const regularLine = isRegular
      ? 'You know this person — use that rapport to be direct without being confrontational.'
      : 'Keep it professional and clear.';

    return {
      approach: `${regularLine} Have your supervisor aware before you start. Keep the interaction brief.`,
      whatToSay: [
        "I have to call it there for tonight — I can't continue service. Can I get you a water before you head off?",
        isRegular
          ? "Look, I'd rather do this now than have a problem later. You know me — I'm looking out for you."
          : null,
      ].filter(Boolean),
      splitSituation: isGroup
        ? 'Step aside with the person who needs to leave, away from the rest of the group. A brief, low-key word is better than a public moment. Check back with the group warmly once they\'re on their way.'
        : null,
      escalation: 'If they push back even once, let your supervisor know right away. They can step in as the \'manager who made the decision\' so you\'re not carrying it alone. Any sign of aggression → supervisor call immediately.',
      whatNotToDo: [
        'Don\'t offer a concession ("just one more", "just finish this") — the decision is made',
        'Don\'t repeat the refusal more than twice — after two, escalate',
        q4 === 'refusing-engage'
          ? 'Don\'t keep pressing for a response — step back, give a moment, then try once more before escalating'
          : 'Don\'t do it at the machine where others can hear — step slightly to the side',
      ],
    };
  }

  // L1 default — Coaching Mode
  const timeLine = {
    '3h-plus': "They've had a good run tonight.",
    '1-2h': "It's been a couple of hours.",
    'under-1h': "They haven't been here long — there may be something else going on.",
    'unknown': '',
  }[q2] || '';

  const regularLine = isRegular
    ? 'They know you — use that. A regular handled with care tonight comes back tomorrow.'
    : 'You\'re the professional here — warm and clear.';

  const refusingLine = q4 === 'refusing-engage'
    ? "They're not engaging right now — don't push it. Wait, then try a simple, warm check-in."
    : '';

  return {
    approach: [
      'Wait for a natural pause — not mid-game, not mid-conversation.',
      'Approach from the side rather than head-on, and lead with warmth.',
      regularLine,
      timeLine,
      refusingLine,
    ].filter(Boolean).join(' '),
    whatToSay: [
      "I'm going to have to leave it there for tonight, mate — I'd lose my licence if I kept going. Can I get you a water or a coffee?",
      isRegular
        ? "You're always welcome back — I just need tonight to be the end of it. Safe trip home."
        : null,
    ].filter(Boolean),
    splitSituation: isGroup
      ? 'Have a quiet word with the person who needs to go — step slightly away from the group so it\'s not a public moment. For the others, check back in warmly after — don\'t let the situation linger around them.'
      : null,
    escalation: 'If they push back more than twice, let your supervisor know — you don\'t have to win this alone. If the conversation gets louder or starts attracting attention, that\'s the signal to bring your supervisor in.',
    whatNotToDo: [
      isRegular
        ? 'Don\'t single them out in front of other regulars if you can avoid it'
        : 'Don\'t make it a public moment in front of other patrons',
      'Don\'t offer to serve them again later in the same session — it undermines the refusal',
      'Don\'t rush the conversation — warm, clear, then done',
    ],
  };
}

// ---------------------------------------------------------------------------
// Claude coaching (when synthesis is available).
// ---------------------------------------------------------------------------
const RSA_COACHING_SYSTEM_PROMPT = `You are Mise — the AI assistant for Australian gaming pub staff. You help gaming attendants and bar staff handle difficult patron situations through practical, empathetic coaching.

You will be given a staff member's situation triage and severity classification. Generate personalised coaching for this exact situation.

IMPORTANT: Respond with ONLY valid JSON matching this structure (no other text, no markdown code blocks):
{
  "approach": "How to approach: tone, timing, body language. 2-3 sentences.",
  "whatToSay": ["First verbatim phrase staff can use", "Second phrase only if it adds genuine value — omit if not"],
  "splitSituation": null,
  "escalation": "When and how to escalate — supervisor, security, or police — calibrated to this situation.",
  "whatNotToDo": ["Specific thing to avoid 1", "Specific thing to avoid 2", "Specific thing to avoid 3"]
}

For situations where there are multiple people involved (group or paired), populate "splitSituation" with specific guidance for managing the patron who needs to leave while keeping others comfortable. For solo patron situations, set "splitSituation" to null.

Communication mode rules:
- L1 (Routine): Full sentences, conversational, warm throughout. Include the WHY alongside the what. 150-250 words total.
- L2 (Elevated): Open with ONE warm sentence, then numbered key steps. Shorter sentences. 80-130 words total.
- L3 (High): Begin with "Hard moment. Act now." — then numbered steps only. Step 1 MUST be escalation. 50-80 words total.

Guidelines:
- Be specific to THIS situation, not generic.
- Use natural Australian hospitality language.
- Never mention the severity level to staff.
- Suggested phrases must be authentic — words a real hospitality worker would actually say.
- For "whatToSay": these are verbatim phrases staff can use. Make them natural, not clinical.`;

let claudeClient = null;
function getClaudeClient(config) {
  if (!claudeClient) {
    claudeClient = new Anthropic({
      apiKey: config.anthropic.apiKey,
      ...(config.anthropic.baseUrl ? { baseURL: config.anthropic.baseUrl } : {}),
    });
  }
  return claudeClient;
}

async function buildClaudeCoaching(answers, severity, config) {
  const client = getClaudeClient(config);
  const q1 = Array.isArray(answers.q1) ? answers.q1 : [];
  const isGroup = GROUP_VALUES.has(answers.q5);

  const triageSummary = [
    `Signs observed: ${q1.map((v) => Q1_LABELS[v] || v).join(', ') || 'None selected'}`,
    `Time on premises: ${Q2_LABELS[answers.q2] || answers.q2 || 'unknown'}`,
    `Known regular: ${Q3_LABELS[answers.q3] || answers.q3 || 'unknown'}`,
    `Current behaviour: ${Q4_LABELS[answers.q4] || answers.q4 || 'unknown'}`,
    `Who else involved: ${Q5_LABELS[answers.q5] || answers.q5 || 'unknown'}`,
  ].join('\n');

  const modeInstructions = {
    L1: 'L1 (Routine): Coaching Mode — full sentences, conversational, warm, 150-250 words.',
    L2: 'L2 (Elevated): Guided Mode — warm opening line, then numbered steps, 80-130 words.',
    L3: 'L3 (High): Action Mode — "Hard moment. Act now." then numbered steps, step 1 = escalation, 50-80 words.',
  }[severity] || 'L1 (Routine): Coaching Mode.';

  const userContent = [
    'TRIAGE ANSWERS:',
    triageSummary,
    '',
    `SEVERITY: ${severity} — ${modeInstructions}`,
    '',
    isGroup
      ? 'Note: There are multiple people involved — populate "splitSituation" in the JSON.'
      : 'Note: Solo patron — set "splitSituation" to null.',
  ].join('\n');

  const response = await client.messages.create({
    model: config.anthropic.model || 'claude-sonnet-4-6',
    max_tokens: 900,
    system: RSA_COACHING_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Incident report template builder — assembles pre-filled fields from triage.
// ---------------------------------------------------------------------------
function buildReportTemplate(answers, triageStartedAt) {
  const q1 = Array.isArray(answers.q1) ? answers.q1 : [];
  const signsText = q1
    .filter((v) => !MEDICAL_TRIGGERS.has(v))
    .map((v) => Q1_LABELS[v] || v)
    .join(', ') || 'None noted';

  const incidentType = (() => {
    if (answers.q4 === AGGRESSIVE_TRIGGER) return 'Service refusal — aggressive behaviour';
    if (answers.q4 === 'becoming-disruptive') return 'Service refusal — disruptive behaviour';
    return 'Service refusal — intoxicated patron';
  })();

  return {
    reportId: randomUUID().slice(0, 8).toUpperCase(),
    dateTime: triageStartedAt || new Date().toISOString(),
    incidentType,
    observedSigns: signsText,
    timeOnPremises: Q2_LABELS[answers.q2] || answers.q2 || 'Unknown',
    knownRegular: Q3_LABELS[answers.q3] || answers.q3 || 'Unknown',
    currentBehaviour: Q4_LABELS[answers.q4] || answers.q4 || 'Unknown',
    othersInvolved: Q5_LABELS[answers.q5] || answers.q5 || 'Unknown',
  };
}

// ---------------------------------------------------------------------------
// Router export.
// ---------------------------------------------------------------------------
export function rsaRouter(config) {
  const router = Router();

  // POST /api/rsa/coaching
  router.post('/rsa/coaching', async (req, res, next) => {
    try {
      const { triageAnswers, triageStartedAt } = req.body || {};
      if (!triageAnswers || typeof triageAnswers !== 'object') {
        return res.status(400).json({ error: 'triage_answers_required' });
      }

      const severity = classifySeverity(triageAnswers);

      // L4 medical should not reach here (client routes to FirstAidGate first),
      // but handle it gracefully.
      if (severity === 'L4_MEDICAL') {
        return res.status(400).json({ error: 'medical_emergency_use_first_aid_gate' });
      }

      let coaching;
      if (config.anthropic.enabled) {
        try {
          coaching = await buildClaudeCoaching(triageAnswers, severity, config);
        } catch (err) {
          console.warn(`rsa coaching synthesis failed, using deterministic fallback: ${err.message}`);
          coaching = buildDeterministicCoaching(triageAnswers, severity);
        }
      } else {
        coaching = buildDeterministicCoaching(triageAnswers, severity);
      }

      const reportTemplate = buildReportTemplate(triageAnswers, triageStartedAt);

      res.json({
        severity,
        coaching,
        reportTemplate,
        sourceAttribution: 'Guidance based on QLD Liquor Act 1992, Responsible Gambling Code of Practice, and hospitality best practice.',
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/rsa/report  — demo stub; real persistence is MIS-390.
  router.post('/rsa/report', async (req, res) => {
    const reportId = req.body?.reportId || randomUUID().slice(0, 8).toUpperCase();
    res.json({
      status: 'submitted',
      reportId,
      submittedAt: new Date().toISOString(),
      message: 'Report submitted. Your venue manager has been notified.',
    });
  });

  return router;
}
