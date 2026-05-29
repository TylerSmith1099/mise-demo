// Chat API — the HTTP surface the mobile UI (MIS-34) talks to. Two routes:
//
//   GET  /api/session  -> the display identity for the top bar: white-label
//                         (venue) name, venue state, role, and staff name.
//                         Everything is read from the caller's OWN rows under
//                         the token's RLS context — nothing is hardcoded and no
//                         id/role is accepted from the request.
//   POST /api/chat     -> takes a question, runs the existing RAG retrieval
//                         (src/rag/retrieve.js) inside the caller's client
//                         context, persists the turn to conversations/messages,
//                         and returns the answer with source/section citations,
//                         a confidence score, and the lowConfidence flag.
//
// ISOLATION: every query goes through withClientContext(req.auth.clientId, ...),
// so a caller can only ever read/write their own client's rows plus shared
// legislation. clientId / venueId / staffId / sessionId all come from the
// VERIFIED token (req.auth), never the body.
//
// ANSWER SYNTHESIS (MIS-42): the `answer` is composed by Claude from a persona
// system prompt (keyed off the caller's verified role tier) + the retrieved
// chunks + the caller's own live DB context. This is the LLM half of the old
// BOUNDARY. It is feature-flagged on config (config.anthropic): when synthesis
// is unavailable (no key / no AU endpoint, no persona for the tier, or a
// transport error) the endpoint falls back to the deterministic `composeAnswer`
// below. Either way the response shape is identical, so the UI renders whatever
// `answer`, `citations`, and `confidence` this endpoint returns.

import { Router } from 'express';
import { withClientContext } from './db.js';
import { retrieveChunks, CONFIDENCE_FLOOR } from './rag/retrieve.js';
import { loadPersona } from './personas.js';
import { isSynthesisAvailable, synthesizeAnswer } from './rag/synthesize.js';

// Domain scoping by role tier (MIS-590 WS-2). Maps verified roleTier to the
// knowledge domains the persona is authorised to query. Gaming Attendants (tier 7)
// work both bar and gaming floor — they need access to liquor_rsa AND gambling_rsg.
// Duty Managers (tier 5) and above are unrestricted (null = all domains).
// This prevents employment/WHS/AML chunks from polluting RSA or RSG answers.
const TIER_DOMAINS = {
  7: ['liquor_rsa', 'gambling_rsg'], // Gaming Attendant: RSA + RSG only
  // tier 5 (Duty Manager) and all others: unrestricted
};

// Compose the answer deterministically from the retrieved chunks. This is the
// AU-resident, no-external-API path that ships the demo (board decision on
// approval b22383bd: no offshore LLM key). It NEVER invents content — it
// surfaces the most relevant retrieved guidance, which the SOP/legislation
// corpus already stores in operator voice (numbered procedures), and attaches
// the compliance citation trail. The LLM synthesis path (synthesize.js) remains
// behind config.anthropic for a future AU-hosted model — see the BOUNDARY note.
//
// The persona's confidence rules are honoured: with the calibrated floor
// (retrieve.js), a real match answers confidently and an off-topic query hedges.
// Intent-aware lead-chunk selection (MIS-201, Scene 1). The offline hashing
// embedder compresses cosine into a narrow band, so two topically-adjacent RG
// chunks — "interaction with a patron showing signs of problem gambling /
// distress" and "interaction with EXCLUDED patrons (self-exclusion)" — can land
// within ~0.03 of each other and fuse in the wrong order. A patron-DISTRESS
// question must lead with the distress-interaction guidance, not the
// self-exclusion procedure (a different scenario). Both chunks are still
// retrieved and cited; this only fixes which one leads the answer. When the
// AU-hosted semantic model lands, the bands separate and this is a no-op.
const DISTRESS_INTENT =
  /distress|upset|cry|crying|agitat|problem gambl|chasing loss|borrow money|wellbeing|welfare|in trouble|signs? of harm|self-disclos|continuous play/i;
const EXCLUSION_INTENT = /exclud|self-?exclu|banned|barred|exclusion register/i;
// A chunk that IS the problem-gambling / patron-distress interaction guidance.
const DISTRESS_CHUNK = (r) => {
  const t = `${r.section || ''} ${r.content || ''}`;
  return /distress|signs? of problem gambling|showing signs|problem gambling|wellbeing|continuous play/i.test(t);
};

