/**
 * Normalised internal signal shapes.
 *
 * Every connector translates vendor-specific payloads into these shapes before
 * handing data to downstream consumers (MIS-44 compliance monitor, award
 * reasoning, shift handover). Swapping one vendor for another must not change
 * what a consumer receives.
 *
 * Shapes are plain objects — no classes. Constructors validate the minimum
 * required fields and freeze the result so consumers cannot mutate it.
 */

/**
 * A single rostered shift from any scheduling vendor.
 *
 * @typedef {Object} RosteredShift
 * @property {string}  id              — connector-scoped unique id (vendor:externalId)
 * @property {string}  venueId         — Mise venue UUID
 * @property {string}  staffId         — Mise staff UUID (may be null if unmatched)
 * @property {string}  externalStaffId — vendor staff identifier
 * @property {string}  role            — normalised role slug: 'gaming_attendant' | 'duty_manager' | 'bar' | 'kitchen' | 'other'
 * @property {string}  startUtc        — ISO 8601 UTC
 * @property {string}  endUtc          — ISO 8601 UTC
 * @property {string}  status          — 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
 * @property {string}  source          — vendor slug, e.g. 'deputy'
 * @property {string}  syncedAt        — ISO 8601 UTC — when this record was fetched
 * @property {boolean} isStale         — true when this record comes from last-known/seeded fallback
 */

/**
 * @param {object} fields
 * @returns {RosteredShift}
 */
export function makeRosteredShift(fields) {
  const required = ['id', 'venueId', 'externalStaffId', 'role', 'startUtc', 'endUtc', 'source'];
  for (const key of required) {
    if (fields[key] == null || fields[key] === '') {
      throw new Error(`makeRosteredShift: missing required field "${key}"`);
    }
  }

  const VALID_ROLES = new Set(['gaming_attendant', 'duty_manager', 'bar', 'kitchen', 'other']);
  const VALID_STATUSES = new Set(['scheduled', 'in_progress', 'completed', 'cancelled']);

  return Object.freeze({
    id:              String(fields.id),
    venueId:         fields.venueId ? String(fields.venueId) : null,
    staffId:         fields.staffId ? String(fields.staffId) : null,
    externalStaffId: String(fields.externalStaffId),
    role:            VALID_ROLES.has(fields.role) ? fields.role : 'other',
    startUtc:        String(fields.startUtc),
    endUtc:          String(fields.endUtc),
    status:          VALID_STATUSES.has(fields.status) ? fields.status : 'scheduled',
    source:          String(fields.source),
    syncedAt:        fields.syncedAt || new Date().toISOString(),
    isStale:         Boolean(fields.isStale),
    _type:           'RosteredShift',
  });
}

/**
 * A payroll/timesheet record from any payroll vendor.
 *
 * @typedef {Object} TimesheetEntry
 * @property {string}  id
 * @property {string}  venueId
 * @property {string}  staffId         — Mise staff UUID (may be null if unmatched)
 * @property {string}  externalStaffId
 * @property {string}  periodStartUtc
 * @property {string}  periodEndUtc
 * @property {number}  hoursWorked
 * @property {string}  payCategory     — 'ordinary' | 'overtime' | 'penalty' | 'allowance' | 'other'
 * @property {string}  source
 * @property {string}  syncedAt
 * @property {boolean} isStale
 */

/**
 * @param {object} fields
 * @returns {TimesheetEntry}
 */
export function makeTimesheetEntry(fields) {
  const required = ['id', 'externalStaffId', 'periodStartUtc', 'periodEndUtc', 'source'];
  for (const key of required) {
    if (fields[key] == null || fields[key] === '') {
      throw new Error(`makeTimesheetEntry: missing required field "${key}"`);
    }
  }

  const VALID_CATEGORIES = new Set(['ordinary', 'overtime', 'penalty', 'allowance', 'other']);

  return Object.freeze({
    id:              String(fields.id),
    venueId:         fields.venueId ? String(fields.venueId) : null,
    staffId:         fields.staffId ? String(fields.staffId) : null,
    externalStaffId: String(fields.externalStaffId),
    periodStartUtc:  String(fields.periodStartUtc),
    periodEndUtc:    String(fields.periodEndUtc),
    hoursWorked:     typeof fields.hoursWorked === 'number' ? fields.hoursWorked : 0,
    payCategory:     VALID_CATEGORIES.has(fields.payCategory) ? fields.payCategory : 'other',
    source:          String(fields.source),
    syncedAt:        fields.syncedAt || new Date().toISOString(),
    isStale:         Boolean(fields.isStale),
    _type:           'TimesheetEntry',
  });
}

