# Incident Type → Fields → Obligations → Routing Matrix

**Schema:** migrations/019_incident_reports.sql + 020_incident_reports_rls.sql  
**Status:** LOCKED — validated against R&D obligations matrix ([MIS-377](/MIS/issues/MIS-377)) and Head of Product spec ([MIS-378](/MIS/issues/MIS-378))  
**Regulatory basis:** Liquor Act 1992 (QLD) · Gaming Machine Act 1991 (QLD) · WHS Act 2011 (QLD) · AML/CTF Act 2006 (Cth) · RG Code of Practice (QLD)

> **Critical corrections applied from R&D validation (2026-05-25):**
> QLD does NOT impose a distinct "report to OLGR within X hours" clock for assault/death/robbery. The action for crimes is **police-primary** (000); OLGR's interest is downstream (licence suitability, audit). Do not render OLGR as an auto-report for these incidents. `olgr_notifiable` obligation is reserved for gaming/self-exclusion-specific recording duties. See sections below for [Confirm-Legal] cells.

---

## Severity Levels

| Level | Label     | Escalation trigger |
|-------|-----------|--------------------|
| L1    | info      | Internal log only |
| L2    | warning   | → Venue Manager on submission |
| L3    | critical  | → Venue Manager + Area Manager/Group Ops |
| L4    | emergency | → Venue Manager + Area Manager/Group Ops + CEO; mandatory external reporting |

OLGR-notifiable or Austrac-notifiable incidents also route → **Compliance Officer** regardless of level.

---

## Reporting Obligation Types

| `obligation_type` | Meaning |
|-------------------|---------|
| `in_house` | Internal incident register — always created |
| `police_notifiable` | QPS contact required (000 or Policelink 131 444) |
| `olgr_notifiable` | OLGR inspectable record / RG Code recording duty (gaming/self-exclusion only — NOT for crimes) |
| `austrac_ttr` | Threshold Transaction Report ($10k+ cash, AUSTRAC Online, ≤10 business days) |
| `austrac_smr` | Suspicious Matter Report (3 business days for money laundering; 24 hours for terrorism financing — tipping-off rules apply) |
| `worksafe_notifiable` | Notifiable incident to Workplace Health and Safety Queensland (WHS Act 2011 QLD) |

**NOTE:** For serious assault, death, robbery, and threat/extortion — the police obligation (`police_notifiable`) is the active external duty. OLGR's downstream interest is licence-suitability and audit-based, not a direct reporting clock. The app must NOT label these as "auto-report to OLGR" — this would be an inaccurate claim. [Confirm-Legal] cells below require venue licence conditions to be confirmed before asserting a positive OLGR notification duty.

---

## Incident Type Matrix

### 1. `intoxicated_patron_refused` — RSA service refusal

| Attribute | Value |
|-----------|-------|
| Default severity | L1 |
| Triage pre-pop fields | patron_description, description (signs observed), immediate_action_taken, witnesses |
| Additional required fields | location_in_venue, incident_at, reported_by_staff_id, duty_manager_notified_at |
| Regulatory obligations | `in_house` only |
| Notification routing | — (DM notified via duty_manager_notified_at) |
| Legal basis | Liquor Act 1992 QLD — incident register |
| Notes | Every refusal must be logged same shift. Pre-populated from RSA triage flow. |

---

### 2. `patron_asked_to_leave_complied` — Patron left after request

| Attribute | Value |
|-----------|-------|
| Default severity | L1 |
| Triage pre-pop fields | patron_description, description, immediate_action_taken |
| Additional required fields | location_in_venue, incident_at |
| Regulatory obligations | `in_house` only |
| Notification routing | — |
| Notes | Log how patron left (walked/taxi/escorted) and time of departure. |

---

### 3. `patron_asked_to_leave_refused` — Patron refused to leave

