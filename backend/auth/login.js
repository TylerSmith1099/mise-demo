// Auth Agent File Save Protocol — canonical implementation lives at src/auth-service.js.
// Login flow: venue + role + PIN/password validated against staff table, JWT issued,
// session row written with role_at_login from the authenticated record (never from input).
export { login, AuthError } from '../src/auth-service.js';