/**
 * An award-interpreted pay rate record from any payroll vendor.
 *
 * Used as a penalty-rate oracle and verification source for Mise's own award
 * reasoning: Mise can check its conclusions against an authoritative payroll
 * engine (e.g. KeyPay) rather than reasoning purely from first principles.
 *
 * @typedef {Object} PayRate
 * @property {string}      id                 — connector-scoped unique id (vendor:businessId:payrate:externalId)
 * @property {string}      connectionId       — integration_connections UUID
 * @property {string|null} venueId            — Mise venue UUID (null if not yet matched)
 * @property {string}      externalBusinessId — vendor's business/company identifier
 * @property {string|null} externalEmployeeId — vendor employee id; null = applies to all employees
 * @property {string|null} awardCode          — Fair Work award code, e.g. 'MA000003'
 * @property {string|null} awardName          — Human-readable award name
 * @property {string}      employmentType     — 'full_time' | 'part_time' | 'casual' | 'other'
 * @property {string}      rateType           — 'ordinary' | 'penalty' | 'overtime' | 'allowance' | 'other'
 * @property {string}      rateName           — Vendor label, e.g. 'Casual Bar Attendant - Saturday Penalty'
 * @property {number|null} rateMultiplier     — e.g. 1.5 for time-and-a-half; null if not expressed as multiplier
 * @property {number|null} rateAmount         — Hourly rate in AUD; null if amount not directly exposed
 * @property {string|null} effectiveFrom      — ISO 8601 date string; null if not provided
 * @property {string}      source             — vendor slug, e.g. 'keypay'
 * @property {string}      syncedAt           — ISO 8601 UTC fetch timestamp
 * @property {boolean}     isStale            — true when sourced from last-known fallback
 */

/**
 * @param {object} fields
 * @returns {PayRate}
 */
export function makePayRate(fields) {
  const required = ['id', 'connectionId', 'externalBusinessId', 'rateName', 'source'];
  for (const key of required) {
    if (fields[key] == null || fields[key] === '') {
      throw new Error(`makePayRate: missing required field "${key}"`);
    }
  }

  return Object.freeze({
    id:                 String(fields.id),
    connectionId:       String(fields.connectionId),
    venueId:            fields.venueId            ? String(fields.venueId)            : null,
    externalBusinessId: String(fields.externalBusinessId),
    externalEmployeeId: fields.externalEmployeeId ? String(fields.externalEmployeeId) : null,
    awardCode:          fields.awardCode          ? String(fields.awardCode)          : null,
    awardName:          fields.awardName          ? String(fields.awardName)          : null,
    employmentType:     _normaliseEmploymentType(fields.employmentType),
    rateType:           _normaliseRateType(fields.rateType),
    rateName:           String(fields.rateName),
    rateMultiplier:     typeof fields.rateMultiplier === 'number' ? fields.rateMultiplier : null,
    rateAmount:         typeof fields.rateAmount   === 'number'   ? fields.rateAmount     : null,
    effectiveFrom:      fields.effectiveFrom       ? String(fields.effectiveFrom)      : null,
    source:             String(fields.source),
    syncedAt:           fields.syncedAt || new Date().toISOString(),
    isStale:            Boolean(fields.isStale),
    _type:              'PayRate',
  });
}

/**
 * Staffing snapshot — what the compliance monitor (MIS-44) and shift handover
 * consume. A single point-in-time view of who is rostered vs. present for a
 * venue, with minimum staffing context.
 *
 * @typedef {Object} StaffingSnapshot
 * @property {string}   connectionId
 * @property {string}   venueId
 * @property {string}   asOfUtc         — ISO 8601 UTC — snapshot time
 * @property {RosteredShift[]} rostered  — all shifts covering asOfUtc
 * @property {number}   gamingAttendantCount
 * @property {number}   dutyManagerCount
 * @property {number}   totalCount
 * @property {boolean}  isStale
 * @property {string|null} staleReason
 * @property {string}   source
 */

