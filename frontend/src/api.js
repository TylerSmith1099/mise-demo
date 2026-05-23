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
