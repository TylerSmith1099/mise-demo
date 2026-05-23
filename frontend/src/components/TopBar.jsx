// TopBar — Option A spec (MIS-230). Persistent 44px header.
// Layout: MISE logotype (gold, Playfair) | venue name (cream italic, centred) | hamburger
// All content from GET /api/session — never hardcoded.
//
// Props:
//   session: { whiteLabelName, venueName, venueState, role, roleTier, staffName }
//   onMenuToggle(): opens/closes the slide-out panel
import React from 'react';

export default function TopBar({ session, onMenuToggle }) {
  return (
    <header
      style={{
        height: 44,
        background: 'var(--charcoal)',
        borderBottom: '1px solid var(--gold-25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <span
        style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          flexShrink: 0,
        }}
      >
        {session?.whiteLabelName || 'MISE'}
      </span>

      <span
        style={{
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: 14,
          fontStyle: 'italic',
          color: 'var(--cream-60)',
          flex: 1,
          textAlign: 'center',
          padding: '0 8px',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        {session ? session.venueName : '—'}
      </span>

      <button
        type="button"
        onClick={onMenuToggle}
        aria-label="Open menu"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          minHeight: 'unset',
          flexShrink: 0,
        }}
      >
        <span style={{ display: 'block', width: 20, height: 1.5, background: 'var(--cream-60)', borderRadius: 1 }} />
        <span style={{ display: 'block', width: 20, height: 1.5, background: 'var(--cream-60)', borderRadius: 1 }} />
        <span style={{ display: 'block', width: 20, height: 1.5, background: 'var(--cream-60)', borderRadius: 1 }} />
      </button>
    </header>
  );
}
