// Citations — the compliance audit trail shown beneath a Mise answer. Renders
// the `source` + `section` (and per-chunk confidence) returned by retrieval.
// This is a CTO sign-off criterion: citations display beneath compliance
// answers. Data is mono (it's reference data); a "shared" chunk is legislation,
// otherwise it's the venue's own SOP.
//
// Props: { citations: [{ source, section, confidence, shared }] }
import React from 'react';

export default function Citations({ citations }) {
  if (!citations?.length) return null;
  return (
    <div className="mt-2 border-t border-hairline pt-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-cream/40">
        Sources
      </p>
      <ul className="flex flex-col gap-1.5">
        {citations.map((c, i) => (
          <li key={`${c.source}-${c.section}-${i}`} className="flex items-start gap-2">
            <span
              className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: c.shared ? '#00C8E8' : '#B8863A' }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="font-data text-[11px] leading-snug text-cream/90 break-words">
                <span className="text-gold">{c.source}</span>
                {c.section ? <span className="text-cream/60"> — {c.section}</span> : null}
              </p>
              <p className="font-data text-[10px] text-cream/40">
                {c.shared ? 'Legislation' : 'Venue SOP'}
                {typeof c.confidence === 'number' && (
                  <span className="text-cyan"> · match {Math.round(c.confidence * 100)}%</span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
