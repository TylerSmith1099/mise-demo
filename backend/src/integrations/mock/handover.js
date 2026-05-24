/**
 * Demo handover aggregation — The Steward Hotel (demo, FICTIONAL). MIS-201.
 *
 * The Duty Manager's "Walk me through tonight's handover" surface (Scene 2)
 * needs a STRUCTURED prior-shift handover. The relational handover_notes table
 * is only populated for real clients; the demo tenant's operational truth lives
 * in the mock adapters (workforce / pos / compliance), so /api/handover returned
 * 404 (no_handover_note) on the demo and Scene 2 showed the error state.
 *
 * This builder aggregates the SAME mock sources the rest of the demo reads from
 * — getCurrentShift (sick-call + RG-on-floor gaps), getGamingMachines (clearance),
 * getCashManagement (cash-up), getActiveInspection (live inspection), and the RG
 * register — into the shape the Handover.jsx component expects:
 *
 *   { fromRole, toRole, shiftDate, author,
 *     openComplianceItems[], staffingNotes, incidentsSummary, actionItems[] }
 *
 * Every figure is derived from the live-anchored mock data (never hardcoded), so
 * "2.5h ago" / "lapsed 3 days ago" / inspector arrival time stay true whenever
 * the demo runs. There is no client data here — the demo tenant is synthetic.
 */

import { getCurrentShift } from './workforce.js';
import { getGamingMachines, getCashManagement } from './pos.js';
import { getActiveInspection, getVenueCompliance, getRgRegister } from './compliance.js';

// "M036","M037",…,"M042" -> "M036–M042". Falls back to a comma list if the ids
// are not a clean contiguous run.
function machineRange(ids = []) {
  if (!ids.length) return null;
  const first = ids[0];
  const last = ids[ids.length - 1];
  return first === last ? first : `${first}–${last}`;
}

function fmtTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Brisbane',
  });
}

/**
 * Build the structured demo handover from the mock adapters. Returns the exact
 * shape /api/handover (and Handover.jsx) consume.
 */
export function getDemoHandover() {
  const shift = getCurrentShift();
  const machines = getGamingMachines();
  const cash = getCashManagement();
  const inspection = getActiveInspection();
  const venue = getVenueCompliance();

  const sickGap = shift.gaps.find((g) => g.type === 'sick_call_unfilled');
  const rgGap = shift.gaps.find((g) => g.type === 'rg_lapsed_on_floor');

  // RG cert gaps on floor staff (the structural breach) — from the RG register.
  const rgOnFloorExpired = getRgRegister().filter(
    (r) => r.status === 'expired' && r.onGamingFloor,
  );

  const amber = machines.summary.clearanceAmber || [];
  const amberRange = machineRange(amber);
  const amberOverdue = machines.machines.find((m) => m.clearance.state === 'amber')
    ?.clearance.overdueHours;

  const inspectorArrived = fmtTime(inspection.inspectorArrivedAt);
  const inspectionRequested = (inspection.requested || []).join(' and ');

  // ---- Open compliance items (the must-watch list) ------------------------
  const openComplianceItems = [];
  for (const r of rgOnFloorExpired) {
    openComplianceItems.push(
      `${r.name} (Gaming Attendant) — RG certification expired ${r.expiryDate} but rostered ` +
        `on the gaming floor. Remove from the floor until renewed.`,
    );
  }
  if (inspection.inProgress) {
    openComplianceItems.push(
      `Compliance inspection in progress since ${inspectorArrived} ` +
        `(${inspection.arrivedMinutesAgo}+ min) — inspector has requested the ${inspectionRequested}.`,
    );
  }
  if (amberRange) {
    openComplianceItems.push(
      `Gaming machine clearance overdue — ${amberRange} amber` +
        (amberOverdue ? ` (${amberOverdue}h since last clearance).` : '.'),
    );
  }
  if (cash.lastCashUp?.overdue) {
    openComplianceItems.push(`Cash-up overdue — ${cash.lastCashUp.note}`);
  }
  if (venue.liquorLicence?.status === 'amber') {
    openComplianceItems.push(
      `Liquor licence renewal due — amber, expires ${venue.liquorLicence.expiry}.`,
    );
  }

  // ---- Staffing -----------------------------------------------------------
  const staffingBits = [];
  if (sickGap) staffingBits.push(sickGap.detail);
  if (rgGap) staffingBits.push(rgGap.detail);
  staffingBits.push(
    `${shift.rosteredCount} rostered on tonight (${shift.dayOfWeek} ${shift.shiftStart}–${shift.shiftEnd}).`,
  );
  const staffingNotes = staffingBits.join(' ');

  // ---- Incidents ----------------------------------------------------------
  const incidentBits = [];
  if (inspection.inProgress) {
    incidentBits.push(
      `OLGR-style compliance inspection in progress — inspector on site since ${inspectorArrived} ` +
        `(${inspection.arrivedMinutesAgo}+ min), has requested the ${inspectionRequested}.`,
    );
  }
  if (cash.lastCashUp?.overdue) incidentBits.push(cash.lastCashUp.note);
  if (amberRange) {
    incidentBits.push(
      `Gaming machines ${amberRange} clearance overdue (amber${amberOverdue ? `, ${amberOverdue}h` : ''}).`,
    );
  }
  const incidentsSummary = incidentBits.join(' ');

  // ---- Recommended actions ------------------------------------------------
  const actionItems = [];
  for (const r of rgOnFloorExpired) {
    actionItems.push(`Pull ${r.name} off the gaming floor until their RG certification is renewed.`);
  }
  if (sickGap) actionItems.push(`Roster a replacement for the unfilled bar sick-call before the ${shift.dayOfWeek} peak.`);
  if (cash.lastCashUp?.overdue) actionItems.push('Complete the overdue cash-up.');
  if (amberRange) actionItems.push(`Clear gaming machines ${amberRange} (clearance overdue).`);
  if (inspection.inProgress) {
    actionItems.push(`Have the ${inspectionRequested} ready for the inspector on site.`);
  }

  return {
    fromRole: 'Afternoon Duty Manager',
    toRole: 'Evening Duty Manager',
    shiftDate: shift.shiftDate,
    author: 'Afternoon Duty Manager',
    openComplianceItems,
    staffingNotes,
    incidentsSummary,
    actionItems,
  };
}
