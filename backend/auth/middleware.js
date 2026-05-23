// Auth Agent File Save Protocol — canonical implementation lives at src/middleware.js.
// JWT validation + session liveness middleware.  Mount BEFORE any protected route.
export { authenticate } from '../src/middleware.js';
