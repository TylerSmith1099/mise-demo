// SlideOut — hamburger slide-out panel (Option A spec, MIS-230).
// Opens from the right edge. Shows user name, role, venue, secondary nav, sign out.
// All identity from session — nothing hardcoded.
//
// Props:
//   open: bool
//   session: { whiteLabelName, venueName, venueState, role, staffName }
//   onClose(): dismiss the panel
//   onLogout(): end the session
import React, { useEffect } from 'react';

export default function SlideOut({ open, session, onClose, onLogout }) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const displayName = session?.staffName || '—';
  const role = session?.role || '—';
  const venue = session?.venueName || '—';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28, 22, 18, 0.85)',
        zIndex: 200,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {/* Panel — stop click propagation so tapping panel doesn't close */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 240,
          height: '100%',
          background: '#231e19',
          borderLeft: '1px solid var(--gold-25)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Header — logotype + user identity */}
        <div
          style={{
            padding: '52px 24px 24px',
            borderBottom: '1px solid var(--gold-15)',
          }}
        >
          <p
            style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginBottom: 20,
              margin: '0 0 20px',
            }}
          >
            {session?.whiteLabelName || 'MISE'}
          </p>
          <p
            style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: 16,
              fontWeight: 500,
              color: 'var(--cream)',
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            {displayName}
          </p>
          <p
            style={{
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginTop: 3,
              marginBottom: 2,
            }}
          >
            {role}
          </p>
          <p
            style={{
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: 12,
              color: 'var(--cream-40)',
              margin: 0,
            }}
          >
            {venue}
          </p>
        </div>

        {/* Secondary nav */}
        <nav style={{ flex: 1, padding: '16px 0' }}>
          {['Settings', 'Help', 'About Mise'].map((item) => (
            <button
              key={item}
              type="button"
              onClick={onClose}
              style={{
                display: 'block',
                padding: '12px 24px',
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: 13,
                fontWeight: 400,
                color: 'var(--cream-60)',
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                width: '100%',
                textAlign: 'left',
                minHeight: 44,
              }}
            >
              {item}
            </button>
          ))}
        </nav>

        {/* Sign out */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--gold-15)',
          }}
        >
          <button
            type="button"
            onClick={onLogout}
            style={{
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--red)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              letterSpacing: '0.02em',
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
