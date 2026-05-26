// IncidentsScreen — Incident reporting matrix UI (MIS-390).
//
// Two states:
//   list  — shows recent incidents for this venue/user (role-filtered server-side).
//   detail — full incident card with obligation routing grid + notification log.
//
// The routing grid is the demo hero: staff watch Mise auto-determine whether an
// incident needs OLGR, AUSTRAC, or police notification. Each obligation cell shows
// its status (confirmed / [Confirm-Legal] / fulfilled). Notification routing shows
// who was alerted and when.
//
// AUSTRAC SMR: shown as "Compliance review in progress" at all current MVP roles.
// Medical emergency first-aid add-on block: hidden pending MIS-379 Legal clearance.
// [Confirm-Legal] cells: rendered as "Review required — speak to your Compliance Officer."
import React, { useCallback, useEffect, useState } from 'react';
import { fetchIncidents, fetchIncidentDetail } from '../api.js';

// ---- colour tokens via CSS vars -------------------------------------------
const T = {
  gold:      'var(--gold)',
  goldFaint: 'var(--gold-15)',
  cream:     'var(--cream)',
  cream60:   'var(--cream-60)',
  cream40:   'var(--cream-40)',
  red:       'var(--red)',
  amber:     'var(--amber)',
  mint:      'var(--mint)',
  surface:   'var(--color-surface)',
  surface2:  'var(--color-surface-2)',
  hairline:  'var(--hairline)',
  charcoal:  'var(--charcoal)',
};

const FONT_DISPLAY   = "'Space Grotesk', system-ui, sans-serif";
const FONT_EDITORIAL = "'Plus Jakarta Sans', system-ui, sans-serif";
const FONT_SANS      = "'DM Sans', system-ui, sans-serif";
const FONT_DATA      = "'IBM Plex Mono', monospace";

// ---- Severity colour map ---------------------------------------------------
function severityColour(level) {
  return { 1: '#4b5563', 2: T.amber, 3: '#d97706', 4: T.red }[level] || T.cream40;
}

function severityBg(level) {
  return { 1: 'rgba(75,85,99,0.12)', 2: 'rgba(232,160,32,0.12)', 3: 'rgba(217,119,6,0.15)', 4: 'rgba(232,80,80,0.15)' }[level] || 'transparent';
}

// ---- Obligation badge ------------------------------------------------------
function ObligationBadge({ obligation }) {
  if (obligation.austracHidden) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 0', borderBottom: `1px solid ${T.hairline}` }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.cream40, marginTop: 5, flexShrink: 0 }} />
        <div>
          <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.cream60, letterSpacing: '0.02em' }}>
            Compliance review in progress
          </div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.cream40, marginTop: 2 }}>
            AUSTRAC — hidden per tipping-off rules
          </div>
        </div>
      </div>
    );
  }

  if (obligation.confirmLegal) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 0', borderBottom: `1px solid ${T.hairline}` }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.amber, marginTop: 5, flexShrink: 0 }} />
        <div>
          <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.amber, letterSpacing: '0.02em' }}>
            {obligation.label}
          </div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.cream60, marginTop: 2 }}>
            Review required — speak to your Compliance Officer before external lodgement.
          </div>
        </div>
      </div>
    );
  }

  const isFulfilled = Boolean(obligation.fulfilledAt);
  const indicatorColour = isFulfilled ? T.mint : T.gold;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 0', borderBottom: `1px solid ${T.hairline}` }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: indicatorColour, marginTop: 5, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.cream, letterSpacing: '0.02em' }}>
          {obligation.label}
        </div>
        {obligation.dueBy && (
          <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.cream60, marginTop: 2 }}>
            Due: {new Date(obligation.dueBy).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        )}
        {isFulfilled && (
          <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.mint, marginTop: 2 }}>
            Fulfilled {new Date(obligation.fulfilledAt).toLocaleDateString('en-AU')}
            {obligation.referenceNumber ? ` — Ref: ${obligation.referenceNumber}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Notification row ------------------------------------------------------
function NotificationRow({ n }) {
  const sent = new Date(n.sentAt).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${T.hairline}` }}>
      <div>
        <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.cream, letterSpacing: '0.02em' }}>
          {n.roleLabel}
        </div>
        {n.notifiedName && (
          <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.cream60, marginTop: 2 }}>{n.notifiedName}</div>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.cream60 }}>{sent}</div>
        {n.acknowledgedAt && (
          <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.mint, marginTop: 2 }}>Acked</div>
        )}
        {!n.acknowledgedAt && (
          <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.amber, marginTop: 2 }}>Pending</div>
        )}
      </div>
    </div>
  );
}

