// ShiftSummary — the Duty Manager's OPENING surface (MIS-43 / MIS-26 Scene 2).
// Rendered when a DM opens the app with no message, in place of the generic
// empty state. It is a live, scannable snapshot — deliberately terse so it reads
// in well under 150 words on a floor phone at 375px: staffing, the flagged
// gaming labour %, open compliance incidents, and the prior shift's open items.
//
// ALL content comes from GET /api/shift-summary (token/RLS-scoped). Nothing here
// is hardcoded. A tap on "View full handover" sends the handover request up to
// the chat so the structured note renders inline.
//
// Props: { summary, staffName, reservations?, onAskHandover }
import React from 'react';
import ReservationsSection from './ReservationsSection.jsx';

// "15:10" from an ISO timestamp, in venue-local 24h (data → mono).
function hhmm(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function clip(text, n = 7) {
  const w = (text || '').split(/\s+/).filter(Boolean);
  return w.length <= n ? text : `${w.slice(0, n).join(' ')}…`;
}

export default function ShiftSummary({ summary, staffName, reservations, onAskHandover }) {
  if (!summary) return null;
  const { staffing, gamingLabour, openCompliance = [], priorHandover } = summary;
  const first = staffName ? staffName.split(' ')[0] : null;

  return (
    <section
      data-testid="shift-summary"
      className="mise-rise mx-auto flex w-full max-w-[420px] flex-col gap-3"
      aria-label="Opening shift summary"
    >
      {/* Header */}
      <div>
        <p className="font-data text-[12px] uppercase tracking-wider text-cream/40">
          Opening summary
        </p>
        <h2 className="font-display text-lg font-bold text-gold">
          {first ? `G'day, ${first}.` : "G'day."}
        </h2>
      </div>

      {/* Staffing */}
      <Card>
        <Row>
          <span className="font-data text-2xl font-bold text-cyan">{staffing.onNow}</span>
          <span className="text-sm text-cream/80">on now</span>
        </Row>
        <p
          className={`mt-1 text-[13px] ${
            staffing.gamingUnderstaffed ? 'text-amber' : 'text-cream/70'
          }`}
        >
          Gaming floor {staffing.gamingOnFloor} of {staffing.gamingMinAttendants} min
          {staffing.gamingUnderstaffed ? ' — short' : ''}
        </p>
      </Card>

      {/* Gaming labour % */}
      <Card flagged={gamingLabour.flagged}>
        <Row>
          <span className="text-sm text-cream/80">Gaming labour</span>
          <span
            className={`ml-auto font-data text-2xl font-bold ${
              gamingLabour.flagged ? 'text-amber' : 'text-mint'
            }`}
          >
            {gamingLabour.pct}%
          </span>
        </Row>
        {/* Label the denominator: % is of NET gaming revenue (RTV), never EGM meter. */}
        <p className="mt-0.5 text-[12px] text-cream/40">
          of net gaming revenue (RTV)
        </p>
        {gamingLabour.flagged && (
          <p className="mt-1 text-[13px] text-amber">
            Over {gamingLabour.thresholdPct}% target
          </p>
        )}
      </Card>

      {/* Open compliance incidents */}
      {openCompliance.length > 0 && (
        <Card>
          <p className="font-data text-[12px] uppercase tracking-wider text-cream/40">
            Open incidents
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {openCompliance.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: c.severity === 'critical' ? '#E85050' : '#E8A020' }}
                  aria-hidden="true"
                />
                <span className="text-[13px] text-cream/90">
                  {c.headline}
                  <span className="font-data text-cream/45"> · {hhmm(c.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Prior-shift handover highlights */}
      {priorHandover?.highlights?.length > 0 && (
        <Card>
          <p className="font-data text-[12px] uppercase tracking-wider text-cream/40">
            From last shift
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-cream/75">
            {priorHandover.highlights.slice(0, 2).map((h, i) => (
              <li key={i}>• {clip(h)}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onAskHandover}
            className="mt-2 inline-flex min-h-[44px] items-center font-data text-[12px] font-semibold text-gold"
          >
            View full handover →
          </button>
        </Card>
      )}

      {/* Reservations — below shift overview (feature spec MIS-243) */}
      {reservations && <ReservationsSection reservations={reservations} />}
    </section>
  );
}

function Card({ children, flagged }) {
  return (
    <div
      className={`rounded-2xl border bg-surface px-3.5 py-3 ${
        flagged ? 'border-amber/40' : 'border-hairline'
      }`}
    >
      {children}
    </div>
  );
}

function Row({ children }) {
  return <div className="flex items-center gap-2">{children}</div>;
}
