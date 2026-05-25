// incident-matrix.js — Incident type → obligation + notification routing.
//
// Source of truth: Incident-Report-Matrix-V1.md (MIS-378), validated by R&D (MIS-377).
// Key corrections from R&D are embedded here — do NOT revert without a spec update.
//
// confirmLegal obligations are NOT auto-routed to external agencies. The UI renders
// them as "review required — speak to your Compliance Officer before external
// lodgement." They appear in the obligation list but fulfilled_at stays null until
// a Compliance Officer manually clears them.
//
// LEGAL GATES (do not expose in build until clearance received):
//   medical_emergency: first-aid fields and guidance are gated on MIS-379.
//   austrac_smr: SMR fields visible to Compliance Officer role only (tipping-off rule).

export const MEDICAL_FIRST_AID_GATE = false; // flip to true when MIS-379 Legal clearance lands

// Severity labels used in the UI.
export const SEVERITY_LABELS = {
  1: 'L1 — Routine',
  2: 'L2 — Elevated',
  3: 'L3 — High',
  4: 'L4 — Critical',
};

export const SEVERITY_COLOURS = {
  1: '#4b5563', // muted grey
  2: '#b88c3a', // gold
  3: '#d97706', // amber
  4: '#dc2626', // red
};

// Obligation display labels for the UI.
export const OBLIGATION_LABELS = {
  in_house:            'In-House Record',
  olgr_notifiable:     'OLGR — Inspectable Record',
  austrac_ttr:         'AUSTRAC — Threshold Transaction Report (TTR)',
  austrac_smr:         'AUSTRAC — Suspicious Matter Report (SMR)',
  worksafe_notifiable: 'WHSQ — Notifiable Incident Check',
  police_notifiable:   'Police — 000 / Policelink 131 444',
};

// Due-by offsets (days) for each obligation type, measured from submission.
// Null = no fixed deadline (in-house records have no external filing window).
export const OBLIGATION_DUE_DAYS = {
  in_house:            null,
  olgr_notifiable:     null,   // timeframe is licence-specific; Compliance Officer decides
  austrac_ttr:         10,     // 10 business days from transaction date
  austrac_smr:         3,      // 3 business days (terrorism financing: 1 day)
  worksafe_notifiable: 0,      // immediately / same day for notifiable incidents
  police_notifiable:   0,      // immediate
};

// Notification role labels.
export const NOTIFICATION_ROLE_LABELS = {
  venue_manager:       'Venue Manager',
  area_manager:        'Area Manager',
  group_ops:           'Group Operations',
  compliance_officer:  'Compliance Officer',
  ceo:                 'CEO / Group',
};

/**
 * The routing matrix.
 *
 * Each entry:
 *   severityLevel     — 1..4
 *   obligations       — obligation_type[] (auto-created on submission)
 *   confirmLegal      — obligation_type[] (shown as review-required; NOT auto-routed)
 *   notifications     — notification_role[] (fired on submission / L4 on triage classification)
 *   policeFirst       — true if the immediate action is 000/police (not an OLGR window)
 *   medicalGate       — true if first-aid content is Legal-gated (MIS-379)
 *   conditionalFields — string[] keys for the conditional add-on field blocks to render
 */