// ---- Routing grid (demo hero) ---------------------------------------------
function RoutingGrid({ routing }) {
  return (
    <div style={{ borderRadius: 8, border: `1px solid ${T.hairline}`, overflow: 'hidden', marginTop: 16 }}>
      <div style={{ background: T.surface2, padding: '8px 12px', borderBottom: `1px solid ${T.hairline}` }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, color: T.gold, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Reporting Obligations
        </div>
        <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.cream60, marginTop: 2 }}>
          Auto-determined from incident type — no manual triage
        </div>
      </div>
      <div style={{ padding: '0 12px' }}>
        {routing.obligations.length === 0 ? (
          <div style={{ padding: '12px 0', fontFamily: FONT_SANS, fontSize: 13, color: T.cream60 }}>
            In-house record only — no external obligations triggered.
          </div>
        ) : (
          routing.obligations.map((o) => <ObligationBadge key={o.type} obligation={o} />)
        )}
      </div>

      {routing.policeFirst && (
        <div style={{ background: 'rgba(232,80,80,0.08)', borderTop: `1px solid ${T.hairline}`, padding: '10px 12px' }}>
          <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.red, letterSpacing: '0.04em' }}>
            IMMEDIATE — CALL 000
          </div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.cream60, marginTop: 4 }}>
            Police is the primary obligation. Preserve the scene. Do not move any persons or evidence.
          </div>
        </div>
      )}

      {routing.medicalGate && (
        <div style={{ background: 'rgba(232,160,32,0.08)', borderTop: `1px solid ${T.hairline}`, padding: '10px 12px' }}>
          <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.amber, letterSpacing: '0.04em' }}>
            MEDICAL GUIDANCE — PENDING LEGAL CLEARANCE
          </div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.cream60, marginTop: 4 }}>
            First aid guidance is not available until Legal review is complete.
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Notification routing panel -------------------------------------------
function NotificationPanel({ routing, notifications }) {
  if (!routing.notifications.length) return null;
  return (
    <div style={{ borderRadius: 8, border: `1px solid ${T.hairline}`, overflow: 'hidden', marginTop: 12 }}>
      <div style={{ background: T.surface2, padding: '8px 12px', borderBottom: `1px solid ${T.hairline}` }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, color: T.gold, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Notification Routing
        </div>
        <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.cream60, marginTop: 2 }}>
          Auto-fired on submission — timestamped audit trail
        </div>
      </div>
      <div style={{ padding: '0 12px' }}>
        {routing.notifications.map((r) => {
          const sent = notifications.find((n) => n.role === r.role);
          return (
            <div key={r.role} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${T.hairline}` }}>
              <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.cream, letterSpacing: '0.02em' }}>
                {r.label}
              </div>
              {sent ? (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.cream60 }}>
                    {new Date(sent.sentAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: sent.acknowledgedAt ? T.mint : T.amber, marginTop: 2 }}>
                    {sent.acknowledgedAt ? 'Acknowledged' : 'Sent'}
                  </div>
                </div>
              ) : (
                <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.cream40 }}>On submission</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Detail screen ---------------------------------------------------------
function IncidentDetail({ incidentId, roleTier, onBack, onAuthError }) {
  const [incident, setIncident] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchIncidentDetail(incidentId)
      .then((d) => live && setIncident(d))
      .catch((err) => {
        if (!live) return;
        if (err.status === 401) { onAuthError(); return; }
        setError('Could not load incident report.');
      })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [incidentId, onAuthError]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!incident) return null;

  const severityC = severityColour(incident.severityLevel);
  const severityBgC = severityBg(incident.severityLevel);

  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div style={{ padding: '0 0 24px' }}>
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        style={{ background: 'none', border: 'none', color: T.gold, fontFamily: FONT_SANS, fontSize: 14, fontWeight: 600, padding: '16px 16px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        ← Incidents
      </button>

      {/* Severity header */}
      <div style={{ background: severityBgC, borderBottom: `1px solid ${T.hairline}`, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: T.cream, fontWeight: 700, lineHeight: 1.3 }}>
              {incident.incidentLabel}
            </div>
            <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.cream60, marginTop: 4 }}>
              {fmtDate(incident.incidentAt)}
            </div>
          </div>
          <div style={{
            background: severityC, color: T.charcoal,
            fontFamily: FONT_DATA, fontSize: 12, fontWeight: 700,
            padding: '4px 8px', borderRadius: 4, letterSpacing: '0.06em',
            flexShrink: 0, marginLeft: 12,
          }}>
            {incident.severityLabel}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <StatusChip status={incident.status} />
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Core fields */}
        <Section title="Incident Record">
          <Field label="Location" value={incident.locationInVenue} />
          <Field label="Reported by" value={incident.reportedByName} />
          {incident.dutyManagerName && <Field label="Duty Manager" value={incident.dutyManagerName} />}
          <Field label="Description" value={incident.description} multiline />
          <Field label="Action taken" value={incident.immediateActionTaken} multiline />
          {incident.patronDescription && <Field label="Patron description" value={incident.patronDescription} multiline />}
          {incident.witnesses && <Field label="Witnesses" value={incident.witnesses} />}
          {incident.injuriesOrDamage && <Field label="Injuries / damage" value={incident.injuriesOrDamage} multiline />}
          {incident.policeCalled && <Field label="Police called" value={incident.policeReference ? `Yes — Ref: ${incident.policeReference}` : 'Yes'} />}
          {incident.ambulanceCalled && <Field label="Ambulance called" value={incident.ambulanceReference ? `Yes — Ref: ${incident.ambulanceReference}` : 'Yes'} />}
          {incident.submittedAt && <Field label="Submitted" value={fmtDate(incident.submittedAt)} />}
        </Section>

        {/* Routing grid — the demo hero */}
        <RoutingGrid routing={incident.routing} />

        {/* Notification routing */}
        <NotificationPanel routing={incident.routing} notifications={incident.notifications} />

        {/* Obligation detail (fulfilled status) */}
        {incident.obligations.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <SectionHeader title="Obligation Status" />
            {incident.obligations.map((o) => <ObligationBadge key={o.type + (o.obligationId || '')} obligation={o} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- List screen -----------------------------------------------------------
function IncidentList({ roleTier, onSelect, onAuthError }) {
  const [incidents, setIncidents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    fetchIncidents()
      .then((d) => live && setIncidents(d.incidents || []))
      .catch((err) => {
        if (!live) return;
        if (err.status === 401) { onAuthError(); return; }
        setError('Could not load incident reports.');
      })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [onAuthError]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: T.gold, fontWeight: 700, marginBottom: 4 }}>
        Incidents
      </div>
      <div style={{ fontFamily: FONT_EDITORIAL, fontSize: 15, color: T.cream60, marginBottom: 20, lineHeight: 1.5 }}>
        {roleTier === 7
          ? 'Your incident reports for this venue.'
          : 'All incident reports for this venue. Tap to view obligation routing.'}
      </div>

      {incidents.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 48 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: T.cream60 }}>No incidents recorded</div>
          <div style={{ fontFamily: FONT_EDITORIAL, fontSize: 15, color: T.cream40, marginTop: 8 }}>
            Incident reports are created automatically after an RSA triage conversation.
          </div>
        </div>
      )}

      {incidents.map((inc) => (
        <IncidentCard key={inc.incidentId} incident={inc} onSelect={onSelect} />
      ))}

      {/* Demo explainer for the routing matrix */}
      {incidents.length > 0 && roleTier <= 5 && (
        <div style={{
          marginTop: 20, padding: 14, borderRadius: 8,
          background: T.goldFaint, border: `1px solid var(--gold-25)`,
        }}>
          <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.gold, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
            How it works
          </div>
          <div style={{ fontFamily: FONT_SANS, fontSize: 13, color: T.cream60, lineHeight: 1.6 }}>
            Mise reads triage answers → classifies the incident type → auto-determines OLGR, AUSTRAC, and police obligations with timeframes. No manual compliance triage by staff.
          </div>
        </div>
      )}
    </div>
  );
}

function IncidentCard({ incident, onSelect }) {
  const sc = severityColour(incident.severityLevel);
  const sbg = severityBg(incident.severityLevel);
  const obligationCount = incident.routing?.obligations?.length || 0;
  const confirmLegalCount = incident.routing?.obligations?.filter((o) => o.confirmLegal).length || 0;
  const notificationCount = incident.routing?.notifications?.length || 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(incident.incidentId)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        background: T.surface, border: `1px solid ${T.hairline}`,
        borderRadius: 10, marginBottom: 10, padding: '14px',
        cursor: 'pointer', transition: 'border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, paddingRight: 10 }}>
          <div style={{ fontFamily: FONT_SANS, fontSize: 14, fontWeight: 600, color: T.cream, lineHeight: 1.3 }}>
            {incident.incidentLabel}
          </div>
          <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.cream60, marginTop: 4 }}>
            {new Date(incident.incidentAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {incident.locationInVenue ? ` · ${incident.locationInVenue}` : ''}
          </div>
          {incident.reportedByName && (
            <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: T.cream40, marginTop: 3 }}>
              {incident.reportedByName}
            </div>
          )}
        </div>
        <div style={{
          background: sbg, border: `1px solid ${sc}`,
          fontFamily: FONT_DATA, fontSize: 12, color: sc, fontWeight: 700,
          padding: '3px 7px', borderRadius: 4, letterSpacing: '0.06em',
          flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          {incident.severityLabel}
        </div>
      </div>

      {/* Routing summary pills */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <StatusChip status={incident.status} small />
        {obligationCount > 0 && (
          <Pill label={`${obligationCount} obligation${obligationCount > 1 ? 's' : ''}`} colour={T.cream60} />
        )}
        {confirmLegalCount > 0 && (
          <Pill label={`${confirmLegalCount} review required`} colour={T.amber} />
        )}
        {notificationCount > 0 && (
          <Pill label={`${notificationCount} notified`} colour={T.cream40} />
        )}
        {incident.routing?.policeFirst && (
          <Pill label="Police — 000" colour={T.red} />
        )}
      </div>
    </button>
  );
}

// ---- Shared micro-components ----------------------------------------------

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <SectionHeader title={title} />
      {children}
    </div>
  );
}

function SectionHeader({ title }) {
  return (
    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, color: T.gold, letterSpacing: '0.04em', textTransform: 'uppercase', paddingBottom: 8, borderBottom: `1px solid ${T.hairline}` }}>
      {title}
    </div>
  );
}

function Field({ label, value, multiline }) {
  if (!value) return null;
  return (
    <div style={{ padding: '9px 0', borderBottom: `1px solid ${T.hairline}` }}>
      <div style={{ fontFamily: FONT_DATA, fontSize: 12, color: T.cream60, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontFamily: multiline ? FONT_EDITORIAL : FONT_SANS, fontSize: multiline ? 15 : 13, color: T.cream, lineHeight: 1.5 }}>
        {value}
      </div>
    </div>
  );
}

function StatusChip({ status, small }) {
  const map = {
    draft:       { label: 'Draft',     bg: 'rgba(75,85,99,0.2)',   text: '#9ca3af' },
    submitted:   { label: 'Submitted', bg: 'rgba(46,107,174,0.15)', text: 'var(--gold)' },
    acknowledged:{ label: 'Acknowledged', bg: 'rgba(0,232,122,0.12)', text: 'var(--mint)' },
  };
  const s = map[status] || { label: status, bg: 'rgba(75,85,99,0.2)', text: '#9ca3af' };
  return (
    <span style={{ background: s.bg, color: s.text, fontFamily: FONT_DATA, fontSize: 12, fontWeight: 700, padding: small ? '2px 6px' : '3px 8px', borderRadius: 4, letterSpacing: '0.04em' }}>
      {s.label}
    </span>
  );
}

function Pill({ label, colour }) {
  return (
    <span style={{ fontFamily: FONT_DATA, fontSize: 12, color: colour, letterSpacing: '0.03em', padding: '2px 0' }}>
      {label}
    </span>
  );
}

function LoadingState() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, paddingTop: 64 }}>
      <div style={{ fontFamily: FONT_EDITORIAL, fontSize: 17, color: 'var(--cream-60)' }}>Loading…</div>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ fontFamily: FONT_SANS, fontSize: 14, color: 'var(--red)' }}>{message}</div>
    </div>
  );
}

// ---- Root export -----------------------------------------------------------

export default function IncidentsScreen({ onAuthError, roleTier }) {
  const [selectedId, setSelectedId] = useState(null);

  const handleSelect = useCallback((id) => setSelectedId(id), []);
  const handleBack   = useCallback(() => setSelectedId(null), []);

  if (selectedId) {
    return (
      <IncidentDetail
        incidentId={selectedId}
        roleTier={roleTier}
        onBack={handleBack}
        onAuthError={onAuthError}
      />
    );
  }

  return (
    <IncidentList
      roleTier={roleTier}
      onSelect={handleSelect}
      onAuthError={onAuthError}
    />
  );
}
