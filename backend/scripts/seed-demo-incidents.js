/**
 * seed-demo-incidents.js — Seed three demo incident reports for the QHA pitch.
 *
 * Demonstrates the incident routing matrix:
 *   1. Intoxicated patron — service refused (L1, in-house only)
 *   2. Self-exclusion breach (L2, OLGR + compliance officer notification)
 *   3. Serious assault (L3, police + [Confirm-Legal] OLGR + management chain notification)
 *
 * Idempotent: skips if today's incidents are already present for this venue.
 * Run after seed.js (needs staff to exist). Always runs at boot (non-fatal).
 *
 * Looks up staff IDs by email — does NOT rely on hardcoded UUIDs.
 */

import { randomUUID } from 'node:crypto';
import { initDb, withClientContext, closeDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import {
  getRouting,
  getObligationTypes,
  getNotificationRoles,
  calcDueBy,
  INCIDENT_TYPE_LABELS,
} from '../src/incident-matrix.js';

const DEMO_CLIENT_ID = process.env.DEMO_CLIENT_ID || 'a0000000-0000-4000-8000-000000000001';
const DEMO_VENUE_ID  = process.env.DEMO_VENUE_ID  || 'a0000000-0000-4000-8000-000000000002';

// Brisbane local date at boot (UTC+10).
const BASE_DATE = new Date(Date.now() + 10 * 3600 * 1000).toISOString().slice(0, 10);

function bne(dayOffset, hh, mm = 0) {
  const d = new Date(`${BASE_DATE}T00:00:00+10:00`);
  d.setDate(d.getDate() + dayOffset);
  const date = d.toISOString().slice(0, 10);
  return `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+10:00`;
}

// Seed one incident + its obligation + notification rows.
async function seedIncident(q, clientId, venueId, staffId, dutyManagerId, data) {
  const routing = getRouting(data.incidentType);
  const now = new Date().toISOString();

  const { rows: [row] } = await q(
    `INSERT INTO incident_reports (
        incident_id, client_id, venue_id, reported_by_staff_id,
        incident_type, severity_level,
        incident_at, location_in_venue,
        description, immediate_action_taken,
        patron_description, witnesses,
        police_called, police_reference,
        ambulance_called,
        duty_manager_staff_id,
        status, submitted_at
     ) VALUES (
        $1, $2, $3, $4,
        $5, $6,
        $7, $8,
        $9, $10,
        $11, $12,
        $13, $14,
        $15,
        $16,
        $17, $18
     )
     ON CONFLICT DO NOTHING
     RETURNING incident_id, status`,
    [
      data.incidentId, clientId, venueId, staffId,
      data.incidentType, routing.severityLevel,
      data.incidentAt, data.locationInVenue,
      data.description, data.immediateActionTaken,
      data.patronDescription || null, data.witnesses || null,
      data.policeCalled || false, data.policeReference || null,
      data.ambulanceCalled || false,
      dutyManagerId,
      data.status, data.submittedAt || null,
    ],
  );

  if (!row) {
    return; // already seeded
  }

  const submittedAt = data.submittedAt || now;

  // Obligation rows.
  for (const type of getObligationTypes(data.incidentType)) {
    const dueBy = calcDueBy(type, submittedAt);
    await q(
      `INSERT INTO incident_reporting_obligations
          (incident_id, client_id, obligation_type, due_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (incident_id, obligation_type) DO NOTHING`,
      [data.incidentId, clientId, type, dueBy],
    );
  }

  // Notification rows (only for submitted incidents).
  if (data.status === 'submitted' || data.status === 'acknowledged') {
    for (const role of getNotificationRoles(data.incidentType)) {
      const { rows: [staffRow] } = await q(
        `SELECT staff_id FROM staff WHERE client_id = $1 AND venue_id = $2 AND role_name = $3 AND deleted_at IS NULL LIMIT 1`,
        [clientId, venueId, role],
      );
      await q(
        `INSERT INTO incident_notifications
            (incident_id, client_id, notification_role, notified_staff_id, notification_method, sent_at)
         VALUES ($1, $2, $3, $4, 'in_app', $5)
         ON CONFLICT DO NOTHING`,
        [data.incidentId, clientId, role, staffRow?.staff_id || null, submittedAt],
      );
    }
  }
}

async function main() {
  const config = loadConfig();
  initDb(config);
  const clientId = DEMO_CLIENT_ID;
  const venueId  = DEMO_VENUE_ID;

  // Look up staff by email — ID-stable without hardcoding UUIDs.
  const staffId = await withClientContext(clientId, (q) =>
    q(`SELECT staff_id FROM staff WHERE email = 'gaming@steward.demo' AND client_id = $1 AND deleted_at IS NULL LIMIT 1`, [clientId])
      .then((r) => r.rows[0]?.staff_id || null),
  );
  const dutyManagerId = await withClientContext(clientId, (q) =>
    q(`SELECT staff_id FROM staff WHERE email = 'dutymanager@steward.demo' AND client_id = $1 AND deleted_at IS NULL LIMIT 1`, [clientId])
      .then((r) => r.rows[0]?.staff_id || null),
  );

  if (!staffId || !dutyManagerId) {
    console.log('[incident-seed] staff not found — run seed.js first. Skipping.');
    return;
  }

  // Idempotency: skip if today's incidents already seeded.
  const tomorrow = new Date(`${BASE_DATE}T00:00:00+10:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const alreadySeeded = await withClientContext(clientId, (q) =>
    q(
      `SELECT 1 FROM incident_reports
        WHERE venue_id = $1 AND deleted_at IS NULL
          AND incident_at >= $2::timestamptz AND incident_at < $3::timestamptz LIMIT 1`,
      [venueId, `${BASE_DATE}T00:00:00+10:00`, tomorrow.toISOString()],
    ).then((r) => r.rowCount > 0),
  );
  if (alreadySeeded) {
    console.log(`[incident-seed] incidents for ${BASE_DATE} already seeded — skipping`);
    return;
  }

  // Three demo incidents anchored to today's demo shift.
  const DEMO_INCIDENTS = [
    {
      incidentId:           'b1000001-0000-4000-8000-000000000001',
      incidentType:         'intoxicated_patron_refused',
      incidentAt:           bne(0, 20, 15),
      locationInVenue:      'Main bar — eastern service station',
      description:          'Patron exhibited signs of intoxication: unsteady on feet, slurred speech, persistent aggressive demands for service. Service refused under RSA obligations.',
      immediateActionTaken: 'Service refused. Patron offered water. Explained venue RSA policy calmly. Patron left without incident. Duty manager verbally notified.',
      patronDescription:    'Male, approx. 35–45yo, dark blue polo shirt, jeans. No ID presented.',
      witnesses:            'Shift colleague Jake (bar staff) present.',
      status:               'submitted',
      submittedAt:          bne(0, 20, 25),
    },
    {
      incidentId:           'b1000002-0000-4000-8000-000000000002',
      incidentType:         'self_exclusion_breach',
      incidentAt:           bne(0, 21, 40),
      locationInVenue:      'Gaming floor — machine row C',
      description:          'Gaming attendant identified patron playing EGM-22 who is registered on the QRGSS voluntary self-exclusion scheme. Venue photo register confirmed match.',
      immediateActionTaken: 'Patron politely asked to cease play and escorted from gaming floor. Patron did not dispute the exclusion. Duty manager and CLO notified. Gaming machine session terminated at the time of identification.',
      patronDescription:    'Female, approx. 50–60yo, grey jacket, reading glasses. Match to scheme photo register confirmed.',
      witnesses:            'CLO on duty (Maria Thornton) attended.',
      policeCalled:         false,
      status:               'submitted',
      submittedAt:          bne(0, 21, 55),
    },
    {
      incidentId:           'b1000003-0000-4000-8000-000000000003',
      incidentType:         'serious_assault',
      incidentAt:           bne(0, 22, 30),
      locationInVenue:      'Beer garden — rear seating area',
      description:          'Physical altercation between two patron groups. One patron sustained a visible laceration to the face. Security intervened immediately and separated parties.',
      immediateActionTaken: 'Security called immediately. Parties separated. QPS called — event number QPS-2026-05-4471. Scene preserved. CCTV footage flagged for preservation (camera CAM-07, 22:28–22:38). Ambulance declined by injured patron who left with companions.',
      patronDescription:    'Group A: three males, 20–30yo, one in black hoodie. Group B: two males, similar age range. Names unknown — parties left before police arrived.',
      witnesses:            'Security officer Dan Burke and bar staff on duty.',
      policeCalled:         true,
      policeReference:      'QPS-2026-05-4471',
      status:               'submitted',
      submittedAt:          bne(0, 22, 45),
    },
  ];

  await withClientContext(clientId, async (q) => {
    for (const incident of DEMO_INCIDENTS) {
      await seedIncident(q, clientId, venueId, staffId, dutyManagerId, incident);
      console.log(`[incident-seed] seeded: ${INCIDENT_TYPE_LABELS[incident.incidentType]} (${incident.status})`);
    }
  });

  console.log('[incident-seed] done — 3 demo incidents seeded');
}

main()
  .catch((err) => {
    console.error('[incident-seed] failed:', err.message);
    process.exit(0); // non-fatal at boot
  })
  .finally(() => closeDb());
