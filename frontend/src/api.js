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
    body: { client_id: clientId, venue_id: venueId, email, password },
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
