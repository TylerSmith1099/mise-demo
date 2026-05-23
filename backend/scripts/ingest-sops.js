// Ingest The Criterion Hotel's venue SOPs as CLIENT-scoped shared knowledge
// (clientId = Pinnacle Hotel Group). Original content authored for the demo —
// no copied employer materials. Run:
//
//   DB_CONNECTION_STRING=... node scripts/ingest-sops.js <pinnacleClientId>
//
// Each SOP is written under the client's RLS context, so it is retrievable only
// inside the Pinnacle partition, alongside the shared QLD legislation.

import { initDb, closeDb } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';

const SOPS = [
  {
    source: 'Criterion SOP — Cash Management',
    idPrefix: 'criterion-sop-cash',
    text: `# Cash Management Procedure

## Float and till setup
Each till is issued a counted float at shift start. The duty manager and the operator both verify the float and sign the float sheet. Discrepancies are reported before the till is used.

## Cash drops
When a till exceeds the agreed holding limit, perform a cash drop to the secure drop safe witnessed by a second staff member. Record the drop time, amount, and both names.

## Gaming cash handling
Gaming payouts above the manual-pay threshold require duty manager authorisation and two signatures. Never pay a jackpot from a gaming float without completing the jackpot record first.

## End of shift reconciliation
Count the till blind against the system figure. Variances over the tolerance are escalated to the duty manager and noted in the handover. All cash is returned to the safe; nothing is left in an unattended till.`,
  },
  {
    source: 'Criterion SOP — Opening and Closing',
    idPrefix: 'criterion-sop-open-close',
    text: `# Opening and Closing Procedure

## Opening
1. Disarm and log entry. Walk the floor and check for overnight issues.
2. Confirm gaming room locks, EGM door seals, and CCTV are operational.
3. Set tills and floats. Confirm minimum staff certifications for the shift.
4. Switch on gaming machines only once a certified gaming attendant is on the floor.

## Closing
1. Last drinks and gaming shutdown per licensed hours. Do not serve past licensed time.
2. Sweep the gaming room; confirm no patron remains. Suspend and lock machines.
3. Reconcile tills, complete cash drops, secure the safe.
4. Arm, log exit, and record the closing time and any incidents in the handover.`,
  },
  {
    source: 'Criterion SOP — Gaming Floor Procedures',
    idPrefix: 'criterion-sop-gaming-floor',
    text: `# Gaming Floor Procedures

## Minimum staffing
The gaming floor must have at least the venue minimum of certified gaming attendants on the floor whenever machines are in play. The Criterion minimum is 2 attendants for its 45 machines. If staffing falls below the minimum, restrict or suspend gaming until cover is restored.

## EGM malfunction
1. If a machine shows an error or alarm that does not clear, take it out of play.
2. Place an Out of Service card on the machine.
3. Log the fault: time, machine number, alarm type, attendant name.
4. Notify the duty manager. Do not open the machine — that is for the gaming technician.

## Jackpot processing
1. Confirm the win on the machine display and the jackpot system.
2. A second staff member and the duty manager witness the payout.
3. Complete the jackpot record before paying. Capture machine number, amount, time, and signatures.
4. If the jackpot system is unresponsive, hold the payout and escalate to the duty manager — never estimate a payout.`,
  },
  {
    source: 'Criterion SOP — Responsible Service of Alcohol',
    idPrefix: 'criterion-sop-rsa',
    text: `# Responsible Service of Alcohol (RSA) Procedure

## Signs to monitor
Watch for slurred speech, loss of coordination, aggression, and rapid consumption. Service decisions are based on observed behaviour, not on a drink count alone.

## Refusing service
Refuse calmly and without judgement. Offer water and, where appropriate, assistance with transport. Do not argue. If the patron becomes aggressive, step back and call the duty manager or security.

## After a refusal
Document the refusal: time, description, what was said, and any follow-up. A refusal with no follow-up note is an open compliance item the duty manager must close before end of shift.

## Escalation
Any refusal involving a minor, an intoxicated driver, or a threat is escalated to the duty manager immediately and may require a call to police.`,
  },
  {
    source: 'Criterion SOP — Responsible Gambling Patron Interaction',
    idPrefix: 'criterion-sop-rg-interaction',
    text: `# Responsible Gambling Patron Interaction

## When an interaction is required
A patron interaction is mandatory when a patron shows signs of distress or potential harm, or has been in extended continuous play. Extended play alone is a prompt to check wellbeing.

## How to approach
Approach calmly and privately. Ask after the patron's wellbeing, offer a break and water, and make information about support services available. Do not accuse or lecture.

## Self-exclusion
If a patron identifies as self-excluded, do not confront them at the machine. Take them aside, confirm against the exclusion register, and notify the duty manager immediately. An excluded patron must not continue to play — the venue is liable.

## Documentation
Record every interaction: time, machine, what was observed, what was offered, and the outcome. Log it as a compliance event so it can be reviewed and acknowledged.`,
  },
  {
    source: 'Criterion SOP — Incident Reporting',
    idPrefix: 'criterion-sop-incident',
    text: `# Incident Reporting Procedure

## What to report
Report every incident affecting compliance, safety, or patrons: RSA refusals, responsible-gambling interactions, EGM malfunctions, injuries, aggression, theft, and exclusion breaches.

## How to log
Create a compliance event at the time of the incident with: event type, severity, a plain-language description, the staff member involved, and the time. Critical events require immediate duty manager notification.

## Acknowledgement and follow-up
Open events must be acknowledged by the duty manager. Events that need an outcome (for example an RSA refusal) stay open until a follow-up note is added. Nothing is deleted — the log is the audit trail.

## Handover
Open and unresolved incidents are carried into the shift handover so the incoming duty manager can action them.`,
  },
];

async function main() {
  const clientId = process.argv[2];
  if (!clientId) throw new Error('usage: node scripts/ingest-sops.js <clientId>');
  const cs = process.env.DB_CONNECTION_STRING;
  if (!cs) throw new Error('DB_CONNECTION_STRING is required');
  initDb({ db: { connectionString: cs, appRole: process.env.DB_APP_ROLE || 'mise_app' } });

  let total = 0;
  for (const sop of SOPS) {
    const res = await ingestDocument({
      source: sop.source,
      text: sop.text,
      clientId,
      venueState: 'QLD',
      lastUpdated: '2026-05-01',
      idPrefix: sop.idPrefix,
      flags: ['demo SOP — original content authored for The Criterion Hotel'],
    });
    total += res.chunkCount;
    console.log(`  - ${res.source}: ${res.chunkCount} chunks`);
  }
  console.log(`ingested ${SOPS.length} SOPs, ${total} chunks (client ${clientId})`);
  await closeDb();
}

main().catch(async (err) => {
  console.error('SOP ingestion failed:', err.message);
  try { await closeDb(); } catch {}
  process.exit(1);
});
