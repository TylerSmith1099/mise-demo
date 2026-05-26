/**
 * RSATriage — Three-phase RSA response architecture (MIS-389).
 *
 * Phase 1 — Situation Triage: 5 quick-select questions, no typing required.
 *   Q1 multi-select signs → Q2–Q5 single-select (auto-advance on tap).
 *   Medical triggers in Q1 → onMedicalGate callback, triage exits.
 *   Q4=aggressive → supervisor check prompt (non-blocking) before Q5.
 *
 * Phase 2 — Situational Coaching: dynamically generated from triage answers.
 *   Format calibrated to severity (L1 coaching / L2 guided / L3 action mode).
 *   Severity never shown to staff. Source attribution once at bottom.
 *
 * Phase 3 — Incident Report: pre-populated, surfaced after coaching.
 *   Staff complete outcome field only; all other fields filled from triage.
 *
 * Props:
 *   session       {object}    from /api/session — venue name, staff name.
 *   onDismiss     {function}  close the overlay.
 *   onMedicalGate {function}  called when medical L4 triggers in Q1.
 *   onAuthError   {function}  called on 401 from the coaching API.
 */
import React, { useState, useCallback, useRef } from 'react';
import { sendRSACoaching, submitRSAReport } from '../api.js';

// ---------------------------------------------------------------------------
// Brand tokens — Deep Meridian system.
// ---------------------------------------------------------------------------
const C = {
  charcoal:    'var(--charcoal, #1c1c1e)',
  gold:        'var(--gold, #b8863a)',
  goldBg:      'rgba(184,134,58,0.10)',
  goldBorder:  'rgba(184,134,58,0.35)',
  cream:       'var(--cream, #f5f0e8)',
  cream60:     'var(--cream-60, rgba(245,240,232,0.6))',
  cream20:     'rgba(245,240,232,0.20)',
  amber:       '#d97706',
  amberBg:     'rgba(217,119,6,0.08)',
  amberBorder: 'rgba(217,119,6,0.35)',
  red:         '#dc2626',
  redBg:       'rgba(220,38,38,0.08)',
  redBorder:   'rgba(220,38,38,0.35)',
  surface:     'rgba(255,255,255,0.04)',
  border:      'rgba(245,240,232,0.12)',
};
const serif = "'Space Grotesk', system-ui, sans-serif";
const slab  = "'Plus Jakarta Sans', system-ui, sans-serif";
const mono  = "'IBM Plex Mono', monospace";
const sans  = "'DM Sans', system-ui, sans-serif";

// ---------------------------------------------------------------------------
// Triage question definitions.
// ---------------------------------------------------------------------------
const TRIAGE_QUESTIONS = [
  {
    id: 'q1',
    hint: 'Signs observed',
    question: 'What have you noticed about them?',
    multiSelect: true,
    options: [
      { value: 'slurred-speech',    label: 'Slurred speech' },
      { value: 'unsteady',          label: 'Unsteady / losing balance' },
      { value: 'aggressive-voice',  label: 'Aggressive or raising voice' },
      { value: 'glassy-eyes',       label: 'Eyes glassy or unfocused' },
      { value: 'repeating',         label: 'Repeating themselves' },
      { value: 'confused',          label: 'Seems confused or disoriented' },
      { value: 'not-responding',    label: 'Not responding normally', medicalTrigger: true },
      { value: 'physically-unwell', label: 'Looks physically unwell (pale, sweating, struggling to breathe)', medicalTrigger: true },
    ],
  },
  {
    id: 'q2',
    hint: 'Time on premises',
    question: 'How long have they been here?',
    multiSelect: false,
    options: [
      { value: 'under-1h', label: 'Under 1 hour' },
      { value: '1-2h',     label: '1–2 hours' },
      { value: '3h-plus',  label: '3+ hours' },
      { value: 'unknown',  label: 'Unknown' },
    ],
  },
  {
    id: 'q3',
    hint: 'Do you know this person?',
    question: 'Are they a regular?',
    multiSelect: false,
    options: [
      { value: 'yes-known', label: 'Yes, I know them' },
      { value: 'no',        label: 'No' },
      { value: 'not-sure',  label: 'Not sure' },
    ],
  },
  {
    id: 'q4',
    hint: 'Current behaviour',
    question: 'What are they doing right now?',
    multiSelect: false,
    options: [
      { value: 'quiet-affected',         label: 'Quiet but clearly affected' },
      { value: 'becoming-disruptive',    label: 'Becoming disruptive (louder, persistent, demanding)' },
      { value: 'aggressive-threatening', label: 'Aggressive or threatening' },
      { value: 'refusing-engage',        label: 'Refusing to engage or acknowledge me' },
    ],
  },
  {
    id: 'q5',
    hint: 'Who else is involved?',
    question: 'Who are they with?',
    multiSelect: false,
    options: [
      { value: 'solo',           label: 'Just them — solo patron' },
      { value: 'group-sober',    label: 'With a group — others seem sober' },
      { value: 'group-affected', label: 'With a group — all seem affected' },
      { value: 'one-other',      label: 'With one other person' },
    ],
  },
];

