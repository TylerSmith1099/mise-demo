/**
 * Demo data routes — wires the mock adapters (MIS-185) to the API surface.
 *
 * Mounted inside the authenticated /api router (see app.js), so every endpoint
 * here still requires a valid JWT — the demo does not punch a hole in auth.
 *
 * Route-collision note: GET /api/compliance/alerts is OWNED by the live
 * Compliance Monitor (MIS-44) — the red, must-acknowledge understaffing banner
 * that drives Scene 3. We do NOT shadow it. The mock certification / inspection
 * / licence alerts (Scene 3 items #1–#3 surfaced on login) are served here at
 * GET /api/compliance/demo-alerts instead. See Mise-Demo-Data-Spec-V1.md.
 */

import { Router } from 'express';
import {
  getCurrentShift,
  getWeekRoster,
  getDeputyShapedResponse,
} from '../../integrations/mock/workforce.js';
import {
  getPosSummary,
  getGamingMachines,
  getGamingFinancials,
} from '../../integrations/mock/pos.js';
import {
  getComplianceAlerts,
  getFullRegister,
} from '../../integrations/mock/compliance.js';

export function demoRouter() {
  const router = Router();

  // ---- Roster ------------------------------------------------------------
  router.get('/roster/current', (_req, res) => {
    res.json(getCurrentShift());
  });

  router.get('/roster/week', (_req, res) => {
    res.json({ venue: 'The Steward Hotel', minimum: 3, days: getWeekRoster() });
  });

  // Raw Deputy-shaped payload, for anything that wants the vendor response form.
  router.get('/roster/raw', (_req, res) => {
    res.json(getDeputyShapedResponse());
  });

  // ---- POS / Gaming ------------------------------------------------------
  router.get('/pos/summary', (_req, res) => {
    res.json(getPosSummary());
  });

  router.get('/gaming/machines', (_req, res) => {
    res.json({ ...getGamingMachines(), financials: getGamingFinancials() });
  });

  // ---- Compliance (mock cert/inspection/licence — NOT the MIS-44 path) ---
  router.get('/compliance/demo-alerts', (_req, res) => {
    res.json({ alerts: getComplianceAlerts() });
  });

  router.get('/compliance/register', (_req, res) => {
    res.json(getFullRegister());
  });

  return router;
}
