// ConfidenceIndicator — shown on a Mise answer when retrieval flagged it
// uncertain (lowConfidence === true, i.e. top score < the 0.60 floor). Surfaced,
// never hidden: it tells the user to verify before acting. Amber = warning.
//
// Props: { confidence: number 0..1, floor: number, lowConfidence: bool }
import React from 'react';

export default function ConfidenceIndicator({ confidence, floor = 0.6, lowConfidence }) {
  if (!lowConfidence) return null;
  const pct = Math.round((confidence ?? 0) * 100);
  return (
    <div
      className="mt-2 flex items-center gap-2 rounded-md border border-amber/40 bg-amber/10 px-2.5 py-1.5"
      role="status"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
        <path
          d="M12 9v4m0 4h.01M10.3 3.9 2.4 17.1A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"
          stroke="#E8A020"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[11px] font-semibold text-amber">Low confidence — verify before acting</span>
      <span className="ml-auto font-data text-[11px] text-amber/90">{pct}%</span>
    </div>
  );
}
