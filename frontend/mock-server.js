// Mock API — VERIFICATION HARNESS ONLY. Not shipped, not used in production.
// It mirrors the real backend's response shapes (../src/chat-api.js,
// ../src/auth-service.js) so the UI can be rendered and screenshotted at 375px
// without a live Postgres + pgvector. Run with `npm run mock`, then start Vite
// with MOCK_API=1 so the proxy targets this instead of the real server.
//
// Content here is realistic QLD pub material (responsible-gambling, RSA) written
// for the demo client (Pinnacle Hotel Group / The Criterion Hotel, Brisbane) —
// it stands in for what the RAG layer returns from the real knowledge base.
import http from 'node:http';

const PORT = 4100;

// Group Admin session — roleTier 2 routes to admin desktop + Group Overview.
// Switch back to roleTier:5 for compliance monitor / DM testing.
const SESSION = {
  whiteLabelName: 'QHA Hotel Group',
  venueName: 'The Vault Bar',
  venueState: 'QLD',
  role: 'Group Admin',
  roleTier: 2,
  staffName: 'David Chen',
};

// --- Compliance Monitor mock state (MIS-44) --------------------------------
// Mirrors src/compliance-monitor.js: activation arms a 10s timer, after which
// Check 4 "writes" a Critical understaffing alert; ack clears it.
const COMPLIANCE_DELAY_MS = 10000;
const complianceState = {
  activatedAt: null,
  acknowledged: false,
  alert: {
    eventId: 'mock-evt-understaffing',
    eventType: 'gaming_understaffing',
    severity: 'critical',
    description:
      "Gaming floor understaffed — tonight's gaming evening shift (from 17:00) has " +
      '1 attendant on the floor (Grace Nguyen) but the 45-machine floor requires a ' +
      'minimum of 2. 1 short. Roster a second gaming attendant or restrict the floor.',
    createdAt: null,
  },
};
function activeAlerts() {
  const { activatedAt, acknowledged, alert } = complianceState;
  if (acknowledged || activatedAt == null) return [];
  if (Date.now() - activatedAt < COMPLIANCE_DELAY_MS) return [];
  return [{ ...alert, createdAt: alert.createdAt || new Date().toISOString() }];
}

// Canned answers keyed by a loose keyword match — stands in for RAG retrieval.
const ANSWERS = [
  {
    match: /self.?exclu|exclusion|ban/i,
    answer:
      'If a patron asks to self-exclude, give them a Self-Exclusion application immediately and treat the request as confidential. Once signed, they must be removed from the gaming room and the gaming machine areas, and the exclusion is recorded and shared across participating venues. Do not let them resume play, even on the same day. Notify the Duty Manager so the exclusion is logged before the end of shift.',
    citations: [
      { source: 'Gaming Machine Act 1991 (Qld)', section: 's 273 — Exclusion provisions', confidence: 0.82, shared: true },
      { source: 'Pinnacle RG Policy', section: '4.2 Handling self-exclusion requests', confidence: 0.79, shared: false },
    ],
    confidence: 0.82,
    lowConfidence: false,
  },
  {
    match: /minor|under.?age|id|18/i,
    answer:
      'Anyone who looks under 25 must show acceptable photo ID before entering the gaming room or being served alcohol. Acceptable ID is a current driver licence, passport, or proof-of-age card. If they can’t produce it, refuse entry and service. A minor found in the gaming area must be asked to leave immediately and the incident logged.',
    citations: [
      { source: 'Liquor Act 1992 (Qld)', section: 's 155AA — Minors on premises', confidence: 0.74, shared: true },
      { source: 'Pinnacle RSA Procedure', section: '2.1 ID checks', confidence: 0.71, shared: false },
    ],
    confidence: 0.74,
    lowConfidence: false,
  },
];