const MEDICAL_TRIGGERS = new Set(['not-responding', 'physically-unwell']);

// Client-side severity classification — mirrors rsa-api.js.
function classifySeverity(answers) {
  const q1 = Array.isArray(answers.q1) ? answers.q1 : [];
  if (q1.some((s) => MEDICAL_TRIGGERS.has(s))) return 'L4_MEDICAL';
  if (answers.q4 === 'aggressive-threatening') return 'L3';
  let l2 = 0;
  if (q1.length >= 3) l2++;
  if (answers.q2 === '3h-plus') l2++;
  if (answers.q4 === 'becoming-disruptive') l2++;
  if (answers.q5 === 'group-affected') l2++;
  if (answers.q3 === 'yes-known' && q1.length >= 2) l2++;
  return l2 >= 2 ? 'L2' : 'L1';
}

// ---------------------------------------------------------------------------
// Shared UI primitives.
// ---------------------------------------------------------------------------
function Label({ text, style }) {
  return (
    <p style={{
      margin: '0 0 6px',
      fontFamily: mono,
      fontSize: 10,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: C.cream60,
      ...style,
    }}>
      {text}
    </p>
  );
}

function Card({ children, accent, style }) {
  const borders = { gold: C.goldBorder, amber: C.amberBorder, red: C.redBorder };
  const bgs     = { gold: C.goldBg,     amber: C.amberBg,     red: C.redBg };
  return (
    <div style={{
      padding: '14px 16px',
      background: bgs[accent] || C.surface,
      border: `1px solid ${borders[accent] || C.border}`,
      borderRadius: 12,
      ...style,
    }}>
      {children}
    </div>
  );
}

