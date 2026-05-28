// ComplianceBanner — redesigned to MIS-629 UX spec (MIS-636).
//
// Collapsed card: EXACTLY three visible content elements:
//   1. Subject — person name or issue subject
//   2. Severity badge + label (e.g. CRITICAL — RG Certification Lapsed)
//   3. Single action button — "Acknowledge & View Details"
// Plus chrome: 3px left accent bar, optional L4 pulse dot, timestamp at card foot.
//
// All detail (description, recommended action, routing) lives BEHIND the button
// on the full-screen details overlay. Acknowledgement (typed note) also lives there.
//
// L4 (critical) = non-dismissible, animated pulse dot.
// L3 (warning)  = swipe-left OR × to dismiss, requires confirm step.
//
// Props:
//   alert           — { eventId, eventType, severity, description, createdAt }
//   onAcknowledge   — (eventId, note) → Promise
import React, { useState, useRef, useEffect } from 'react';

// ── Severity config (L1–L4) ─────────────────────────────────────────────────
const SEV = {
  critical: {
    level: 4,
    word: 'CRITICAL',
    color: '#E85050',
    fill: 'rgba(232,80,80,0.15)',
    pulse: true,
    dismissible: false,
  },
  warning: {
    level: 3,
    word: 'HIGH',
    color: '#E8A020',
    fill: 'rgba(232,160,32,0.12)',
    pulse: false,
    dismissible: true,
  },
  gap: {
    level: 2,
    word: 'ELEVATED',
    color: '#00C8E8',
    fill: 'rgba(0,200,232,0.08)',
    pulse: false,
    dismissible: true,
  },
  info: {
    level: 1,
    word: 'ROUTINE',
    color: '#00E87A',
    fill: 'rgba(0,232,122,0)',
    pulse: false,
    dismissible: true,
  },
};

// ── Event-type → display label ───────────────────────────────────────────────
const EVENT_LABELS = {
  rg_cert_lapsed_on_floor:           'RG Certification Lapsed',
  compliance_inspection_in_progress: 'Inspection In Progress',
  liquor_licence_renewal_due:        'Licence Renewal Due',
  gaming_understaffing:              'Gaming Floor Understaffed',
};