| Attribute | Value |
|-----------|-------|
| Default severity | L2 |
| Triage pre-pop fields | patron_description, description, immediate_action_taken |
| Additional required fields | location_in_venue, incident_at, duty_manager_notified_at, duty_manager_staff_id |
| Conditional upgrade | → L3 if police called |
| Regulatory obligations | `in_house`; `police_notifiable` if refusal escalates to trespass/disorder |
| Notification routing | L2 → Venue Manager |
| Notes | **Corrected (R&D):** NOT an OLGR trigger. If escalation requires police, this is a trespass/disorder matter — `police_notifiable` flag applies, not OLGR. |

---

### 4. `serious_assault` — Assault on premises

| Attribute | Value |
|-----------|-------|
| Default severity | L3 |
| Triage pre-pop fields | patron_description, description, immediate_action_taken, injuries_or_damage |
| Additional required fields | location_in_venue, incident_at, police_called (Y), police_reference, duty_manager_notified_at |
| Regulatory obligations | `in_house`, `police_notifiable` |
| Notification routing | L3 → Venue Manager + Area Manager/Group Ops + Compliance Officer |
| Legal basis | Liquor Act 1992 QLD — assault must be reported to police (000) |
| Notes | **Corrected (R&D):** OLGR is NOT a direct report here — police-primary; OLGR downstream (licence suitability). Preserve CCTV. police_reference mandatory if police responded. |

---

### 5. `death_on_premises` — Death on premises

| Attribute | Value |
|-----------|-------|
| Default severity | L4 |
| Triage pre-pop fields | description, immediate_action_taken |
| Additional required fields | location_in_venue, incident_at, police_called (Y), ambulance_called (Y), police_reference, duty_manager_notified_at |
| Regulatory obligations | `in_house`, `police_notifiable`, `worksafe_notifiable` |
| Notification routing | L4 → Venue Manager + Area Manager/Group Ops + Compliance Officer + CEO |
| WorkSafe due_by | Immediately by phone; written notification ≤48 h |
| Legal basis | WHS Act 2011 QLD Pt 3 (notifiable incident); Liquor Act 1992 QLD |
| Notes | **Corrected (R&D):** OLGR is NOT a direct clock — police + coroner primary; OLGR downstream. Scene preservation required until WorkSafe clearance. Do not disturb without instruction. |

---

### 6. `medical_emergency` — Medical emergency (non-death)

| Attribute | Value |
|-----------|-------|
| Default severity | L2 (L4 if fatal → reclassify to `death_on_premises`) |
| Triage pre-pop fields | description, immediate_action_taken, injuries_or_damage |
| Additional required fields | location_in_venue, incident_at, ambulance_called, duty_manager_notified_at |
| Conditional upgrade | → L3 + `worksafe_notifiable` if hospitalisation results (WHS Act 2011 QLD serious injury criteria) |
| Regulatory obligations | `in_house`; `worksafe_notifiable` if serious injury or hospitalisation |
| Notification routing | L2 → Venue Manager; L3 → + Area Manager/Group Ops |
| Notes | **Corrected (R&D):** OLGR is NOT applicable. The obligation is 000 ambulance. Police only if crime/death involved. First-aid content is Legal-gated (MIS-395). |

---

### 7. `self_exclusion_breach` — Self-exclusion patron sighted/served

| Attribute | Value |
|-----------|-------|
| Default severity | L2 |
| Triage pre-pop fields | patron_description, description, immediate_action_taken |
| Additional required fields | location_in_venue, incident_at, duty_manager_notified_at |
| Regulatory obligations | `in_house`, `olgr_notifiable` (RG Code recording + action duty) |
| Notification routing | L2 → Venue Manager + Compliance Officer |
| Legal basis | Gaming Machine Act 1991 QLD; RG Code of Practice (QLD) |
| Notes | **Nuance (R&D):** RG Code recording/action duty is ✓. Whether a *positive OLGR notification* is owed (vs. inspectable record) is licence/Code-specific — marked [Confirm-Legal]. Managed by Customer Liaison Officer. Document whether patron was served before identification and action taken. |

---

### 8. `cash_threshold_10k` — Cash transaction ≥ $10,000