// Pick the chunk that should LEAD the answer. Defaults to the fused top, but for
// a patron-distress / problem-gambling question whose top chunk is NOT the
// distress-interaction guidance (most often the self-exclusion procedure, which
// is a different scenario, but also any incidental harm/safety chunk), it
// promotes the highest-ranked distress-interaction chunk that the hybrid search
// already surfaced. Exclusion-intent questions are deliberately exempt so a
// genuine self-exclusion query still leads with the exclusion procedure.
function selectLeadResult(results, query = '') {
  if (results.length < 2) return results[0];
  if (
    DISTRESS_INTENT.test(query) &&
    !EXCLUSION_INTENT.test(query) &&
    !DISTRESS_CHUNK(results[0])
  ) {
    const distress = results.find(DISTRESS_CHUNK);
    if (distress) return distress;
  }
  return results[0];
}

function composeAnswer({ results, lowConfidence, persona, query = '' }) {
  if (!results.length) {
    return "Nothing in the knowledge base matched that question. Ask your duty manager.";
  }
  const top = selectLeadResult(results, query);

  // Calibrated low confidence -> hedge in the persona's escalation voice.
  // No inline citations in either path — source attribution is in the Sources panel.
  if (lowConfidence) {
    const who = persona?.label === 'Gaming Attendant' ? 'your supervisor' : 'your Duty Manager';
    return (
      `Low confidence on this one — confirm with ${who} before acting.\n\n${top.content}`
    );
  }
  return top.content;
}

// Pull the caller's OWN live operational rows to inject as synthesis context
// (Layer 3 of the knowledge base — never vectorised, read fresh per query). All
// reads run inside the caller's RLS client context, and personal rows are pinned
// to the caller's staffId, so this can only ever surface the caller's own data.
// Returns a compact plain-text summary, or null when there's nothing to add.
async function loadLiveContext({ clientId, venueId, staffId }) {
  return withClientContext(clientId, async (q) => {
    const lines = [];

    // The caller's current/next shift today.
    const shift = await q(
      `SELECT role_name, department, shift_start, shift_end, status
         FROM shifts
        WHERE staff_id = $1 AND venue_id = $2 AND deleted_at IS NULL
          AND shift_end >= now() - interval '12 hours'
        ORDER BY shift_start
        LIMIT 1`,
      [staffId, venueId],
    );
    if (shift.rows[0]) {
      const s = shift.rows[0];
      lines.push(
        `Your shift: ${s.role_name}${s.department ? ` (${s.department})` : ''}, ` +
          `${s.status}, ${new Date(s.shift_start).toISOString()} → ${new Date(s.shift_end).toISOString()}.`,
      );
    }

    // Open (unacknowledged) compliance events at this venue.
    const events = await q(
      `SELECT event_type, severity, description
         FROM compliance_events
        WHERE venue_id = $1 AND deleted_at IS NULL AND acknowledged_at IS NULL
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                 created_at DESC
        LIMIT 5`,
      [venueId],
    );
    for (const e of events.rows) {
      lines.push(`Open compliance event [${e.severity}] ${e.event_type}: ${e.description}`);
    }

    // The caller's own certifications expiring within 30 days.
    const certs = await q(
      `SELECT cert_type, status, expires_at, is_stale
         FROM certifications
        WHERE staff_id = $1 AND deleted_at IS NULL
          AND expires_at <= now() + interval '30 days'
        ORDER BY expires_at
        LIMIT 5`,
      [staffId],
    );
    for (const c of certs.rows) {
      // Legal bar (MIS-160): seeded/last-known cert data must travel with the
      // approved provenance disclosure so staff cannot rely on it as verified.
      const provenance = c.is_stale
        ? ' *Last-known record — not live-verified. Confirm with your venue records.*'
        : '';
      lines.push(
        `Your certification ${c.cert_type} (${c.status}) expires ${new Date(c.expires_at).toISOString()}.${provenance}`,
      );
    }

    return lines.length ? lines.join('\n') : null;
  });
}

