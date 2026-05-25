// Handover — the STRUCTURED prior-shift handover (MIS-43 / MIS-26 Scene 2).
// Rendered inline in the chat thread when a Duty Manager asks "Walk me through
// tonight's handover." Instead of a wall of text, it breaks the pre-seeded note
// into labelled sections: who→who, open compliance items, staffing, incidents,
// and recommended actions (the open items + what to do about them).
//
// ALL content comes from GET /api/handover (token/RLS-scoped). Nothing hardcoded.
//
// Props: { handover }
import React from 'react';

function fmtDate(d) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function Section({ label, children }) {
  return (
    <div className="border-t border-hairline pt-2.5">
      <p className="mb-1.5 font-data text-[12px] uppercase tracking-wider text-cream/40">
        {label}
      </p>
      {children}
    </div>
  );
}

function Bullets({ items, dotColor }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2">
          <span
            className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: dotColor || '#B8863A' }}
            aria-hidden="true"
          />
          <span className="text-[13px] leading-snug text-cream/90">{t}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Handover({ handover }) {
  if (!handover) return null;
  const {
    fromRole,
    toRole,
    shiftDate,
    author,
    openComplianceItems = [],
    staffingNotes,
    incidentsSummary,
    actionItems = [],
  } = handover;

  return (
    <section
      data-testid="handover"
      className="flex flex-col gap-2.5"
      aria-label="Shift handover"
    >
      {/* Who → who */}
      <div>
        <p className="text-sm font-bold text-gold">Shift handover</p>
        <p className="font-data text-[12px] text-cyan">
          {fromRole} → {toRole}
        </p>
        <p className="font-data text-[12px] text-cream/45">
          {fmtDate(shiftDate)}
          {author ? ` · ${author}` : ''}
        </p>
      </div>

      {openComplianceItems.length > 0 && (
        <Section label="Open compliance items">
          <Bullets items={openComplianceItems} dotColor="#E8A020" />
        </Section>
      )}

      {staffingNotes && (
        <Section label="Staffing">
          <p className="text-[13px] leading-snug text-cream/90">{staffingNotes}</p>
        </Section>
      )}

      {incidentsSummary && (
        <Section label="Incidents">
          <p className="text-[13px] leading-snug text-cream/90">{incidentsSummary}</p>
        </Section>
      )}

      {actionItems.length > 0 && (
        <Section label="Recommended actions">
          <ol className="flex flex-col gap-1.5">
            {actionItems.map((t, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gold/20 font-data text-[12px] font-bold text-gold">
                  {i + 1}
                </span>
                <span className="text-[13px] leading-snug text-cream/90">{t}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </section>
  );
}
