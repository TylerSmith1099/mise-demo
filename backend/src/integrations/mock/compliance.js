/**
 * Mock Compliance dataset — The Steward Hotel (demo, FICTIONAL).
 * MIS-185.
 *
 * The certification registers are DERIVED from src/integrations/mock/workforce.js
 * (the single source of truth), so the compliance view can never disagree with
 * the workforce view on who is expired/lapsed/missing. The venue-level status,
 * the live inspection scenario, and the responsible-gambling register are
 * defined here.
 *
 * Dates flow through the same live-anchored helpers used by workforce.js.
 */

import { STAFF, monthsFromNow, daysFromNow, isoDate } from './workforce.js';

const NOW = new Date();
function daysBetween(isoTarget) {
  const target = new Date(`${isoTarget}T00:00:00`);
  return Math.round((target - NOW) / 86_400_000);
}

// A deterministic certificate number per staff/type — stable across calls.
function certNo(prefix, externalId) {
  return `${prefix}-${externalId.replace('STW-', '')}`;
}

/** Classify a cert expiry into the demo's severity bands. */
function classify(expiry) {
  if (expiry === '__MISSING__') return { status: 'missing', severity: 'gap' };
  if (!expiry) return { status: 'not_held', severity: 'none' };
  const d = daysBetween(expiry);
  if (d < 0) return { status: 'expired', severity: 'critical', daysAgo: -d };
  if (d <= 30) return { status: 'expiring', severity: 'warning', daysLeft: d };
  return { status: 'current', severity: 'none' };
}

// ---------------------------------------------------------------------------
// RSA register — all 28 staff (those whose role carries an RSA value or gap).
// ---------------------------------------------------------------------------
export function getRsaRegister() {
  return STAFF
    .filter((p) => p.certifications.rsa !== null)
    .map((p) => {
      const c = classify(p.certifications.rsa);
      return {
        externalStaffId: p.externalStaffId,
        name: p.fullName,
        role: p.role,
        certNumber: c.status === 'missing' ? null : certNo('RSA', p.externalStaffId),
        issueDate: c.status === 'missing' ? null : monthsBefore(p.certifications.rsa, 36),
        expiryDate: c.status === 'missing' ? null : p.certifications.rsa,
        ...c,
      };
    });
}

// ---------------------------------------------------------------------------
// RG register — gaming attendants + duty managers.
// ---------------------------------------------------------------------------
export function getRgRegister() {
  return STAFF
    .filter((p) => p.certifications.rg !== null)
    .map((p) => {
      const c = classify(p.certifications.rg);
      return {
        externalStaffId: p.externalStaffId,
        name: p.fullName,
        role: p.role,
        certNumber: certNo('RG', p.externalStaffId),
        issueDate: monthsBefore(p.certifications.rg, 36),
        expiryDate: p.certifications.rg,
        onGamingFloor: !!p.flags.floorArea,
        ...c,
      };
    });
}

// ---------------------------------------------------------------------------
// Food safety register — kitchen staff.
// ---------------------------------------------------------------------------
export function getFoodSafetyRegister() {
  return STAFF
    .filter((p) => p.certifications.foodSafety !== null)
    .map((p) => {
      const c = classify(p.certifications.foodSafety);
      return {
        externalStaffId: p.externalStaffId,
        name: p.fullName,
        role: p.role,
        certNumber: certNo('FS', p.externalStaffId),
        issueDate: monthsBefore(p.certifications.foodSafety, 24),
        expiryDate: p.certifications.foodSafety,
        ...c,
      };
    });
}

function monthsBefore(isoTarget, months) {
  const d = new Date(`${isoTarget}T00:00:00`);
  d.setMonth(d.getMonth() - months);
  return isoDate(d);
}

// ---------------------------------------------------------------------------
// Venue-level compliance status.
// ---------------------------------------------------------------------------
export function getVenueCompliance() {
  return {
    venue: 'The Steward Hotel',
    gamingMachineLicence: { status: 'green', expiry: monthsFromNow(14) },
    liquorLicence: {
      status: 'amber',
      expiry: monthsFromNow(5),
      note: 'Expires in 5 months — renewal process should already be underway.',
    },
    publicLiabilityInsurance: { status: 'green', expiry: monthsFromNow(9) },
    lastOlgrVisit: {
      date: monthsFromNow(-4),
      outcome: 'satisfactory',
      recommendations: 2,
      recommendationsResolved: 2,
    },
  };
}

// ---------------------------------------------------------------------------
// Active inspection scenario — inspector on site now (45 minutes ago).
// ---------------------------------------------------------------------------
export function getActiveInspection() {
  const arrived = new Date(NOW);
  arrived.setMinutes(arrived.getMinutes() - 45);
  return {
    inProgress: true,
    inspectorArrivedAt: arrived.toISOString(),
    arrivedMinutesAgo: 45,
    assessing: [
      'CCTV coverage map',
      'RSA register',
      'Responsible gambling signage',
      'Gaming machine clearance log',
      'Staff certification register',
    ],
    requested: ['RSA register', 'CCTV coverage log'],
    cctvCoverage: {
      percentCovered: 94,
      blindSpot: 'Gaming room near M038–M042 — pre-existing, noted in last audit.',
    },
    dutyManagerActionRequired: true,
  };
}