| Attribute | Value |
|-----------|-------|
| Default severity | L3 |
| Triage pre-pop fields | description (transaction details), immediate_action_taken |
| Additional required fields | location_in_venue, incident_at, patron_name (if identified) |
| Regulatory obligations | `in_house`, `austrac_ttr` |
| austrac_ttr due_by | 10 business days from transaction date |
| Notification routing | L3 → Venue Manager + Area Manager/Group Ops + Compliance Officer |
| Legal basis | AML/CTF Act 2006 (Cth) s43 — Threshold Transaction Report |
| Notes | TTR lodged via AUSTRAC Online. Compliance Officer owns fulfillment. |

---

### 9. `suspicious_transaction` — Suspicious matter (AML/CTF)

| Attribute | Value |
|-----------|-------|
| Default severity | L3 |
| Triage pre-pop fields | description (suspicious behaviour/transaction details), immediate_action_taken |
| Additional required fields | location_in_venue, incident_at |
| Regulatory obligations | `in_house`, `austrac_smr` |
| austrac_smr due_by | **3 business days** from when suspicion forms (money laundering); **24 hours** if terrorism financing suspected |
| Notification routing | L3 → Venue Manager + Area Manager/Group Ops + Compliance Officer |
| Legal basis | AML/CTF Act 2006 (Cth) s41 — Suspicious Matter Report |
| Notes | **Corrected (R&D):** due_by is 3 days / 24h TF — not "as soon as practicable". SMR content is confidential — **tipping-off is a criminal offence** (do not disclose to patron or third parties). Compliance Officer lodges via AUSTRAC Online. |

---

### 10. `armed_robbery` — Armed robbery

| Attribute | Value |
|-----------|-------|
| Default severity | L4 |
| Triage pre-pop fields | description, immediate_action_taken |
| Additional required fields | location_in_venue, incident_at, police_called (Y), police_reference, duty_manager_notified_at |
| Regulatory obligations | `in_house`, `police_notifiable` |
| Notification routing | L4 → Venue Manager + Area Manager/Group Ops + Compliance Officer + CEO |
| Legal basis | Liquor Act 1992 QLD — serious incident; police (000) |
| Notes | **Corrected (R&D):** OLGR is NOT a direct report — police-primary; OLGR downstream. Staff safety first — comply, do not resist. Preserve CCTV. If worker injured, flag `worksafe_notifiable` check. Detailed staff welfare check required. |

---

### 11. `threat_extortion` — Threat or extortion

| Attribute | Value |
|-----------|-------|
| Default severity | L3 |
| Triage pre-pop fields | description, immediate_action_taken |
| Additional required fields | location_in_venue, incident_at, duty_manager_notified_at |
| Conditional upgrade | → L4 if credible/imminent threat to life |
| Regulatory obligations | `in_house`; `police_notifiable` if credible threat (000 or Policelink 131 444) |
| Notification routing | L3 → Venue Manager + Area Manager/Group Ops; L4 → + CEO |
| Notes | **Corrected (R&D):** OLGR interest only where organised-crime/standover nexus affects licence suitability [Confirm-Legal]. Police-primary. Document exact wording; preserve communications/CCTV. |

---

### 12. `workplace_injury_staff` — Staff workplace injury

| Attribute | Value |
|-----------|-------|
| Default severity | L2 (L4 if death or notifiable serious injury) |
| Triage pre-pop fields | description, injuries_or_damage, immediate_action_taken |
| Additional required fields | location_in_venue, incident_at, reported_by_staff_id, duty_manager_notified_at |
| Conditional upgrade | → L4 + `worksafe_notifiable` if death, hospitalisation, or WHS Act 2011 QLD Pt 3 notifiable criteria met |
| Regulatory obligations | `in_house`; `worksafe_notifiable` if notifiable incident under WHS Act 2011 QLD |
| WorkSafe due_by | Immediately by phone if notifiable; written ≤48 h |
| Notification routing | L2 → Venue Manager; L4 → + Area Manager/Group Ops + CEO |
| Legal basis | WHS Act 2011 QLD Pt 3; Workers' Compensation and Rehabilitation Act 2003 (QLD) |
| Notes | **Added (R&D):** WHS column was missing from original brief. Serious worker injury = notifiable incident to Workplace Health and Safety Queensland under WHS Act 2011. Scene preservation required; workers' comp process also applies. |