function OptionButton({ label, selected, onClick, multiSelect }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        width: '100%',
        padding: '13px 16px',
        textAlign: 'left',
        background: selected ? C.goldBg : C.surface,
        border: `1px solid ${selected ? C.goldBorder : C.border}`,
        borderRadius: 10,
        fontFamily: sans, fontSize: 15,
        color: selected ? C.cream : C.cream60,
        cursor: 'pointer',
        minHeight: 48,
        lineHeight: 1.4,
        transition: 'background 0.12s, border-color 0.12s, color 0.12s',
      }}
    >
      <span style={{
        width: 20, height: 20, flexShrink: 0, marginTop: 1,
        border: `2px solid ${selected ? C.gold : 'rgba(245,240,232,0.3)'}`,
        borderRadius: multiSelect ? 4 : '50%',
        background: selected ? C.gold : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.12s, border-color 0.12s',
      }}>
        {selected && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4l2.5 2.5L9 1" stroke={C.charcoal} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Phase 1 — Triage question card.
// onTap(value): for multi-select toggles selection; for single-select advances.
// onContinue(): multi-select Q1 explicit advance.
// ---------------------------------------------------------------------------
function TriageQuestion({ q, currentValue, onTap, onContinue }) {
  const isMulti = q.multiSelect;
  const selected = isMulti
    ? (Array.isArray(currentValue) ? currentValue : [])
    : currentValue;

  const hasSelection = isMulti
    ? (Array.isArray(selected) && selected.length > 0)
    : Boolean(selected);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px 24px' }}>
      <div style={{ marginBottom: 4 }}>
        <p style={{ margin: '0 0 4px', fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.cream60 }}>
          {q.hint}
        </p>
        <h2 style={{ margin: 0, fontFamily: serif, fontSize: 22, fontWeight: 700, color: C.cream, lineHeight: 1.3 }}>
          {q.question}
        </h2>
        {isMulti && (
          <p style={{ margin: '6px 0 0', fontFamily: sans, fontSize: 13, color: C.cream60 }}>
            Select all that apply
          </p>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {q.options.map((opt) => {
          const isSelected = isMulti
            ? selected.includes(opt.value)
            : selected === opt.value;
          return (
            <OptionButton
              key={opt.value}
              label={opt.label}
              selected={isSelected}
              multiSelect={isMulti}
              onClick={() => onTap(opt.value)}
            />
          );
        })}
      </div>

      {isMulti && (
        <button
          onClick={onContinue}
          disabled={!hasSelection}
          style={{
            marginTop: 4,
            width: '100%', padding: '14px 16px',
            background: hasSelection ? C.goldBg : 'transparent',
            border: `1px solid ${hasSelection ? C.goldBorder : C.border}`,
            borderRadius: 10,
            fontFamily: sans, fontSize: 15, fontWeight: 600,
            color: hasSelection ? C.cream : C.cream20,
            cursor: hasSelection ? 'pointer' : 'default',
            minHeight: 48,
          }}
        >
          Continue →
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supervisor check (non-blocking, Q4=aggressive).
// ---------------------------------------------------------------------------
function SupervisorCheck({ onAnswer }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 16px 24px' }}>
      <Card accent="amber">
        <p style={{ margin: '0 0 8px', fontFamily: sans, fontSize: 15, fontWeight: 600, color: C.cream }}>
          Have you let your supervisor know?
        </p>
        <p style={{ margin: 0, fontFamily: sans, fontSize: 13, color: C.cream60, lineHeight: 1.5 }}>
          This will be logged in your incident report. You can continue either way.
        </p>
      </Card>
      <button
        onClick={() => onAnswer('yes')}
        style={{
          width: '100%', padding: '14px 16px',
          background: C.goldBg, border: `1px solid ${C.goldBorder}`,
          borderRadius: 10, fontFamily: sans, fontSize: 15, fontWeight: 600,
          color: C.cream, cursor: 'pointer', minHeight: 48,
        }}
      >
        Yes — supervisor is aware
      </button>
      <button
        onClick={() => onAnswer('not-yet')}
        style={{
          width: '100%', padding: '14px 16px',
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 10, fontFamily: sans, fontSize: 15, fontWeight: 600,
          color: C.cream60, cursor: 'pointer', minHeight: 48,
        }}
      >
        Not yet — show me the guidance
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading phase.
// ---------------------------------------------------------------------------
function LoadingView() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: '60px 32px',
    }}>
      <div style={{
        width: 40, height: 40,
        border: `2px solid rgba(184,134,58,0.3)`,
        borderTopColor: C.gold,
        borderRadius: '50%',
        animation: 'rsa-spin 0.8s linear infinite',
      }} />
      <p style={{ margin: 0, fontFamily: mono, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.cream60 }}>
        Building your guidance…
      </p>
      <style>{`@keyframes rsa-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 2 — Coaching display.
// ---------------------------------------------------------------------------
function CoachingView({ coaching, severity, sourceAttribution, hasError, onHandled }) {
  if (hasError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 16px 24px' }}>
        <Card accent="red">
          <p style={{ margin: 0, fontFamily: sans, fontSize: 14, color: C.cream60, lineHeight: 1.6 }}>
            Couldn't load guidance. Check your connection or speak with your supervisor.
          </p>
        </Card>
        <button
          onClick={onHandled}
          style={{
            width: '100%', padding: '14px 16px',
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 10, fontFamily: sans, fontSize: 14,
            color: C.cream60, cursor: 'pointer', minHeight: 48,
          }}
        >
          Close
        </button>
      </div>
    );
  }

  if (!coaching) return <LoadingView />;

  const isL3 = severity === 'L3';
  const hasGroup = Boolean(coaching.splitSituation);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px 32px' }}>

      {/* L3: urgency header replaces normal approach */}
      {isL3 && (
        <Card accent="amber">
          <p style={{ margin: 0, fontFamily: sans, fontSize: 16, fontWeight: 700, color: C.amber, lineHeight: 1.4 }}>
            {coaching.approach}
          </p>
        </Card>
      )}

      {/* L1/L2: approach card */}
      {!isL3 && coaching.approach && (
        <Card>
          <Label text="How to approach" />
          <p style={{ margin: 0, fontFamily: sans, fontSize: 14, color: C.cream, lineHeight: 1.65 }}>
            {coaching.approach}
          </p>
        </Card>
      )}

      {/* What to say */}
      {coaching.whatToSay && coaching.whatToSay.filter(Boolean).length > 0 && (
        <Card accent="gold">
          <Label text="What to say" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {coaching.whatToSay.filter(Boolean).map((phrase, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 14px',
                  background: 'rgba(184,134,58,0.06)',
                  border: `1px solid ${C.goldBorder}`,
                  borderLeft: `3px solid ${C.gold}`,
                  borderRadius: 8,
                }}
              >
                <p style={{ margin: 0, fontFamily: slab, fontSize: 15, fontStyle: 'italic', color: C.cream, lineHeight: 1.55 }}>
                  "{phrase}"
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Split situation (group/pair only) */}
      {hasGroup && (
        <Card>
          <Label text="Handling the group" />
          <p style={{ margin: 0, fontFamily: sans, fontSize: 14, color: C.cream, lineHeight: 1.65 }}>
            {coaching.splitSituation}
          </p>
        </Card>
      )}

      {/* Escalation */}
      {coaching.escalation && (
        <Card accent={isL3 ? 'amber' : undefined}>
          <Label text={isL3 ? 'Steps' : 'Escalation path'} />
          <p style={{ margin: 0, fontFamily: sans, fontSize: 14, color: C.cream, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
            {coaching.escalation}
          </p>
        </Card>
      )}

      {/* What not to do */}
      {coaching.whatNotToDo && coaching.whatNotToDo.filter(Boolean).length > 0 && (
        <Card>
          <Label text="What not to do" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {coaching.whatNotToDo.filter(Boolean).map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ color: C.red, fontSize: 18, lineHeight: '1.2', flexShrink: 0 }}>×</span>
                <p style={{ margin: 0, fontFamily: sans, fontSize: 14, color: C.cream60, lineHeight: 1.55 }}>
                  {item}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Source attribution — once, at the bottom */}
      {sourceAttribution && (
        <p style={{
          margin: '4px 0 0', padding: '0 4px',
          fontFamily: sans, fontSize: 12, fontStyle: 'italic',
          color: C.cream60, lineHeight: 1.5,
        }}>
          {sourceAttribution}
        </p>
      )}

      {/* Handled CTA */}
      <button
        onClick={onHandled}
        style={{
          marginTop: 8,
          width: '100%', padding: '14px 16px',
          background: C.goldBg, border: `1px solid ${C.goldBorder}`,
          borderRadius: 12, fontFamily: sans, fontSize: 15, fontWeight: 600,
          color: C.cream, cursor: 'pointer', minHeight: 48,
        }}
      >
        Situation handled →
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empathy pause (L3/L4 only, before report).
// ---------------------------------------------------------------------------
function EmpathyPause({ onReady, onLater }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 16px 24px' }}>
      <Card accent="gold">
        <p style={{ margin: '0 0 10px', fontFamily: serif, fontSize: 22, fontWeight: 700, color: C.cream, lineHeight: 1.3 }}>
          That was a difficult situation.
        </p>
        <p style={{ margin: 0, fontFamily: sans, fontSize: 15, color: C.cream60, lineHeight: 1.6 }}>
          Take a breath — the hard part is over.
        </p>
      </Card>
      <p style={{ margin: 0, padding: '0 4px', fontFamily: sans, fontSize: 14, color: C.cream60, lineHeight: 1.55 }}>
        Your incident report is pre-filled and ready to review whenever you're ready.
      </p>
      <button
        onClick={onReady}
        style={{
          width: '100%', padding: '14px 16px',
          background: C.goldBg, border: `1px solid ${C.goldBorder}`,
          borderRadius: 10, fontFamily: sans, fontSize: 15, fontWeight: 600,
          color: C.cream, cursor: 'pointer', minHeight: 48,
        }}
      >
        Review my report
      </button>
      <button
        onClick={onLater}
        style={{
          width: '100%', padding: '14px 16px',
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 10, fontFamily: sans, fontSize: 14,
          color: C.cream60, cursor: 'pointer', minHeight: 48,
        }}
      >
        I need a minute — save draft
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 3 — Incident report.
// ---------------------------------------------------------------------------
const OUTCOME_OPTIONS = [
  { value: '',                       label: 'Select outcome…' },
  { value: 'refused-accepted',       label: 'Service refused — patron accepted' },
  { value: 'left-voluntarily',       label: 'Patron left voluntarily' },
  { value: 'asked-leave-complied',   label: 'Asked to leave — complied' },
  { value: 'asked-leave-refused',    label: 'Asked to leave — refused (trespass risk)' },
  { value: 'security-involved',      label: 'Security involved' },
  { value: 'police-called',          label: 'Police called' },
];

function ReportView({ reportTemplate, coachingSummary, session, onSubmit, onSaveDraft }) {
  const [outcome, setOutcome]       = useState('');
  const [location, setLocation]     = useState('');
  const [witness, setWitness]       = useState('');
  const [followUp, setFollowUp]     = useState(false);
  const [followUpNote, setFollowUpNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!outcome) return;
    setSubmitting(true);
    try {
      await onSubmit({ ...reportTemplate, location, outcome, witness, followUp, followUpNote, guidanceSummary: coachingSummary, staffName: session?.staffName });
    } finally {
      setSubmitting(false);
    }
  };

  const field = {
    display: 'block', width: '100%', padding: '10px 12px',
    background: 'rgba(255,255,255,0.05)',
    border: `1px solid ${C.border}`, borderRadius: 8,
    fontFamily: sans, fontSize: 14, color: C.cream,
    outline: 'none', boxSizing: 'border-box',
  };

  const prefilledRows = [
    ['Date / Time', new Date(reportTemplate.dateTime).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })],
    ['Venue',       session?.venueName     || '—'],
    ['Staff',       session?.staffName     || '—'],
    ['Incident',    reportTemplate.incidentType],
    ['Signs',       reportTemplate.observedSigns],
    ['Time on site',reportTemplate.timeOnPremises],
    ['Known regular', reportTemplate.knownRegular],
    ['Behaviour',   reportTemplate.currentBehaviour],
    ['Others',      reportTemplate.othersInvolved],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 16px 32px' }}>
      <Card accent="gold">
        <Label text="Incident Report" />
        <p style={{ margin: '2px 0 0', fontFamily: mono, fontSize: 13, color: C.cream, letterSpacing: '0.04em' }}>
          #{reportTemplate.reportId}
        </p>
      </Card>

      <Card>
        <Label text="Situation details — pre-filled from triage" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {prefilledRows.map(([key, val]) => (
            <div key={key} style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontFamily: mono, fontSize: 11, color: C.cream60, width: 90, flexShrink: 0, lineHeight: 1.55 }}>{key}</span>
              <span style={{ fontFamily: sans, fontSize: 13, color: C.cream, lineHeight: 1.55 }}>{val}</span>
            </div>
          ))}
        </div>
      </Card>

      {coachingSummary && (
        <Card>
          <Label text="Guidance given by Mise (system log — not editable)" />
          <p style={{ margin: 0, fontFamily: sans, fontSize: 13, color: C.cream60, lineHeight: 1.55, fontStyle: 'italic' }}>
            {coachingSummary}
          </p>
        </Card>
      )}

      {/* Location */}
      <div>
        <Label text="Location within venue (optional)" />
        <input type="text" placeholder="e.g. Gaming floor, Bar area" value={location} onChange={(e) => setLocation(e.target.value)} style={field} />
      </div>

      {/* Outcome — required */}
      <div>
        <Label text="Outcome *" />
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ ...field, color: outcome ? C.cream : C.cream60 }}>
          {OUTCOME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} style={{ background: '#1c1c1e', color: C.cream }}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Witness */}
      <div>
        <Label text="Witness name (optional)" />
        <input type="text" placeholder="Staff member who witnessed this" value={witness} onChange={(e) => setWitness(e.target.value)} style={field} />
      </div>

      {/* Follow-up toggle */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
          <div
            role="switch"
            aria-checked={followUp}
            onClick={() => setFollowUp((v) => !v)}
            style={{
              width: 44, height: 26, borderRadius: 13,
              background: followUp ? C.gold : 'rgba(255,255,255,0.12)',
              position: 'relative', flexShrink: 0,
              transition: 'background 0.2s', cursor: 'pointer',
            }}
          >
            <div style={{
              width: 20, height: 20, borderRadius: '50%', background: 'white',
              position: 'absolute', top: 3, left: followUp ? 21 : 3,
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </div>
          <span style={{ fontFamily: sans, fontSize: 14, color: C.cream60 }}>Follow-up required</span>
        </label>
        {followUp && (
          <input
            type="text"
            placeholder="What needs to be followed up"
            value={followUpNote}
            onChange={(e) => setFollowUpNote(e.target.value)}
            style={field}
          />
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!outcome || submitting}
        style={{
          marginTop: 4,
          width: '100%', padding: '14px 16px',
          background: outcome ? C.goldBg : 'transparent',
          border: `1px solid ${outcome ? C.goldBorder : C.border}`,
          borderRadius: 12, fontFamily: sans, fontSize: 15, fontWeight: 600,
          color: outcome ? C.cream : C.cream20,
          cursor: outcome ? 'pointer' : 'default', minHeight: 48,
        }}
      >
        {submitting ? 'Submitting…' : 'Submit report'}
      </button>
      <button
        onClick={onSaveDraft}
        style={{
          width: '100%', padding: '12px 16px',
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 10, fontFamily: sans, fontSize: 14,
          color: C.cream60, cursor: 'pointer', minHeight: 44,
        }}
      >
        Save draft
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submitted state.
// ---------------------------------------------------------------------------
function SubmittedView({ reportId, onClose }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '32px 24px', alignItems: 'center', textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: C.goldBg, border: `1px solid ${C.goldBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="24" height="20" viewBox="0 0 24 20" fill="none">
          <path d="M2 10l7 7L22 2" stroke={C.gold} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div>
        <h2 style={{ margin: '0 0 8px', fontFamily: serif, fontSize: 22, fontWeight: 700, color: C.cream }}>
          Report submitted
        </h2>
        <p style={{ margin: 0, fontFamily: sans, fontSize: 14, color: C.cream60, lineHeight: 1.6 }}>
          Report <span style={{ fontFamily: mono, color: C.cream }}>#{reportId}</span> has been logged.
          <br />Your venue manager has been notified.
        </p>
      </div>
      <button
        onClick={onClose}
        style={{
          width: '100%', padding: '14px 16px',
          background: C.goldBg, border: `1px solid ${C.goldBorder}`,
          borderRadius: 12, fontFamily: sans, fontSize: 15, fontWeight: 600,
          color: C.cream, cursor: 'pointer', minHeight: 48,
        }}
      >
        Done
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export.
// ---------------------------------------------------------------------------
export default function RSATriage({ session, onDismiss, onMedicalGate, onAuthError }) {
  const [phase, setPhase] = useState('triage');   // triage | supervisor_check | loading | coaching | empathy_pause | report | submitted
  const [qIdx, setQIdx]   = useState(0);
  const [answers, setAnswers] = useState({ q1: [], q2: '', q3: '', q4: '', q5: '' });
  const [coaching, setCoaching]               = useState(null);
  const [severity, setSeverity]               = useState(null);
  const [sourceAttribution, setSourceAttribution] = useState(null);
  const [reportTemplate, setReportTemplate]   = useState(null);
  const [hasError, setHasError]               = useState(false);
  const [submittedId, setSubmittedId]         = useState(null);
  const [supervisorAnswer, setSupervisorAnswer] = useState(null);
  const triageStartedAt = useRef(new Date().toISOString());
  const scrollRef       = useRef(null);

  const scrollTop = () => { if (scrollRef.current) scrollRef.current.scrollTop = 0; };

  // ---- Coaching fetch ------------------------------------------------------
  const fetchCoaching = useCallback(async (finalAnswers) => {
    setSeverity(classifySeverity(finalAnswers));
    setPhase('loading');
    scrollTop();
    try {
      const result = await sendRSACoaching({
        triageAnswers: finalAnswers,
        triageStartedAt: triageStartedAt.current,
      });
      setCoaching(result.coaching);
      setSeverity(result.severity || classifySeverity(finalAnswers));
      setSourceAttribution(result.sourceAttribution);
      setReportTemplate(result.reportTemplate);
      setPhase('coaching');
    } catch (err) {
      if (err.status === 401) { onAuthError?.(); return; }
      setHasError(true);
      setPhase('coaching');
    }
    scrollTop();
  }, [onAuthError]);

  // ---- Q1 multi-select continue --------------------------------------------
  const handleQ1Continue = useCallback(() => {
    const q1 = Array.isArray(answers.q1) ? answers.q1 : [];
    const hasMedical = q1.some((s) => MEDICAL_TRIGGERS.has(s));
    if (hasMedical) { onMedicalGate?.(); return; }
    setQIdx(1);
    scrollTop();
  }, [answers.q1, onMedicalGate]);

  // ---- Q1 multi-select toggle ----------------------------------------------
  const handleQ1Toggle = useCallback((value) => {
    setAnswers((prev) => {
      const arr = Array.isArray(prev.q1) ? prev.q1 : [];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...prev, q1: next };
    });
  }, []);

  // ---- Single-select handler (Q2–Q5) auto-advance -------------------------
  const handleSingleSelect = useCallback((qId, value) => {
    const newAnswers = { ...answers, [qId]: value };
    setAnswers(newAnswers);

    if (qId === 'q4' && value === 'aggressive-threatening') {
      // Show supervisor check before Q5
      setPhase('supervisor_check');
      scrollTop();
      return;
    }

    const nextIdx = qIdx + 1;
    if (nextIdx < TRIAGE_QUESTIONS.length) {
      setQIdx(nextIdx);
      scrollTop();
    } else {
      fetchCoaching(newAnswers);
    }
  }, [answers, qIdx, fetchCoaching]);

  // ---- Supervisor check answer --------------------------------------------
  const handleSupervisorCheck = useCallback((answer) => {
    setSupervisorAnswer(answer);
    setQIdx(4); // Q5
    setPhase('triage');
    scrollTop();
  }, []);

  // ---- Post-coaching CTA --------------------------------------------------
  const handleHandled = useCallback(() => {
    const sv = severity;
    if (sv === 'L3' || sv === 'L4') {
      setPhase('empathy_pause');
    } else {
      setPhase('report');
    }
    scrollTop();
  }, [severity]);

  // ---- Report submit -------------------------------------------------------
  const handleReportSubmit = useCallback(async (data) => {
    try {
      const res = await submitRSAReport(data);
      setSubmittedId(res.reportId);
      setPhase('submitted');
      scrollTop();
    } catch (err) {
      if (err.status === 401) onAuthError?.();
    }
  }, [onAuthError]);

  // ---- Back navigation -----------------------------------------------------
  const handleBack = useCallback(() => {
    if (phase === 'supervisor_check') { setPhase('triage'); setQIdx(3); scrollTop(); return; }
    if (phase === 'loading' || phase === 'coaching') { setPhase('triage'); setQIdx(TRIAGE_QUESTIONS.length - 1); scrollTop(); return; }
    if (phase === 'empathy_pause' || phase === 'report') { setPhase('coaching'); scrollTop(); return; }
    if (qIdx > 0) { setQIdx((i) => i - 1); scrollTop(); }
    else { onDismiss(); }
  }, [phase, qIdx, onDismiss]);

  // ---- Header labels -------------------------------------------------------
  const headerLabel = {
    triage:          `Question ${qIdx + 1} of ${TRIAGE_QUESTIONS.length}`,
    supervisor_check:'Before you continue',
    loading:         'Preparing guidance',
    coaching:        'Guidance',
    empathy_pause:   'Take a moment',
    report:          'Incident Report',
    submitted:       'Done',
  }[phase] || '';

  const showBack = phase !== 'submitted' && phase !== 'loading';

  const coachingSummary = coaching
    ? `Guidance provided by Mise: ${coaching.approach || ''} Escalation: ${coaching.escalation || ''}`
    : null;

  const currentQ    = TRIAGE_QUESTIONS[qIdx];
  const currentVal  = answers[currentQ?.id];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 190,
      background: C.charcoal,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ---- Sticky header ---- */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        padding: '14px 16px 12px',
        background: C.charcoal,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0,
      }}>
        {showBack && (
          <button
            onClick={handleBack}
            aria-label="Back"
            style={{
              background: 'none', border: 'none', padding: '6px 4px',
              color: C.cream60, cursor: 'pointer',
              minWidth: 44, minHeight: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, lineHeight: 1,
            }}
          >
            ←
          </button>
        )}
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.gold }}>
            RSA Patron Situation
          </p>
          <p style={{ margin: '2px 0 0', fontFamily: sans, fontSize: 13, color: C.cream60 }}>
            {headerLabel}
          </p>
        </div>
        {/* Progress dots — triage only */}
        {phase === 'triage' && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {TRIAGE_QUESTIONS.map((_, i) => (
              <div key={i} style={{
                width: i === qIdx ? 16 : 6, height: 6, borderRadius: 3,
                background: i < qIdx ? C.gold : i === qIdx ? C.gold : 'rgba(245,240,232,0.2)',
                transition: 'width 0.2s, background 0.2s',
              }} />
            ))}
          </div>
        )}
        <button
          onClick={onDismiss}
          aria-label="Close"
          style={{
            background: 'none', border: 'none', padding: 8,
            color: C.cream60, cursor: 'pointer',
            minWidth: 44, minHeight: 44,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* ---- Scrollable body ---- */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', paddingTop: 16 }}>
        {phase === 'triage' && currentQ && (
          <TriageQuestion
            q={currentQ}
            currentValue={currentVal}
            onTap={(value) => {
              if (currentQ.multiSelect) {
                handleQ1Toggle(value);
              } else {
                handleSingleSelect(currentQ.id, value);
              }
            }}
            onContinue={handleQ1Continue}
          />
        )}

        {phase === 'supervisor_check' && (
          <SupervisorCheck onAnswer={handleSupervisorCheck} />
        )}

        {phase === 'loading' && <LoadingView />}

        {phase === 'coaching' && (
          <CoachingView
            coaching={coaching}
            severity={severity}
            sourceAttribution={sourceAttribution}
            hasError={hasError}
            onHandled={handleHandled}
          />
        )}

        {phase === 'empathy_pause' && (
          <EmpathyPause
            onReady={() => { setPhase('report'); scrollTop(); }}
            onLater={onDismiss}
          />
        )}

        {phase === 'report' && reportTemplate && (
          <ReportView
            reportTemplate={reportTemplate}
            coachingSummary={coachingSummary}
            session={session}
            onSubmit={handleReportSubmit}
            onSaveDraft={onDismiss}
          />
        )}

        {phase === 'submitted' && (
          <SubmittedView reportId={submittedId} onClose={onDismiss} />
        )}
      </div>
    </div>
  );
}
