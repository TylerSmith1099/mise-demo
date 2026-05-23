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
function composeAnswer({ results, lowConfidence, persona }) {
  if (!results.length) {
    return "I couldn't find anything in your venue's knowledge base for that. " +
      'Check with your Duty Manager before acting.';
  }
  const top = results[0];

  // Citation trail: the on-point source, plus the most relevant statute/code.
  // For a gambling/gaming question we prefer the Gaming Machine Act / RG Code
  // over an incidental national instrument, so the legal grounding is correct.
  const gamblingLeg = results.find(
    (r) => r.shared && /gaming machine|responsible gambling/i.test(r.source),
  );
  const anyLeg = results.find((r) => r.shared);
  const legCite = gamblingLeg || anyLeg;
  const sources = [`${top.source} — ${top.section}`];
  if (legCite && legCite.source !== top.source) {
    sources.push(`${legCite.source} — ${legCite.section}`);
  }
  const citation = `\n\n*(Source: ${sources.join('; ')})*`;

  // Calibrated low confidence -> hedge in the persona's escalation voice.
  if (lowConfidence) {
    const who = persona?.label === 'Gaming Attendant' ? 'your supervisor' : 'your Duty Manager';
    return (
      `I can't confidently match this to your knowledge base — check with ${who} ` +
      `before acting. The closest guidance I have:\n\n${top.content}${citation}`
    );
  }
  return `${top.content}${citation}`;
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
        const { rows } = await q(
          `SELECT c.white_label_name,
                  v.venue_name,
                  v.state        AS venue_state,
                  s.first_name,
                  s.last_name
             FROM venues v
             JOIN clients c ON c.client_id = v.client_id
             JOIN staff   s ON s.staff_id  = $2 AND s.deleted_at IS NULL
            WHERE v.venue_id = $1 AND v.deleted_at IS NULL`,
          [venueId, staffId],
        );
        return rows[0] || null;
      });
      if (!row) return res.status(404).json({ error: 'session_not_found' });
      res.json({
        whiteLabelName: row.white_label_name,
        venueName: row.venue_name,
        venueState: row.venue_state,
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

      const { results, topScore, lowConfidence } = await retrieveChunks({
        clientId,
        venueId,
        venueState,
        queryText: message,
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
          answer = composeAnswer({ results, lowConfidence, persona });
        }
      } else {
        answer = composeAnswer({ results, lowConfidence });
      }

      // Citations: source + section + confidence for each retrieved chunk — the
      // compliance audit trail the UI shows beneath the answer.
      const citations = results.map((r) => ({
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