---

## Reporting Obligation Due-By Reference

| Obligation type       | Statutory deadline | Legal source |
|-----------------------|--------------------|--------------|
| `worksafe_notifiable` | Immediately (phone); written ≤48 h | WHS Act 2011 QLD s38 |
| `austrac_ttr`         | ≤10 business days from transaction | AML/CTF Act 2006 (Cth) s43 |
| `austrac_smr`         | ≤3 business days (money laundering); ≤24 h (terrorism financing) | AML/CTF Act 2006 (Cth) s41 |
| `police_notifiable`   | Immediately for safety; assault/robbery 000; non-urgent Policelink 131 444 | Liquor Act 1992 QLD |
| `olgr_notifiable`     | RG Code recording same shift; positive notification duty [Confirm-Legal] | Gaming Machine Act 1991 QLD; RG Code |
| `in_house`            | Same shift (log before end of shift) | Internal SOP |

---

## Pre-Population from Triage Answers

When an incident report is created from a triage conversation:

1. `triage_conversation_id` is set to the source conversation's UUID.
2. `triage_answers` JSONB receives a snapshot of the structured answers at pre-population time.
3. The application maps triage answer fields to report columns as follows:

| Triage answer key    | Maps to report column |
|----------------------|-----------------------|
| `incident_type`      | `incident_type` |
| `location`           | `location_in_venue` |
| `patron_description` | `patron_description` |
| `signs_observed`     | `description` (pre-populated text) |
| `action_taken`       | `immediate_action_taken` |
| `injuries_noted`     | `injuries_or_damage` |
| `police_called`      | `police_called` |
| `ambulance_called`   | `ambulance_called` |
| `witnesses`          | `witnesses` |

Staff must review pre-populated fields before submission. The `status` starts as `draft` regardless of pre-population.

---

## Combined Minimum Field Set (in-house + OLGR + AUSTRAC)

14 fields satisfy all three frameworks simultaneously (from R&D validation):

**Core (always):**
1. Report ID · 2. Date/time of incident + time reported · 3. Venue + location within premises · 4. Staff handling + staff reporting · 5. Incident type · 6. Persons involved (description; privacy-minimal) · 7. Factual description · 8. Observed signs (intoxication etc.) · 9. Action taken · 10. Outcome · 11. Witnesses · 12. Notifications made (who/when/event numbers) · 13. Follow-up required · 14. Submitted by/at (audit stamp)

**Conditional add-ons:**
- Police: event/reference number; evidence preserved; scene secured; CCTV location.
- Medical: 000 time; condition; first aid given; ambulance arrival.
- Gaming/OLGR: machine ID/meter; amounts; self-exclusion scheme + exclusion ID.
- AUSTRAC: transaction amount; cash in/out; ≥$10k TTR flag; suspicious indicators — compliance-channel only, tipping-off rules apply.
- WHS: injured worker; nature of injury; treatment; notifiable-incident flag.

**Privacy:** record only what each obligation needs (Privacy Act 1988 Cth / APP data minimisation). Patron PII and health information — capture minimally, store securely.

---

## Schema Reference

- **Migration 019:** `incident_reports`, `incident_reporting_obligations`, `incident_notifications`
- **Migration 020:** RLS policies for all three tables
- **RLS pattern:** `NULLIF(current_setting('app.current_client_id', true), '')::uuid` — secure default (NULL → zero rows visible)
- **Soft deletes:** `deleted_at` on `incident_reports`
- **[Confirm-Legal] cells:** self-exclusion positive OLGR notification duty; OLGR interest for crimes/threat — require venue licence conditions review before asserting in demo or live