// ---------------------------------------------------------------------------
// Responsible gambling register.
// ---------------------------------------------------------------------------
export function getResponsibleGamblingRegister() {
  return {
    selfExclusions: { active: 3 },
    lastSignageAudit: {
      date: daysFromNow(-42), // 6 weeks ago
      cadence: 'monthly',
      overdue: true,
    },
    incidentLog30d: [
      { type: 'patron_welfare_check', count: 3, resolved: 2, open: 1,
        note: 'Open item: patron declined assistance, noted.' },
      { type: 'self_exclusion_breach_attempt', count: 1,
        note: 'Patron attempted entry, identified and removed. Documented.' },
      { type: 'formal_breaches_lodged', count: 0 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Active alerts, sorted by severity (critical → warning → gap → info).
// This is what /api/compliance/alerts serves for the demo and what Scene 3
// surfaces automatically on Duty Manager login.
// ---------------------------------------------------------------------------
const SEVERITY_RANK = { critical: 0, warning: 1, gap: 2, info: 3 };

export function getComplianceAlerts() {
  const alerts = [];

  // RG lapsed + on floor → the headline critical breach (Scene 3 #1).
  for (const r of getRgRegister()) {
    if (r.status === 'expired' && r.onGamingFloor) {
      alerts.push({
        id: `rg-lapsed-${r.externalStaffId}`,
        severity: 'critical',
        category: 'responsible_gambling',
        title: 'RG certification lapsed — staff on gaming floor',
        message:
          `${r.name} RG certification lapsed ${r.daysAgo} days ago. They are currently ` +
          `rostered on the gaming floor. Immediate action required — remove from gaming ` +
          `floor and arrange renewal.`,
        staffId: r.externalStaffId,
      });
    }
  }

  // Expired RSAs → critical (Scene 3 references "2 expired certificates").
  for (const r of getRsaRegister()) {
    if (r.status === 'expired') {
      alerts.push({
        id: `rsa-expired-${r.externalStaffId}`,
        severity: 'critical',
        category: 'rsa',
        title: 'RSA certificate expired',
        message: `${r.name} (${r.role}) — RSA expired ${r.daysAgo} day(s) ago. Cannot serve alcohol until renewed.`,
        staffId: r.externalStaffId,
      });
    }
  }

  // Inspection in progress (Scene 3 #2).
  const insp = getActiveInspection();
  if (insp.inProgress) {
    const expiredRsa = getRsaRegister().filter((r) => r.status === 'expired').length;
    alerts.push({
      id: 'inspection-in-progress',
      severity: 'critical',
      category: 'inspection',
      title: 'Compliance inspection in progress',
      message:
        `Compliance inspection in progress. Inspector has requested the RSA register and ` +
        `CCTV coverage log. ${expiredRsa} expired RSA certificate(s) will be visible. ` +
        `Duty Manager action required.`,
    });
  }

  // Liquor licence renewal (Scene 3 #3).
  const venue = getVenueCompliance();
  if (venue.liquorLicence.status === 'amber') {
    alerts.push({
      id: 'liquor-licence-renewal',
      severity: 'warning',
      category: 'licence',
      title: 'Liquor licence renewal due',
      message:
        'Liquor licence renewal: 5 months remaining. Renewal process should be underway.',
    });
  }

  // Expiring RSA (warning).
  for (const r of getRsaRegister()) {
    if (r.status === 'expiring') {
      alerts.push({
        id: `rsa-expiring-${r.externalStaffId}`,
        severity: 'warning',
        category: 'rsa',
        title: 'RSA expiring soon',
        message: `${r.name} (${r.role}) — RSA expires in ${r.daysLeft} days.`,
        staffId: r.externalStaffId,
      });
    }
  }

  // Expired food safety (warning).
  for (const r of getFoodSafetyRegister()) {
    if (r.status === 'expired') {
      alerts.push({
        id: `foodsafety-expired-${r.externalStaffId}`,
        severity: 'warning',
        category: 'food_safety',
        title: 'Food safety certificate expired',
        message: `${r.name} (${r.role}) — food safety certificate expired ${r.daysAgo} day(s) ago.`,
        staffId: r.externalStaffId,
      });
    }
  }

  // Missing RSA on file (gap).
  for (const r of getRsaRegister()) {
    if (r.status === 'missing') {
      alerts.push({
        id: `rsa-missing-${r.externalStaffId}`,
        severity: 'gap',
        category: 'rsa',
        title: 'No RSA on file',
        message: `${r.name} (${r.role}) — role requires an RSA but none is on file.`,
        staffId: r.externalStaffId,
      });
    }
  }

  // Signage audit overdue (gap).
  const rg = getResponsibleGamblingRegister();
  if (rg.lastSignageAudit.overdue) {
    alerts.push({
      id: 'signage-audit-overdue',
      severity: 'gap',
      category: 'responsible_gambling',
      title: 'Responsible gambling signage audit overdue',
      message: 'Monthly responsible gambling signage audit is overdue (last completed 6 weeks ago).',
    });
  }

  return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Full certification register across all three cert types. */
export function getFullRegister() {
  return {
    venue: 'The Steward Hotel',
    rsa: getRsaRegister(),
    rg: getRgRegister(),
    foodSafety: getFoodSafetyRegister(),
    venueCompliance: getVenueCompliance(),
    responsibleGambling: getResponsibleGamblingRegister(),
    activeInspection: getActiveInspection(),
  };
}
