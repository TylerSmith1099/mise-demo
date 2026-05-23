// Auth Agent File Save Protocol — canonical implementation lives at src/auth-service.js.
// Session lifecycle: validateAndTouchSession, logout.
// app.current_client_id is set per-transaction via src/db.js withClientContext(),
// always sourced from the verified token — never from user input.
export {
  validateAndTouchSession,
  logout,
  SESSION_INVALID,
  SESSION_TIMEOUT,
} from '../src/auth-service.js';
