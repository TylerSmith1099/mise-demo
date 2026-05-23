// TopBar — the persistent header. Shows the white-label (brand) name, the
// venue name + state, and the signed-in role. ALL of it comes from
// GET /api/session (the verified token's session), never hardcoded.
//
// Data shape (props.session):
//   { whiteLabelName, venueName, venueState, role, roleTier, staffName }
import React from 'react';

export default function TopBar({ session, onLogout }) {
  const venueLine = session
    ? `${session.venueName} · ${session.venueState}`
    : '—';
  return (
    <header
      className="shrink-0 border-b border-hairline bg-charcoal px-4"
      style={{ paddingTop: 'calc(var(--safe-top) + 0.75rem)', paddingBottom: '0.75rem' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {/* Brand / white-label name — gold, the product identity. */}
          <h1 className="truncate text-lg font-bold tracking-tight text-gold">
            {session?.whiteLabelName || 'Mise'}
          </h1>
          {/* Venue + state in mono (it's data). */}
          <p className="truncate font-data text-xs text-cyan">{venueLine}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Role chip — derived from the token, not selectable here. */}
          {session?.role && (
            <span className="rounded-full border border-gold/40 px-2.5 py-1 text-[11px] font-semibold text-cream/90">
              {session.role}
            </span>
          )}
          <button
            type="button"
            onClick={onLogout}
            aria-label="Log out"
            className="grid h-11 w-11 place-items-center rounded-full text-cream/60 transition-colors hover:text-cream active:text-gold"
          >
            {/* logout glyph */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15 12H4m0 0 3.5-3.5M4 12l3.5 3.5M14 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
