// API client for the Mise backend (../src). Single source of all data — the UI
// holds NO hardcoded venue/role/answer content; everything below comes from the
// token-authenticated API. The bearer token is the only thing kept client-side
// (sessionStorage, cleared on logout), and the server derives identity/role/
// client from it — the client never sends a role or client_id.
//
// Endpoints used:
//   POST /auth/login   -> { token, session_id, role_at_login, role_tier }
//   GET  /api/session  -> { whiteLabelName, venueName, venueState, role, staffName }
//   POST /api/chat     -> { conversationId, answer, citations[], confidence, lowConfidence, confidenceFloor }
//   GET  /api/shift-summary -> { venueName, staffing, gamingLabour, openCompliance[], priorHandover } (MIS-43)
//   GET  /api/handover -> { fromRole, toRole, shiftDate, author, openComplianceItems[], staffingNotes, incidentsSummary, actionItems[] } (MIS-43)
//   GET  /api/runsheet -> { shiftDate, shiftLabel, items[] }                      (MIS-102 — endpoint owned by Backend)
//   POST /api/runsheet/items/:id/check { done } -> { id, done, completedAt, completedBy } (MIS-102)

const TOKEN_KEY = 'mise.token';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty/non-JSON body */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `request_failed_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function login({ clientId, venueId, email, password }) {
  const data = await request('/auth/login', {
    method: 'POST',
    auth: false,
    body: { client_id: clientId, venue_id: venueId?.trim() || null, email, password },
  });
  setToken(data.token);
  return data;
}

export function fetchSession() {
  return request('/api/session');
}

export function fetchShiftSummary() {
  return request('/api/shift-summary');
}

export function fetchHandover() {
  return request('/api/handover');
}

export function sendChat({ message, conversationId }) {
  return request('/api/chat', {
    method: 'POST',
    body: { message, conversationId },
  });
}

export async function logout() {
  try {
    await request('/api/logout', { method: 'POST' });
  } finally {
    clearToken();
  }
}

// ---- Run Sheet Full (MIS-639 / MIS-626 W3) --------------------------------
// Full 9-section rebuilt run sheet: header, alerts, roster, sports, specials,
// bookings, incentives, budget (DM/VM only), handover notes.
// Shape: { roleTier, shiftId, header, alerts[], roster, sports[], specials,
//          bookings?, incentives[], budget?, handover }
export function fetchRunSheetFull() {
  return request('/api/run-sheet');
}
// Acknowledge a run-sheet compliance alert (logs to compliance_acknowledgements).
export function acknowledgeRunSheetAlert({ refId, alertType }) {
  return request(`/api/run-sheet/alerts/${encodeURIComponent(refId)}/ack`, {
    method: 'POST',
    body: { alertType },
  });
}
// Auto-save the current shift's handover note.
export function saveHandoverNote({ bodyText, tags }) {
  return request('/api/run-sheet/handover', {
    method: 'POST',
    body: { bodyText, tags },
  });
}

// ---- Shift Runsheet (MIS-102) ---------------------------------------------
// The runsheet is a token/RLS-scoped task list for the caller's current shift.
// Expected shape (defined by UI, implemented by Backend — see Ops/Issues/MIS-UI-NAV.md):
//   { shiftDate: ISO, shiftLabel: 'Evening', items: [
//       { id, label, dueAt?: ISO, category?: 'open'|'compliance'|'gaming'|'bar'|'open_close',
//         done: bool, completedAt?: ISO, completedBy?: string } ] }
export function fetchRunsheet() {
  return request('/api/runsheet');
}
// Check / uncheck a task. The server stamps completedAt/completedBy from the
// verified session — the client never supplies who or when.
export function checkRunsheetItem({ id, done }) {
  return request(`/api/runsheet/items/${encodeURIComponent(id)}/check`, {
    method: 'POST',
    body: { done },
  });
}

// ---- Revenue Intelligence (MIS-238) ---------------------------------------
// Duty Manager / Venue Manager only. Labour % per department vs benchmark.
export function fetchRevenueIntelligence() {
  return request('/api/revenue-intelligence');
}
export function flagRevenueItem({ department, labourPct }) {
  return request('/api/revenue-intelligence/flag', {
    method: 'POST',
    body: { department, labourPct },
  });
}

// ---- Reservations (MIS-243) -----------------------------------------------
// All roles. Returns the demo Saturday's reservation data by default.
// Shape: { date, services: [{ serviceCategory, serviceName, window,
//   totalBookedPax, vipCount, walkInPrediction, timeSlots, bookings }] }
export function fetchReservations(date) {
  const path = date ? `/api/reservations/${encodeURIComponent(date)}` : '/api/reservations';
  return request(path);
}

// ---- Reports (MIS-253) ----------------------------------------------------
// Venue Manager only (Tier 4). 7-day P&L summary from pnl_summary table.
// Shape: { periodLabel, departments: [{ department, revenue, labourCost, labourPct,
//   netGamingRevenue?, meterTurnover? }] }
export function fetchReports() {
  return request('/api/reports');
}

// ---- Incidents (MIS-390) --------------------------------------------------
// All MVP roles. Tier 7 sees own incidents only (server-enforced).
// Shape: { incidents: [{ incidentId, incidentType, incidentLabel, severityLevel,
//   severityLabel, severityColour, status, incidentAt, locationInVenue,
//   description, reportedByName, routing: { obligations[], notifications[], ... } }] }
export function fetchIncidents() {
  return request('/api/incidents');
}
// Full incident detail including obligation rows + notification log.
export function fetchIncidentDetail(incidentId) {
  return request(`/api/incidents/${encodeURIComponent(incidentId)}`);
}
// Create a draft incident report (pre-populated from triage).
export function createIncident(body) {
  return request('/api/incidents', { method: 'POST', body });
}
// Submit a draft — triggers obligation creation + notification routing.
export function submitIncident(incidentId) {
  return request(`/api/incidents/${encodeURIComponent(incidentId)}/submit`, { method: 'POST' });
}

// ---- RSA Triage Coaching (MIS-389) ----------------------------------------
// Sends completed triage answers; receives structured coaching + report template.
export function sendRSACoaching({ triageAnswers, triageStartedAt }) {
  return request('/api/rsa/coaching', {
    method: 'POST',
    body: { triageAnswers, triageStartedAt },
  });
}
// Submit a completed incident report (demo stub — real persistence is MIS-390).
export function submitRSAReport(reportData) {
  return request('/api/rsa/report', {
    method: 'POST',
    body: reportData,
  });
}

// ---- Admin Desktop Homepage (MIS-430) ----------------------------------------
// Composable homepage payload: shifts, incidents, reports, compliance, revenue, labour.
export function fetchAdminHomepage() {
  return request('/api/admin/homepage');
}
// Group overview: per-venue summary for all venues in caller's scope (MIS-467).
export function fetchGroupOverview() {
  return request('/api/admin/group-overview');
}
// Live-section section endpoints (incremental refresh).
export function fetchAdminShiftsOnFloor() {
  return request('/api/admin/shifts/on-floor');
}
export function fetchAdminRevenue({ from, to, venueId } = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (venueId) params.set('venueId', venueId);
  const qs = params.toString();
  return request(`/api/admin/revenue/daily${qs ? '?' + qs : ''}`);
}
export function fetchAdminLabour({ from, to, venueId } = {}) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (venueId) params.set('venueId', venueId);
  const qs = params.toString();
  return request(`/api/admin/labour/daily${qs ? '?' + qs : ''}`);
}
// Open an SSE connection to the admin live stream.
// Returns an EventSource. Caller must call .close() on cleanup.
export function openAdminStream(onEvent) {
  const token = getToken();
  const url = `/api/admin/stream${token ? '?token=' + encodeURIComponent(token) : ''}`;
  const es = new EventSource(url);
  const handler = (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: e.type, ...data });
    } catch {
      // malformed event — ignore
    }
  };
  ['incident:new', 'incident:updated', 'staff:clock_in', 'staff:clock_out', 'compliance:alert_new'].forEach(
    (evt) => es.addEventListener(evt, handler),
  );
  return es;
}

// ---- Reporting & Filtering (MIS-429) -----------------------------------------
// POST /api/admin/reports/query — single endpoint for mobile + desktop.
// Role scope is derived from verified JWT server-side; never sent in body.
// params: { metric, grain, range: {from, to}, comparison: {mode, alignment}, scope: {venueIds}, view }
export function queryAdminReport(params) {
  return request('/api/admin/reports/query', { method: 'POST', body: params });
}

// POST /api/admin/reports/export — returns a blob (CSV or PDF).
// Tier 5 (DM) cannot call this — server enforces via admin-reports-export permission.
export async function exportAdminReport(params) {
  const token = getToken();
  const res = await fetch('/api/admin/reports/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data?.error || `export_failed_${res.status}`);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : 'reporting_export';
  return { blob, filename };
}

// ---- Progression Tracker (MIS-536) ----------------------------------------
// Individual development profile — tier 5 and 7.
// Shape: { staffName, role, knowledgeAreas[], recentActivity, certifications[], nudge, sessionCount }
export function fetchDevelopmentProfile() {
  return request('/api/development-profile');
}
// Team development view — tier 5 (Duty Manager) and tier 4 (Venue Manager).
// Shape: { venueName, summary, staff[], teamGaps[], spotlight }
export function fetchTeamDevelopment() {
  return request('/api/team-development');
}

// ---- Compliance Monitor (MIS-44) ------------------------------------------
// Arm the monitor; the backend runs Check 4 against live roster ~10s later.
export function activateComplianceMonitor() {
  return request('/api/compliance/activate', { method: 'POST' });
}
// Active (unacknowledged) Critical alerts for the caller's venue.
export function fetchComplianceAlerts() {
  return request('/api/compliance/alerts');
}
// Clear an alert with a typed action note (persists acknowledged_at/by).
export function acknowledgeAlert({ eventId, note }) {
  return request(`/api/compliance/alerts/${encodeURIComponent(eventId)}/ack`, {
    method: 'POST',
    body: { note },
  });
}