const LOW_CONF = {
  answer:
    "I'm not fully certain on this one — confirm with your Duty Manager before acting. The closest match I have is the venue's general gaming-room conduct note, which doesn't directly cover your question.",
  citations: [
    { source: 'Pinnacle Gaming Room SOP', section: '1.0 General conduct', confidence: 0.41, shared: false },
  ],
  confidence: 0.41,
  lowConfidence: true,
};

function pickAnswer(message) {
  const hit = ANSWERS.find((a) => a.match.test(message || ''));
  return hit || LOW_CONF;
}

// --- MIS-43 shift summary + handover ---------------------------------------
// Mirrors src/shift-summary-api.js against the loaded Criterion demo data:
// gaming labour 13.1% (>12% flagged), 2 open incidents, prior-shift note.
const SHIFT_SUMMARY = {
  venueName: 'The Criterion Hotel',
  venueState: 'QLD',
  staffing: { onNow: 5, gamingOnFloor: 1, gamingMinAttendants: 2, gamingUnderstaffed: true },
  gamingLabour: {
    weeklyLabourCost: 16450,
    netGamingRevenueWeekly: 126000,
    pct: 13.1,
    thresholdPct: 12,
    flagged: true,
  },
  openCompliance: [
    {
      eventType: 'rsa_refusal',
      severity: 'warning',
      headline: 'RSA refusal',
      description: 'RSA refusal — patron refused further service at the main bar.',
      createdAt: '2026-05-21T15:10:00+10:00',
    },
    {
      eventType: 'egm_malfunction',
      severity: 'warning',
      headline: 'EGM malfunction',
      description: 'EGM malfunction — machine 32 door-open alarm; suspended.',
      createdAt: '2026-05-21T12:20:00+10:00',
    },
  ],
  priorHandover: {
    fromRole: 'Duty Manager (day)',
    shiftDate: '2026-05-21',
    highlights: [
      'RSA refusal at 15:10 still needs a follow-up outcome note.',
      'EGM 32 suspended (door alarm) — technician ETA not yet confirmed.',
      'Marcus Polk RSG expires in 5 days — cannot work gaming past expiry.',
    ],
  },
};