const MATRIX = {
  intoxicated_patron_refused: {
    severityLevel: 1,
    obligations:    ['in_house'],
    confirmLegal:   [],
    notifications:  [],
    policeFirst:    false,
    medicalGate:    false,
    conditionalFields: [],
  },
  patron_asked_to_leave_complied: {
    severityLevel: 1,
    obligations:    ['in_house'],
    confirmLegal:   [],
    notifications:  [],
    policeFirst:    false,
    medicalGate:    false,
    conditionalFields: [],
  },
  patron_asked_to_leave_refused: {
    severityLevel: 2,
    obligations:    ['in_house'],
    confirmLegal:   ['police_notifiable'],       // Consider: trespass (not certain)
    notifications:  ['venue_manager'],
    policeFirst:    false,
    medicalGate:    false,
    conditionalFields: ['police'],
  },
  self_exclusion_breach: {
    severityLevel: 2,
    obligations:    ['in_house', 'olgr_notifiable'],  // record-and-act is certain
    confirmLegal:   [],                               // positive OLGR notification = confirm-legal handled by confirmLegalOlgr flag
    notifications:  ['venue_manager', 'compliance_officer'],
    policeFirst:    false,
    medicalGate:    false,
    conditionalFields: ['gaming'],
    confirmLegalOlgr: true,  // positive notification channel is [Confirm-Legal]; record is certain
  },
  cash_threshold_10k: {
    severityLevel: 2,
    obligations:    ['in_house', 'austrac_ttr'],
    confirmLegal:   [],
    notifications:  ['venue_manager', 'compliance_officer'],
    policeFirst:    false,
    medicalGate:    false,
    conditionalFields: ['austrac'],
  },
  suspicious_transaction: {
    severityLevel: 2,
    obligations:    ['in_house', 'austrac_smr'],
    confirmLegal:   ['police_notifiable'],        // Consider police
    notifications:  ['venue_manager', 'compliance_officer'],
    policeFirst:    false,
    medicalGate:    false,
    conditionalFields: ['austrac'],
  },
  workplace_injury_staff: {
    severityLevel: 2,
    obligations:    ['in_house', 'worksafe_notifiable'],
    confirmLegal:   [],
    notifications:  ['venue_manager'],
    policeFirst:    false,
    medicalGate:    false,
    conditionalFields: ['whs'],
  },
  serious_assault: {
    severityLevel: 3,
    obligations:    ['in_house', 'police_notifiable'],
    confirmLegal:   ['olgr_notifiable'],          // Police-primary; OLGR downstream [Confirm-Legal]
    notifications:  ['venue_manager', 'area_manager', 'group_ops', 'compliance_officer'],
    policeFirst:    true,
    medicalGate:    false,
    conditionalFields: ['police'],
  },
  medical_emergency: {
    severityLevel: 3,
    obligations:    ['in_house'],
    confirmLegal:   [],
    notifications:  ['venue_manager', 'area_manager'],
    policeFirst:    false,
    medicalGate:    true,                          // First-aid content gated: MIS-379
    conditionalFields: [],                         // medical add-on blocked until MIS-379
  },
  threat_extortion: {
    severityLevel: 3,
    obligations:    ['in_house', 'police_notifiable'],
    confirmLegal:   ['olgr_notifiable'],           // [Confirm-Legal: organised-crime nexus]
    notifications:  ['venue_manager', 'area_manager', 'group_ops'],
    policeFirst:    true,
    medicalGate:    false,
    conditionalFields: ['police'],
  },
  armed_robbery: {
    severityLevel: 4,
    obligations:    ['in_house', 'police_notifiable'],
    confirmLegal:   ['olgr_notifiable'],           // Police-primary [Confirm-Legal]
    notifications:  ['venue_manager', 'area_manager', 'group_ops', 'compliance_officer', 'ceo'],
    policeFirst:    true,
    medicalGate:    false,
    conditionalFields: ['police'],
  },
  death_on_premises: {
    severityLevel: 4,
    obligations:    ['in_house', 'police_notifiable'],
    confirmLegal:   ['olgr_notifiable'],           // Police-primary [Confirm-Legal]
    notifications:  ['venue_manager', 'area_manager', 'group_ops', 'compliance_officer', 'ceo'],
    policeFirst:    true,
    medicalGate:    false,
    conditionalFields: ['police'],
  },
};

/**
 * Returns the routing entry for a given incident type.
 * Throws for unknown types — the CHECK constraint in migration 019 prevents
 * unknown values reaching here, but defensive.
 */
export function getRouting(incidentType) {
  const entry = MATRIX[incidentType];
  if (!entry) throw new Error(`Unknown incident type: ${incidentType}`);
  return entry;
}

/**
 * Returns obligation_type[] that should be created in incident_reporting_obligations
 * on submission. Combines confirmed + confirm-legal obligations — the UI differentiates
 * them but they are all recorded in the DB.
 */
export function getObligationTypes(incidentType) {
  const { obligations, confirmLegal } = getRouting(incidentType);
  return [...obligations, ...confirmLegal];
}

/**
 * Returns notification_role[] that should fire on incident submission.
 */
export function getNotificationRoles(incidentType) {
  return getRouting(incidentType).notifications;
}

/**
 * Calculates due_by for an obligation type, based on submission timestamp.
 * Returns null when there is no fixed external deadline.
 */
export function calcDueBy(obligationType, submittedAt) {
  const days = OBLIGATION_DUE_DAYS[obligationType];
  if (days === null || days === undefined) return null;
  if (days === 0) return submittedAt;
  const due = new Date(submittedAt);
  due.setDate(due.getDate() + days);
  return due.toISOString();
}

/**
 * Returns true when this obligation is a [Confirm-Legal] cell — the UI must
 * render it as "review required — speak to your Compliance Officer."
 */
export function isConfirmLegal(incidentType, obligationType) {
  const { confirmLegal } = getRouting(incidentType);
  return confirmLegal.includes(obligationType);
}

/**
 * Returns a plain human-readable label for an incident type.
 */
export const INCIDENT_TYPE_LABELS = {
  intoxicated_patron_refused:       'Intoxicated Patron — Service Refused',
  patron_asked_to_leave_complied:   'Patron Asked to Leave — Complied',
  patron_asked_to_leave_refused:    'Patron Asked to Leave — Refused',
  serious_assault:                  'Serious Assault on Premises',
  death_on_premises:                'Death on Premises',
  medical_emergency:                'Medical Emergency',
  self_exclusion_breach:            'Self-Exclusion Breach',
  cash_threshold_10k:               'Cash Threshold Transaction ($10k+)',
  suspicious_transaction:           'Suspicious Transaction / AML Trigger',
  armed_robbery:                    'Armed Robbery',
  threat_extortion:                 'Threat / Extortion',
  workplace_injury_staff:           'Workplace Injury (Staff)',
};

export { MATRIX };
