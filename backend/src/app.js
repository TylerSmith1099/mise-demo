// Express app wiring. The ordering here IS the security boundary:
//   * /health and /auth/login are mounted BEFORE the authenticate middleware —
//     they are the only pre-auth endpoints (liveness; token issuance).
//   * authenticate(config) is then applied to the entire /api surface, so every
//     downstream route — "internal" or not — must present a valid token.

import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from './middleware.js';
import { login, logout, AuthError } from './auth-service.js';
import { withClientContext } from './db.js';
import { requireAccess } from './permissions.js';
import { chatRouter } from './chat-api.js';
import { shiftSummaryRouter } from './shift-summary-api.js';
import { runsheetRouter } from './runsheet-api.js';
import { complianceRouter } from './compliance-monitor.js';
import { demoRouter } from './api/routes/demo.js';

export function createApp(config) {
  const app = express();
  app.use(express.json());

  // ---- pre-auth endpoints -------------------------------------------------
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/auth/login', async (req, res, next) => {
    try {
      const { client_id, venue_id, email, password } = req.body || {};
      const result = await login(config, {
        clientId: client_id,
        venueId: venue_id,
        email,
        password,
        sourceIp: req.ip,
      });
      // Note: the response carries the token only. role_at_login is inside the
      // signed token; it is never accepted from the request on any later call.
      res.json({
        token: result.token,
        session_id: result.session.sessionId,
        role_at_login: result.staff.roleName,
        role_tier: result.staff.roleTier,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        // Single generic message regardless of the real (audited) reason.
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      next(err);
    }
  });

  // ---- everything below requires a valid token ----------------------------
  const api = express.Router();
  api.use(authenticate(config));

  // Identity echo — role and client come from the verified token, full stop.
  api.get('/me', (req, res) => {
    res.json({ ...req.auth });
  });

  // Demonstrates that a role supplied in the body is IGNORED: the effective
  // role is always the token's role_at_login. No conversational/payload path
  // can escalate it.
  api.post('/effective-role', (req, res) => {
    res.json({
      requested_role_in_body: req.body?.role ?? null, // echoed, never honoured
      effective_role: req.auth.roleAtLogin, // from token only
      effective_tier: req.auth.roleTier,
    });
  });

  // Staff directory — Coordinator / admin only (tier 4).
  api.get('/staff', requireAccess('staff'), async (req, res, next) => {
    try {
      const rows = await withClientContext(req.auth.clientId, (q) =>
        q(
          `SELECT staff_id, role_name, role_tier
             FROM staff WHERE deleted_at IS NULL ORDER BY role_tier`,
        ).then((r) => r.rows),
      );
      res.json({ client_id: req.auth.clientId, staff: rows });
    } catch (err) {
      next(err);
    }
  });

  api.post('/logout', async (req, res, next) => {
    try {
      await logout(req.auth);
      res.json({ status: 'logged_out' });
    } catch (err) {
      next(err);
    }
  });

  // Chat surface for the mobile UI (MIS-34): /api/session + /api/chat.
  // config carries the (optional) Claude synthesis settings — config.anthropic.
  api.use('/', chatRouter(config));

  // Duty Manager shift summary + handover (MIS-43): /api/shift-summary + /api/handover.
  api.use('/', shiftSummaryRouter());

  // Shift runsheet (MIS-107, for MIS-102): /api/runsheet + /api/runsheet/items/:id/check.
  api.use('/', runsheetRouter());

  // Compliance Monitor (MIS-44): /api/compliance/activate + /alerts + /:id/ack.
  // Mounted BEFORE the demo router so the live must-ack /compliance/alerts wins.
  api.use('/', complianceRouter());

  // Demo data (MIS-185): /api/roster/*, /api/pos/summary, /api/gaming/machines,
  // /api/compliance/demo-alerts, /api/compliance/register. Serves the mock
  // adapters for The Steward Hotel. Behind authenticate like everything else.
  api.use('/', demoRouter());

  app.use('/api', api);

  // ---- frontend (single-origin demo deploy) -------------------------------
  // Serve the prebuilt React SPA so the whole demo lives on ONE HTTPS origin:
  // the client uses relative /auth + /api paths, so same-origin means no CORS
  // and no hardcoded backend host. Mounted AFTER /auth, /health, and /api so
  // those always win; static + SPA fallback only catch everything else.
  // Disabled by SERVE_FRONTEND=0 (e.g. when a CDN serves the SPA instead).
  if (process.env.SERVE_FRONTEND !== '0') {
    const distDir =
      process.env.FRONTEND_DIST ||
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'dist');
    if (existsSync(join(distDir, 'index.html'))) {
      app.use(express.static(distDir));
      // SPA history fallback: any non-API GET returns index.html. /auth, /api,
      // and /health are already handled above and never reach here.
      app.get('*', (req, res, next) => {
        if (req.method !== 'GET') return next();
        res.sendFile(join(distDir, 'index.html'));
      });
    }
  }

  // Fallback error handler — never leak internals/secrets.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