// ── Event-type → subject line (person name or issue subject) ─────────────────
// For staff-specific events, extract the name from the description.
// Description format: "RG certification lapsed — Marcus Forsyth (Gaming Attendant) ..."
function deriveSubject(eventType, description) {
  const staffEvents = new Set(['rg_cert_lapsed_on_floor']);
  if (staffEvents.has(eventType) && description) {
    const m = description.match(/—\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[\(\-]/);
    if (m) return m[1].trim();
  }
  const fallbacks = {
    rg_cert_lapsed_on_floor:           'Staff Member',
    compliance_inspection_in_progress: 'Active Inspection',
    liquor_licence_renewal_due:        'Liquor Licence',
    gaming_understaffing:              'Gaming Floor',
  };
  return fallbacks[eventType] ?? 'Compliance Alert';
}

// ── Event-type → recommended action (shown in details view) ─────────────────
const RECOMMENDED = {
  rg_cert_lapsed_on_floor:
    'Remove this staff member from the gaming floor immediately. Do not allow them to work on the floor until RG certification is renewed and confirmed on file.',
  compliance_inspection_in_progress:
    'Locate the RSA register and CCTV coverage log and present them to the inspector. Notify the Venue Manager. Stay available for the inspector\'s questions.',
  liquor_licence_renewal_due:
    'Confirm with the Venue Manager that the renewal application is in progress. Check the current status and target lodgement date.',
  gaming_understaffing:
    'Roster a qualified gaming attendant immediately or restrict EGM access to the number that can be supervised. This is a legal minimum.',
};

// ── Shared token values ──────────────────────────────────────────────────────
const CARD_BG    = '#0E1E32';
const BORDER     = 'rgba(46,107,174,0.20)';
const TEXT_SUB   = '#7AAAD0';
const TEXT_MUTED = '#3A6090';

export default function ComplianceBanner({ alert, onAcknowledge }) {
  // All hooks at top — no conditional hook calls.
  const [detailOpen, setDetailOpen]       = useState(false);
  const [dismissConfirm, setDismissConfirm] = useState(false);
  const [note, setNote]                   = useState('');
  const [busy, setBusy]                   = useState(false);
  const [ackError, setAckError]           = useState(null);
  const [acked, setAcked]                 = useState(false);
  const [swipeX, setSwipeX]               = useState(0);
  const touchStartRef                     = useRef(null);
  const noteRef                           = useRef(null);

  // Auto-focus the note field when the detail overlay opens.
  useEffect(() => {
    if (detailOpen && noteRef.current) {
      setTimeout(() => noteRef.current?.focus(), 300);
    }
  }, [detailOpen]);

  // Close detail overlay on Escape.
  useEffect(() => {
    if (!detailOpen) return;
    const h = (e) => { if (e.key === 'Escape') setDetailOpen(false); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [detailOpen]);

  if (!alert) return null;

  const sev     = SEV[alert.severity] ?? SEV.critical;
  const subject = deriveSubject(alert.eventType, alert.description);
  const label   = EVENT_LABELS[alert.eventType]
    ?? alert.eventType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const recAction = RECOMMENDED[alert.eventType];
  const canConfirm = note.trim().length >= 3 && !busy;

  const time = alert.createdAt
    ? new Date(alert.createdAt).toLocaleTimeString('en-AU', {
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null;

  // ── Swipe handlers (L1–L3 only) ──────────────────────────────────────────
  function onTouchStart(e) {
    if (!sev.dismissible) return;
    touchStartRef.current = e.touches[0].clientX;
  }
  function onTouchMove(e) {
    if (!sev.dismissible || touchStartRef.current === null) return;
    const delta = touchStartRef.current - e.touches[0].clientX;
    if (delta > 0) setSwipeX(Math.min(delta, 120));
  }
  function onTouchEnd() {
    if (!sev.dismissible) return;
    if (swipeX > 80) setDismissConfirm(true);
    setSwipeX(0);
    touchStartRef.current = null;
  }

  // ── Acknowledgement submit ────────────────────────────────────────────────
  async function handleAcknowledge() {
    if (!canConfirm) return;
    setBusy(true);
    setAckError(null);
    try {
      await onAcknowledge(alert.eventId, note.trim());
      setAcked(true);
      setBusy(false);
    } catch (err) {
      setAckError(
        err?.status === 400
          ? 'Add a short note or logged action to clear this critical alert.'
          : "Couldn't save — tap to retry.",
      );
      setBusy(false);
    }
  }

  // ── Post-ACK success state ────────────────────────────────────────────────
  if (acked) {
    return (
      <section role="alert" aria-live="polite" style={cardStyle(sev)}>
        <div style={accentBarStyle(sev)} aria-hidden="true" />
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m5 12 4.5 4.5L19 7" stroke="#00E87A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: '#00E87A' }}>
            Acknowledged · logged to compliance record
          </span>
        </div>
      </section>
    );
  }

  // ── Dismiss confirm (L1–L3 swipe/tap ×) ─────────────────────────────────
  if (dismissConfirm) {
    return (
      <section role="alert" aria-live="assertive" style={cardStyle(sev)}>
        <div style={accentBarStyle(sev)} aria-hidden="true" />
        <div style={{ padding: '12px 16px' }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 14, color: '#E0EEFF', fontWeight: 600 }}>
            Dismiss this alert?
          </p>
          <p style={{ margin: '4px 0 12px', fontFamily: 'var(--font-sans)', fontSize: 13, color: TEXT_SUB }}>
            Dismissal will be logged to the compliance record. The underlying issue may still require action.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setDismissConfirm(false)}
              style={secondaryBtnStyle}
            >
              Keep open
            </button>
            <button
              type="button"
              onClick={() => onAcknowledge(alert.eventId, 'Dismissed — reviewed and noted.').catch(() => {})}
              style={{ ...primaryBtnStyle, background: sev.color, color: '#090F1A' }}
            >
              Confirm dismiss
            </button>
          </div>
        </div>
      </section>
    );
  }

  // ── Collapsed card (the redesign core) ───────────────────────────────────
  const card = (
    <section
      role="alert"
      aria-live="assertive"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        ...cardStyle(sev),
        transform: swipeX > 0 ? `translateX(-${swipeX}px)` : 'none',
        transition: swipeX > 0 ? 'none' : 'transform 0.2s ease',
      }}
    >
      {/* 3px severity accent bar */}
      <div style={accentBarStyle(sev)} aria-hidden="true" />

      <div style={{ padding: '12px 16px 10px' }}>
        {/* Row 1: subject + optional pulse dot + dismiss × (L1–L3) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={subjectStyle} className="truncate">{subject}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {sev.pulse && (
              <span
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: sev.color,
                  display: 'inline-block',
                  animation: 'compliance-pulse 2s ease-in-out infinite',
                }}
                aria-hidden="true"
              />
            )}
            {sev.dismissible && (
              <button
                type="button"
                aria-label="Dismiss alert"
                onClick={() => setDismissConfirm(true)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: TEXT_MUTED, fontSize: 18, lineHeight: 1,
                  padding: '0 2px', minHeight: 'unset',
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Row 2: severity badge + label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={{
            fontFamily: 'var(--font-data)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: sev.color,
            background: `${sev.color}26`,
            borderRadius: 4,
            padding: '2px 6px',
            flexShrink: 0,
          }}>
            {sev.word}
          </span>
          <span style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 600,
            color: '#E0EEFF',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {label}
          </span>
        </div>

        {/* Row 3: action button — the ONLY interactive element on the card */}
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          style={primaryBtnStyle}
        >
          Acknowledge &amp; View Details
        </button>

        {/* Timestamp chrome — orientation anchor, not a content element */}
        {time && (
          <p style={{
            margin: '8px 0 0',
            fontFamily: 'var(--font-data)',
            fontSize: 11,
            color: TEXT_MUTED,
            letterSpacing: '0.02em',
          }}>
            {time}
          </p>
        )}
      </div>
    </section>
  );

  // ── Detail overlay (full-screen sheet on mobile) ──────────────────────────
  const detail = detailOpen ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${subject} — ${label}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        display: 'flex',
        flexDirection: 'column',
        background: '#0E1E32',
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'var(--safe-bottom)',
        overflowY: 'auto',
        animation: 'detail-slide-up 220ms ease-out',
      }}
    >
      {/* Detail header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: `1px solid ${BORDER}`,
        flexShrink: 0,
        gap: 12,
      }}>
        <button
          type="button"
          onClick={() => setDetailOpen(false)}
          aria-label="Back to alert feed"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: TEXT_SUB, padding: 4, minHeight: 'unset', flexShrink: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ ...subjectStyle, margin: 0, fontSize: 16 }}>{subject}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span style={{
              fontFamily: 'var(--font-data)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: sev.color,
              background: `${sev.color}26`,
              borderRadius: 3,
              padding: '1px 5px',
            }}>
              {sev.word}
            </span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: TEXT_SUB }}>{label}</span>
          </div>
        </div>
        {sev.pulse && (
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: sev.color,
            animation: 'compliance-pulse 2s ease-in-out infinite',
          }} aria-hidden="true" />
        )}
      </div>

      {/* Detail body */}
      <div style={{ flex: 1, padding: '20px 16px', overflowY: 'auto' }}>
        {/* Full description */}
        <section style={{ marginBottom: 20 }}>
          <h2 style={detailSectionHeadStyle}>What happened</h2>
          <p style={detailBodyStyle}>{alert.description}</p>
        </section>

        {/* Recommended action */}
        {recAction && (
          <section style={{
            marginBottom: 20,
            background: `${sev.color}12`,
            border: `1px solid ${sev.color}30`,
            borderRadius: 8,
            padding: '12px 14px',
          }}>
            <h2 style={{ ...detailSectionHeadStyle, color: sev.color, marginTop: 0 }}>What to do now</h2>
            <p style={{ ...detailBodyStyle, margin: 0 }}>{recAction}</p>
          </section>
        )}

        {/* Routing note */}
        {alert.severity === 'critical' && (
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: TEXT_MUTED,
            marginBottom: 20,
          }}>
            Also sent to: Venue Manager
          </p>
        )}

        {/* Acknowledgement section */}
        <section>
          <h2 style={detailSectionHeadStyle}>Log your action</h2>
          <p style={{ ...detailBodyStyle, marginBottom: 8, fontSize: 12, color: TEXT_SUB }}>
            {alert.severity === 'critical'
              ? 'A non-empty action note is required to clear this critical alert.'
              : 'Describe the action taken (required to acknowledge).'}
          </p>
          <textarea
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. Marcus moved off gaming floor. Renewal arranged for Monday."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#162840',
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: '10px 12px',
              fontFamily: 'var(--font-editorial)',
              fontSize: 14,
              color: '#E0EEFF',
              resize: 'none',
              outline: 'none',
              minHeight: 44,
            }}
            onFocus={(e) => { e.target.style.borderColor = '#2E6BAE'; }}
            onBlur={(e) => { e.target.style.borderColor = BORDER; }}
          />
          {ackError && (
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#E85050', marginTop: 6, marginBottom: 0 }}>
              {ackError}
            </p>
          )}
          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={!canConfirm}
            style={{
              ...primaryBtnStyle,
              marginTop: 10,
              opacity: canConfirm ? 1 : 0.4,
            }}
          >
            {busy ? 'Logging…' : 'Confirm acknowledgement'}
          </button>
        </section>
      </div>
    </div>
  ) : null;

  return (
    <>
      {card}
      {detail}
    </>
  );
}

