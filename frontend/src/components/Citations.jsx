// Citations — sources panel shown beneath a Mise answer.
// Displays document name + confidence score only; deduplicates by source name
// so the same document does not appear multiple times.
//
// Props: { citations: [{ source, section, confidence, shared }] }
import React from 'react';

export default function Citations({ citations }) {
  if (!citations?.length) return null;

  // Deduplicate by source name — keep highest-confidence entry for each document.
  const seen = new Map();
  for (const c of citations) {
    const existing = seen.get(c.source);
    if (!existing || c.confidence > existing.confidence) {
      seen.set(c.source, c);
    }
  }
  const unique = Array.from(seen.values());

  return (
    <div className="mt-2 border-t border-hairline pt-2">
      <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-cream/40">
        Sources
      </p>
      <ul className="flex flex-col gap-1">
        {unique.map((c) => (
          <li key={c.source} className="flex items-center justify-between gap-2">
            <span className="font-data text-[12px] leading-snug text-gold break-words min-w-0">
              {c.source}
            </span>
            {typeof c.confidence === 'number' && (
              <span className="font-data text-[12px] text-cream/40 shrink-0 tabular-nums">
                {Math.round(c.confidence * 100)}%
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