const HANDOVER = {
  fromRole: 'Duty Manager (day)',
  toRole: 'Duty Manager (evening)',
  shiftDate: '2026-05-21',
  author: 'Mia Fraser',
  openComplianceItems: [
    'RSA refusal at 15:10 still needs a follow-up outcome note.',
    'EGM 32 suspended (door alarm) — technician ETA not yet confirmed.',
    'Marcus Polk RSG expires in 5 days — cannot work gaming past expiry without renewal.',
  ],
  staffingNotes:
    'Evening gaming cover is light — only Grace confirmed on the floor for the 17:00 shift; venue minimum is 2 for 45 machines. Chase a second gaming attendant or pull cover.',
  incidentsSummary:
    'RG interaction on EGM 14 resolved (patron took a break). RSA refusal at the main bar — patron left, no escalation. EGM 32 out of service.',
  actionItems: [
    'Get a follow-up note on the RSA refusal.',
    'Roster a second gaming attendant for tonight or restrict floor.',
    'Confirm technician for EGM 32.',
    'Start Marcus RSG renewal.',
  ],
};

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(buf || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  if (method === 'POST' && url === '/auth/login') {
    return send(res, 200, {
      token: 'mock.jwt.token',
      session_id: 'mock-session',
      role_at_login: SESSION.role,
      role_tier: SESSION.roleTier,
    });
  }
  if (method === 'GET' && url === '/api/session') return send(res, 200, SESSION);
  if (method === 'POST' && url === '/api/chat') {
    const body = await readJson(req);
    const a = pickAnswer(body.message);
    return send(res, 200, {
      conversationId: 'mock-conv-1',
      answer: a.answer,
      citations: a.citations,
      confidence: a.confidence,
      lowConfidence: a.lowConfidence,
      confidenceFloor: 0.6,
      createdAt: new Date().toISOString(),
    });
  }
  if (method === 'POST' && url === '/api/compliance/activate') {
    if (complianceState.activatedAt == null) complianceState.activatedAt = Date.now();
    return send(res, 200, { activated: true, checkInSeconds: COMPLIANCE_DELAY_MS / 1000 });
  }
  if (method === 'GET' && url === '/api/compliance/alerts') {
    return send(res, 200, { alerts: activeAlerts() });
  }
  if (method === 'POST' && /^\/api\/compliance\/alerts\/[^/]+\/ack$/.test(url)) {
    const body = await readJson(req);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length < 3) return send(res, 400, { error: 'acknowledgement_note_required' });
    complianceState.acknowledged = true;
    return send(res, 200, {
      acknowledged: true,
      eventId: complianceState.alert.eventId,
      acknowledgedAt: new Date().toISOString(),
    });
  }
  if (method === 'GET' && url === '/api/shift-summary') return send(res, 200, SHIFT_SUMMARY);
  if (method === 'GET' && url === '/api/handover') return send(res, 200, HANDOVER);
  if (method === 'POST' && url === '/api/logout') return send(res, 200, { status: 'logged_out' });

  // ── Admin desktop endpoints (MIS-503 local QA) ─────────────────────────────
  if (method === 'GET' && url.startsWith('/api/admin/homepage')) {
    return send(res, 200, {
      scope: { venueIds: ['venue-vault'] },
      shiftSummary: { onFloorNow: 6, shifts: [] },
      incidents: [],
      reports: [],
      compliance: [{
        severity: 'critical',
        event_type: 'RSA certification expiry',
        description: 'RSA certification for Jane Smith — arrange renewal',
      }],
      revenue: [{ business_date: new Date().toISOString().slice(0,10), net_revenue_cents: 2640000, forecast_revenue_cents: 510000, variance_cents: 2130000, is_stale: false }],
      labour: [],
      dataFreshness: {},
    });
  }
  if (method === 'GET' && url.startsWith('/api/admin/group-overview')) {
    return send(res, 200, {
      group_name: 'QHA Hotel Group',
      period_label: 'Week to date',
      venue_count: 3,
      totals: {
        revenue_current: 18640000,
        revenue_target: 16000000,
        compliance_open: 5,
        compliance_breakdown: { L4: 1, L3: 2, L2: 2, L1: 0 },
        venues_red: 1,
        venues_over_labour: 1,
      },
      venues: [
        { id: 'vault', name: 'The Vault Bar', suburb: 'Brisbane CBD', type: 'Gaming Pub', status: 'red',
          revenue: { current_week: 8200000, target_week: 7000000, delta_pct: 17 },
          compliance: { open_count: 3, highest_severity: 'L4', severity_breakdown: { L4: 1, L3: 2, L2: 0, L1: 0 } },
          labour: { status: 'over', variance_pct: 8 },
          critical_flags: { count: 1 } },
        { id: 'meridian', name: 'Meridian Hotel', suburb: 'South Bank', type: 'Hotel Bar', status: 'warn',
          revenue: { current_week: 6440000, target_week: 6000000, delta_pct: 7 },
          compliance: { open_count: 2, highest_severity: 'L3', severity_breakdown: { L4: 0, L3: 2, L2: 0, L1: 0 } },
          labour: { status: 'on', variance_pct: 0 },
          critical_flags: { count: 0 } },
        { id: 'station', name: 'Station Arms', suburb: 'Fortitude Valley', type: 'Pub', status: 'ok',
          revenue: { current_week: 4000000, target_week: 3000000, delta_pct: 33 },
          compliance: { open_count: 0, highest_severity: null, severity_breakdown: { L4: 0, L3: 0, L2: 0, L1: 0 } },
          labour: { status: 'on', variance_pct: -2 },
          critical_flags: { count: 0 } },
      ],
    });
  }
  if (method === 'GET' && url.startsWith('/api/admin/stream')) {
    // SSE: send an empty stream and keep alive
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('data: {}\n\n');
    req.on('close', () => res.end());
    return;
  }

  send(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => console.log(`[mock-api] listening on http://localhost:${PORT}`));