// ── Shared style helpers ─────────────────────────────────────────────────────

function cardStyle(sev) {
  return {
    flexShrink: 0,
    background: CARD_BG,
    borderBottom: `1px solid ${BORDER}`,
    position: 'relative',
    overflow: 'hidden',
  };
}

function accentBarStyle(sev) {
  return {
    height: 3,
    background: sev.color,
    width: '100%',
  };
}

const subjectStyle = {
  fontFamily: 'var(--font-display)',
  fontSize: 15,
  fontWeight: 600,
  color: '#E0EEFF',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
};

const primaryBtnStyle = {
  width: '100%',
  padding: '14px 16px',
  background: '#2E6BAE',
  color: '#E0EEFF',
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  fontWeight: 700,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  letterSpacing: '0.01em',
  minHeight: 44,
  boxSizing: 'border-box',
};

const secondaryBtnStyle = {
  flex: 1,
  padding: '12px 16px',
  background: 'transparent',
  color: '#7AAAD0',
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid rgba(46,107,174,0.30)',
  borderRadius: 8,
  cursor: 'pointer',
  minHeight: 44,
};

const detailSectionHeadStyle = {
  fontFamily: 'var(--font-display)',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#7AAAD0',
  margin: '0 0 8px',
};

const detailBodyStyle = {
  fontFamily: 'var(--font-editorial)',
  fontSize: 14,
  color: '#E0EEFF',
  lineHeight: 1.55,
  margin: 0,
};