export function chatRouter(config) {
  const router = Router();

  // ---- GET /api/session : top-bar identity, all token-scoped ---------------
  router.get('/session', async (req, res, next) => {
    try {
      const { clientId, venueId, staffId, roleAtLogin, roleTier } = req.auth;
      const row = await withClientContext(clientId, async (q) => {
        // venueId is null for area/group-scope staff (tiers 1-3); use a LEFT
        // JOIN so the query resolves for both venue-scoped and venue-less sessions.
        // RLS (app.current_client_id) already restricts the clients row to the
        // correct tenant; the parameter $2::uuid is null for group-GM, causing
        // the LEFT JOIN to return null venue columns rather than 0 rows.
        const { rows } = await q(
          `SELECT c.white_label_name,
                  v.venue_name,
                  v.state        AS venue_state,
                  v.venue_address,
                  s.first_name,
                  s.last_name
             FROM clients c
             JOIN staff   s ON s.staff_id  = $1 AND s.deleted_at IS NULL
        LEFT JOIN venues v ON v.venue_id = $2::uuid AND v.deleted_at IS NULL`,
          [staffId, venueId],
        );
        return rows[0] || null;
      });
      if (!row) return res.status(404).json({ error: 'session_not_found' });
      res.json({
        whiteLabelName: row.white_label_name,
        venueName: row.venue_name,
        venueState: row.venue_state,
        venueAddress: row.venue_address || null,
        role: roleAtLogin,
        roleTier,
        staffName: `${row.first_name} ${row.last_name}`.trim(),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- POST /api/chat : ask a question, get an answer + citations ----------
  router.post('/chat', async (req, res, next) => {
    try {
      const { clientId, venueId, staffId, sessionId, roleTier } = req.auth;
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const incomingConversationId = req.body?.conversationId || null;
      if (!message) return res.status(400).json({ error: 'message_required' });

      // The caller's venue state scopes retrieval (QLD venue never sees NSW-only
      // chunks). Read it from the caller's own venue row under RLS.
      const venueState = await withClientContext(clientId, async (q) => {
        const { rows } = await q(
          `SELECT state FROM venues WHERE venue_id = $1 AND deleted_at IS NULL`,
          [venueId],
        );
        return rows[0]?.state ?? null;
      });

      // Derive persona domains from verified role tier (MIS-590 WS-2).
      // null = unrestricted (Duty Manager and above see all domains).
      const personaDomains = TIER_DOMAINS[roleTier] ?? null;

      const { results, topScore, lowConfidence } = await retrieveChunks({
        clientId,
        venueId,
        venueState,
        queryText: message,
        domains: personaDomains,
      });

      // Persona is keyed off the VERIFIED role tier (token only): Tier 7 →
      // Gaming Attendant, Tier 5 → Duty Manager. null when no persona exists
      // for the tier, in which case we use the deterministic compose.
      const persona = loadPersona(roleTier);

      let answer;
      if (isSynthesisAvailable(config, persona)) {
        // Layer-3 live context, RLS-scoped to this caller.
        const liveContext = await loadLiveContext({ clientId, venueId, staffId });
        try {
          answer = await synthesizeAnswer({
            config,
            persona,
            results,
            liveContext,
            message,
            topScore,
            lowConfidence,
            confidenceFloor: CONFIDENCE_FLOOR,
          });
        } catch (err) {
          // Fail safe, not closed: never drop the turn because synthesis is
          // unreachable. Fall back to deterministic compose; log non-secret cause.
          console.warn(`chat synthesis failed, using deterministic fallback: ${err.message}`);
          answer = composeAnswer({ results, lowConfidence, persona, query: message });
        }
      } else {
        answer = composeAnswer({ results, lowConfidence, query: message });
      }

      // Citations: source + section + confidence for each retrieved chunk — the
      // compliance audit trail the UI shows beneath the answer. The chunk that
      // LEADS the answer is listed first so the Sources list stays coherent with
      // the answer text (intent routing, MIS-201); the rest keep retrieval order.
      const lead = selectLeadResult(results, message);
      const orderedResults = lead && results[0] !== lead
        ? [lead, ...results.filter((r) => r !== lead)]
        : results;
      const citations = orderedResults.map((r) => ({
        source: r.source,
        section: r.section,
        confidence: r.confidence,
        shared: r.shared,
        venueState: r.venueState,
      }));

      // Persist the turn (user + assistant) inside the caller's client context.
      const conversationId = await withClientContext(clientId, async (q) => {
        let convId = incomingConversationId;
        if (convId) {
          // Confirm the conversation belongs to this caller; RLS already scopes
          // to client, this also pins it to the staff member + session.
          const { rows } = await q(
            `SELECT conversation_id FROM conversations
              WHERE conversation_id = $1 AND staff_id = $2 AND deleted_at IS NULL`,
            [convId, staffId],
          );
          if (!rows.length) convId = null;
        }
        if (!convId) {
          const { rows } = await q(
            `INSERT INTO conversations (client_id, venue_id, staff_id, session_id)
             VALUES ($1, $2, $3, $4) RETURNING conversation_id`,
            [clientId, venueId, staffId, sessionId],
          );
          convId = rows[0].conversation_id;
        }
        await q(
          `INSERT INTO messages (conversation_id, client_id, role, content)
           VALUES ($1, $2, 'user', $3)`,
          [convId, clientId, message],
        );
        await q(
          `INSERT INTO messages (conversation_id, client_id, role, content, confidence_score)
           VALUES ($1, $2, 'assistant', $3, $4)`,
          [convId, clientId, answer, Number(topScore.toFixed(2))],
        );
        return convId;
      });

      res.json({
        conversationId,
        answer,
        citations,
        confidence: topScore,
        lowConfidence,
        confidenceFloor: CONFIDENCE_FLOOR,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
