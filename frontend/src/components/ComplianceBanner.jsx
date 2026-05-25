// ComplianceBanner -- MIS-44 / Demo Scene 3.
//
// The blocking compliance alert banner. Pinned to the very top of the screen
// (above the TopBar) whenever the Compliance Monitor has an active alert for the
// Duty Manager's venue. Severity drives the colour: Critical = red, Warning =
// amber (brand spec). It CANNOT be dismissed by tapping away -- the only way to
// clear it is to type an acknowledgement / logged action, which persists to
// compliance_events (acknowledged_at + acknowledged_by) via the parent's
// onAcknowledge handler.
//
// Data shape (props.alert): { eventId, severity, description, createdAt }
//   onAcknowledge(eventId, note) -> Promise -- parent calls the ack endpoint.
import React, { useState } from 'react';

const SEVERITY = {
  critical: {
    label: 'CRITICAL',
    bar: 'bg-red',
    text: 'text-red',
    ring: 'border-red',
  },
  warning: {
    label: 'WARNING',
    bar: 'bg-amber',
    text: 'text-amber',
    ring: 'border-amber',
  },
};

export default function ComplianceBanner({ alert, onAcknowledge }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [acked, setAcked] = useState(false);

  if (!alert) return null;
  const sev = SEVERITY[alert.severity] || SEVERITY.critical;
  const canConfirm = note.trim().length >= 3 && !busy;

  const time = alert.createdAt
    ? new Date(alert.createdAt).toLocaleTimeString('en-AU', {
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null;

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await onAcknowledge(alert.eventId, note.trim());
      // Show confirmation for 2s while parent delays removing this alert.
      setAcked(true);
      setBusy(false);
    } catch (err) {
      setError(
        err?.status === 400
          ? 'Type the action you took before acknowledging.'
          : "Couldn't log the acknowledgement. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <section
      role="alert"
      aria-live="assertive"
      className={`shrink-0 border-b-2 ${sev.ring} bg-surface`}
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      {/* Severity strip */}
      <div className={`h-1 w-full ${sev.bar}`} aria-hidden="true" />

      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Severity badge -- solid, impossible to miss in a dark room. */}
          <span
            className={`mt-0.5 shrink-0 rounded ${sev.bar} px-2 py-1 font-data text-[12px] font-bold tracking-wider text-charcoal`}
          >
            {sev.label}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold ${sev.text}`}>Compliance alert</p>
            <p className="mt-1 text-sm leading-snug text-cream">{alert.description}</p>
            {time && (
              <p className="mt-1 font-data text-[12px] text-cyan">Detected {time}</p>
            )}
          </div>
        </div>

        {/* Post-ACK confirmation -- shown for ~2s while parent removes the alert. */}
        {acked ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-mint/40 bg-mint/10 px-4 py-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m5 12 4.5 4.5L19 7" stroke="#00E87A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm font-semibold text-mint">Action logged -- alert clearing</span>
          </div>
        ) : null}

        {/* Acknowledgement -- the ONLY way out. No close/dismiss control exists. */}
        {!acked && !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`mt-3 w-full rounded-lg ${sev.bar} px-4 py-3 text-sm font-bold text-charcoal active:opacity-80`}
          >
            Acknowledge &amp; log action
          </button>
        ) : !acked ? (
          <div className="mt-3">
            <label htmlFor="ack-note" className="text-xs font-semibold text-cream/80">
              Type the action you have taken (required to clear this alert)
            </label>
            <textarea
              id="ack-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              autoFocus
              placeholder="e.g. Pulled Marcus from break to cover the floor; restricted to 30 machines."
              className="mt-1 w-full resize-none rounded-lg border border-hairline bg-charcoal px-3 py-2 text-sm text-cream placeholder:text-cream/40 focus:border-gold focus:outline-none"
            />
            {error && <p className="mt-1 text-xs font-semibold text-red">{error}</p>}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => { setOpen(false); setNote(''); setError(null); }}
                disabled={busy}
                className="flex-1 rounded-lg border border-hairline px-4 py-3 text-sm font-semibold text-cream/80 active:text-cream"
              >
                Back
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={!canConfirm}
                className={`flex-1 rounded-lg px-4 py-3 text-sm font-bold text-charcoal transition-opacity ${
                  canConfirm ? `${sev.bar}` : 'bg-cream/30'
                }`}
              >
                {busy ? 'Logging...' : 'Confirm acknowledgement'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