/**
 * @param {object} fields
 * @returns {StaffingSnapshot}
 */
export function makeStaffingSnapshot(fields) {
  const required = ['connectionId', 'venueId', 'asOfUtc', 'source'];
  for (const key of required) {
    if (fields[key] == null || fields[key] === '') {
      throw new Error(`makeStaffingSnapshot: missing required field "${key}"`);
    }
  }

  const rostered = Array.isArray(fields.rostered) ? fields.rostered : [];

  return Object.freeze({
    connectionId:          String(fields.connectionId),
    venueId:               String(fields.venueId),
    asOfUtc:               String(fields.asOfUtc),
    rostered:              Object.freeze(rostered),
    gamingAttendantCount:  typeof fields.gamingAttendantCount === 'number'
                              ? fields.gamingAttendantCount
                              : rostered.filter(s => s.role === 'gaming_attendant').length,
    dutyManagerCount:      typeof fields.dutyManagerCount === 'number'
                              ? fields.dutyManagerCount
                              : rostered.filter(s => s.role === 'duty_manager').length,
    totalCount:            typeof fields.totalCount === 'number'
                              ? fields.totalCount
                              : rostered.length,
    isStale:               Boolean(fields.isStale),
    staleReason:           fields.staleReason || null,
    source:                String(fields.source),
    _type:                 'StaffingSnapshot',
  });
}

// ---------------------------------------------------------------------------
// Internal normalizers used by makePayRate.
// Accept any vendor string and map to the stable internal slug.
// ---------------------------------------------------------------------------

function _normaliseEmploymentType(raw) {
  if (!raw) return 'other';
  const s = String(raw).toLowerCase();
  if (s.includes('casual'))                           return 'casual';
  if (s.includes('part'))                             return 'part_time';
  if (s.includes('full') || s.includes('permanent')) return 'full_time';
  return 'other';
}

function _normaliseRateType(raw) {
  if (!raw) return 'other';
  const s = String(raw).toLowerCase();
  if (s.includes('penalty'))                              return 'penalty';
  if (s.includes('overtime') || s.includes('over time')) return 'overtime';
  if (s.includes('allowance'))                            return 'allowance';
  if (s.includes('ordinary') || s.includes('base') || s.includes('standard')) return 'ordinary';
  return 'other';
}

// ---------------------------------------------------------------------------
// RevenueSignal — POS daily revenue record (BEPOZ / H&L / SwiftPOS)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} RevenueSignal
 * @property {string}  id            — connector-scoped unique id (vendor:venueId:businessDate)
 * @property {string}  venueId       — Mise venue UUID
 * @property {string}  businessDate  — venue-local trading date (YYYY-MM-DD)
 * @property {number}  grossCents    — gross revenue in integer cents (never float)
 * @property {number}  netCents      — net revenue in integer cents
 * @property {number}  txnCount      — transaction count
 * @property {string}  source        — vendor slug: 'bepoz' | 'hl' | 'swiftpos' | 'manual' | 'seed'
 * @property {string}  syncedAt      — ISO 8601 UTC
 * @property {boolean} isStale
 */

/**
 * @param {object} fields
 * @returns {RevenueSignal}
 */
export function makeRevenueSignal(fields) {
  const required = ['id', 'venueId', 'businessDate', 'source'];
  for (const key of required) {
    if (fields[key] == null || fields[key] === '') {
      throw new Error(`makeRevenueSignal: missing required field "${key}"`);
    }
  }

  const VALID_SOURCES = new Set(['bepoz', 'hl', 'swiftpos', 'manual', 'seed']);

  return Object.freeze({
    id:           String(fields.id),
    venueId:      String(fields.venueId),
    businessDate: String(fields.businessDate),
    grossCents:   Number.isFinite(fields.grossCents) ? Math.round(fields.grossCents) : 0,
    netCents:     Number.isFinite(fields.netCents)   ? Math.round(fields.netCents)   : 0,
    txnCount:     Number.isFinite(fields.txnCount)   ? Math.round(fields.txnCount)   : 0,
    source:       VALID_SOURCES.has(fields.source) ? fields.source : 'manual',
    syncedAt:     fields.syncedAt || new Date().toISOString(),
    isStale:      Boolean(fields.isStale),
    _type:        'RevenueSignal',
  });
}
