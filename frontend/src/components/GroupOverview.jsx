/**
 * GroupOverview — MIS-467
 *
 * Full-page estate-level roll-up view for admin desktop.
 * Mirrors the AdminReportingScreen pattern: own sidebar + topbar so it can
 * replace AdminDesktopHomepage when "Group Overview" nav item is active.
 *
 * Data shape (from GET /api/admin/group-overview):
 *   summary: { totalRevenueCents, openComplianceCount, venuesInRed,
 *              labourSummary: { onTarget, overTarget, noData } }
 *   venues:  Array<{
 *     venueId, venueName, status ("clear"|"attention"|"critical"),
 *     weeklyRevenueCents, weeklyRevenueDeltaPct,
 *     complianceAlertCount, complianceHighestSeverity,
 *     labourStatus ("on-target"|"over-target"|"no-data"),
 *     labourOverHours, activeCriticalFlags, openIncidentCount
 *   }>
 *
 * Layout:
 *   ≥1280px — full-width table (venue | revenue | compliance | labour | flags | →)
 *   768–1279px — card-per-venue (name + 4-col metrics grid)
 *   <768px — stacked cards
 *
 * Brand: Deep Meridian LOCKED (MIS-410, MIS-463).
 */

import React, { useState } from 'react';

// ─── Design tokens (Deep Meridian, matches AdminDesktopHomepage.jsx) ─────────
const T = {
  bg:           '#090F1A',
  surface1:     '#0E1E32',
  surface2:     '#162840',
  sidebar:      '#060C15',
  text:         '#E0EEFF',
  textSub:      '#7AAAD0',
  textMuted:    '#3A6090',
  textDim:      '#1E3854',
  copperMain:   '#B87A3C',
  copperBorder: 'rgba(184,122,60,0.22)',
  copperGlow:   'rgba(184,122,60,0.10)',
  borderBlue:   'rgba(46,107,174,0.20)',
  borderBlueSm: 'rgba(46,107,174,0.12)',
  blueGlow:     'rgba(46,107,174,0.10)',
  cyan:         '#00C8E8',
  mint:         '#00E87A',
  red:          '#E85050',
  amber:        '#E8A020',
  cyanBg:       'rgba(0,200,232,0.10)',
  mintBg:       'rgba(0,232,122,0.10)',
  redBg:        'rgba(232,80,80,0.10)',
  amberBg:      'rgba(232,160,32,0.10)',
};

const FONTS = {
  display: "'Space Grotesk', system-ui, sans-serif",
  ui:      "'DM Sans', system-ui, sans-serif",
  mono:    "'IBM Plex Mono', 'Courier New', monospace",
};

// ─── CSS (injected once) ─────────────────────────────────────────────────────
const GROUP_CSS = `
  @keyframes pulse-red-venue {
    0%,100% { box-shadow: 0 0 0 0 rgba(232,80,80,0.45); }
    50%      { box-shadow: 0 0 0 6px rgba(232,80,80,0); }
  }
  @keyframes pulse-dot-red {
    0%,100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }
  .venue-row-crit { animation: pulse-red-venue 2s ease-in-out infinite; }
  .status-dot-crit { animation: pulse-dot-red 1.5s ease-in-out infinite; }
  .group-venue-row:hover { background: rgba(255,255,255,0.025) !important; }
  .drill-arrow:hover { color: ${T.text} !important; background: ${T.blueGlow} !important; border-color: rgba(46,107,174,0.40) !important; }
  .group-kpi-card:hover { border-color: rgba(46,107,174,0.40) !important; }
  .group-nav-item:hover { background: rgba(46,107,174,0.06); color: ${T.textSub}; }
  .group-nav-item:focus-visible { outline: 2px solid rgba(46,107,174,0.50); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }

  /* Sidebar collapse at tablet */
  @media (min-width: 768px) and (max-width: 1279px) {
    .go-sidebar { width: 52px !important; }
    .go-sidebar-label, .go-sidebar-tagline, .go-nav-label { display: none !important; }
    .go-nav-item-inner { justify-content: center !important; padding: 9px !important; }
    .go-kpi-strip { grid-template-columns: repeat(2, 1fr) !important; }
    .go-table-head { display: none !important; }
    .go-venue-desk-cells { display: none !important; }
    .go-venue-tablet-grid { display: grid !important; }
  }
  @media (max-width: 767px) {
    .go-sidebar { display: none !important; }
    .go-kpi-strip { grid-template-columns: repeat(2, 1fr) !important; }
    .go-table-head { display: none !important; }
    .go-venue-desk-cells { display: none !important; }
    .go-venue-tablet-grid { display: grid !important; }
  }
  @media (min-width: 1280px) {
    .go-venue-tablet-grid { display: none !important; }
  }
  .go-transition { transition: all 0.15s ease; }
`;

// ─── Nav icons ─────────────────────────────────────────────────────────────────
const NAV_ICONS = {
  'Group Overview': <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="6" height="5" rx="1"/><rect x="9" y="1" width="6" height="5" rx="1"/><rect x="1" y="10" width="6" height="5" rx="1"/><rect x="9" y="10" width="6" height="5" rx="1"/><line x1="4" y1="6" x2="8" y2="8"/><line x1="12" y1="6" x2="8" y2="8"/></svg>,
  Dashboard:    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>,
  Roster:       <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="11" rx="1"/><path d="M5 1v4M11 1v4M2 7h12"/></svg>,
  Reports:      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2h10v12H3zM6 6h4M6 9h4M6 12h2"/></svg>,
  Staff:        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.314 2.686-6 6-6s6 2.686 6 6"/></svg>,
  Forecasting:  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="1,12 5,7 8,9 12,4 15,6"/></svg>,
  Budgets:      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 4v1.5M8 10.5V12M5.5 6.5c0-1.1.895-2 2-2H9a1.5 1.5 0 010 3H7a1.5 1.5 0 000 3h1.5a2 2 0 002-2"/></svg>,
  Compliance:   <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1L2 4v4c0 3.3 2.7 6.4 6 7 3.3-.6 6-3.7 6-7V4L8 1z"/><polyline points="5,8 7,10 11,6"/></svg>,
  Settings:     <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41"/></svg>,
  Admin:        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="8" width="12" height="6" rx="1"/><path d="M5 8V5a3 3 0 016 0v3"/></svg>,
};

const MAIN_NAV   = ['Group Overview', 'Dashboard', 'Roster', 'Reports', 'Staff', 'Forecasting', 'Budgets'];
const BOTTOM_NAV = ['Compliance', 'Settings', 'Admin'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtCents(cents) {
  if (cents == null || cents === 0) return '—';
  return '$' + Math.round(cents / 100).toLocaleString('en-AU');
}

function fmtDelta(pct) {
  if (pct == null) return null;
  return (pct >= 0 ? '+' : '') + pct + '%';
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ activeNav, onNavChange, dmName, dmRole }) {
  const initials = (dmName || '').split(' ').map((n) => n[0]).slice(0, 2).join('');

  const NavItem = ({ label }) => {
    const isActive = label === activeNav;
    const isGroup  = label === 'Group Overview';
    const col = isActive ? (isGroup ? T.cyan : T.copperMain) : T.textMuted;
    const bg  = isActive ? (isGroup ? T.cyanBg : T.copperGlow) : 'transparent';
    const bar = isActive ? (isGroup ? T.cyan : T.copperMain) : 'transparent';
    return (
      <button
        className="group-nav-item go-transition"
        onClick={() => onNavChange(label)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 20px', width: '100%', border: 'none',
          background: bg, cursor: 'pointer', textAlign: 'left',
          fontFamily: FONTS.ui, fontWeight: isActive ? 500 : 400,
          fontSize: 13, color: col,
          borderLeft: `3px solid ${bar}`, borderRadius: '0 2px 2px 0',
        }}
        aria-current={isActive ? 'page' : undefined}
      >
        <span className="go-nav-icon" style={{ color: col, flexShrink: 0 }}>{NAV_ICONS[label]}</span>
        <span className="go-nav-label">{label}</span>
      </button>
    );
  };

  return (
    <aside className="go-sidebar" style={{
      width: 200, flexShrink: 0,
      background: 'linear-gradient(180deg, #0E2A45 0%, #060C15 60%)',
      borderRight: `1px solid ${T.borderBlue}`,
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 20px 16px' }}>
        <div className="go-sidebar-label" style={{
          fontFamily: FONTS.display, fontWeight: 700, fontSize: 22,
          color: T.copperMain, letterSpacing: '0.12em',
        }}>MISE</div>
        <div className="go-sidebar-tagline" style={{
          fontFamily: FONTS.ui, fontWeight: 300, fontSize: 10,
          color: '#5A9BD4', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2,
        }}>Venue Intelligence</div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto' }}>
        {MAIN_NAV.map((item, i) => (
          <React.Fragment key={item}>
            {i === 1 && <div style={{ height: 1, background: T.borderBlueSm, margin: '4px 12px' }} />}
            <NavItem label={item} />
          </React.Fragment>
        ))}
      </nav>

      {/* Bottom nav + user */}
      <div style={{ borderTop: `1px solid ${T.borderBlue}`, paddingTop: 4, paddingBottom: 8 }}>
        {BOTTOM_NAV.map((item) => <NavItem key={item} label={item} />)}
      </div>
      {dmName && (
        <div style={{
          padding: '10px 16px', borderTop: `1px solid ${T.borderBlueSm}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: `linear-gradient(135deg, #2E6BAE, #1E4A7A)`,
            color: T.text, fontFamily: FONTS.ui, fontWeight: 600, fontSize: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>{initials}</div>
          <div className="go-sidebar-label" style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dmName}</div>
            <div style={{ fontFamily: FONTS.ui, fontSize: 10, color: T.textMuted }}>{dmRole}</div>
          </div>
        </div>
      )}
    </aside>
  );
}

// ─── Topbar ───────────────────────────────────────────────────────────────────

function Topbar({ groupName, notifCount = 0, now }) {
  const dt = (now || new Date()).toLocaleDateString('en-AU', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }) + ' · ' + (now || new Date()).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <header style={{
      height: 56, flexShrink: 0,
      background: 'linear-gradient(135deg, #0E2A45 0%, #090F1A 70%)',
      borderBottom: `1px solid ${T.borderBlue}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', gap: 12,
    }}>
      {/* Group chip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: T.cyanBg, border: `1px solid rgba(0,200,232,0.25)`, borderRadius: 4,
        padding: '5px 12px',
      }}>
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={T.cyan} strokeWidth="1.5">
          <rect x="1" y="1" width="6" height="5" rx="1"/><rect x="9" y="1" width="6" height="5" rx="1"/>
          <rect x="1" y="10" width="6" height="5" rx="1"/><rect x="9" y="10" width="6" height="5" rx="1"/>
          <line x1="4" y1="6" x2="8" y2="8"/><line x1="12" y1="6" x2="8" y2="8"/>
        </svg>
        <span style={{ fontFamily: FONTS.ui, fontWeight: 500, fontSize: 13, color: T.cyan }}>
          {groupName || 'Group Overview'}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Date/time */}
      <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: T.textMuted, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
        {dt}
      </div>

      {/* Bell */}
      <button
        aria-label={`${notifCount} notifications`}
        className="go-transition"
        style={{
          width: 36, height: 36, borderRadius: 4, background: 'transparent',
          border: 'none', cursor: 'pointer', position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={T.textMuted} strokeWidth="1.5">
          <path d="M9 2a5 5 0 00-5 5v3l-1.5 2H15.5L14 10V7A5 5 0 009 2z"/>
          <path d="M7 14a2 2 0 004 0"/>
        </svg>
        {notifCount > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4, width: 16, height: 16,
            borderRadius: '50%', background: T.amber, color: T.bg,
            fontFamily: FONTS.ui, fontWeight: 600, fontSize: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{notifCount}</span>
        )}
      </button>
    </header>
  );
}

// ─── KPI strip ────────────────────────────────────────────────────────────────

function KpiStrip({ summary }) {
  const { totalRevenueCents, openComplianceCount, venuesInRed, labourSummary = {} } = summary;
  const { onTarget = 0, overTarget = 0 } = labourSummary;

  const kpis = [
    {
      label: 'Total Revenue (Week)',
      value: fmtCents(totalRevenueCents),
      accent: T.cyan, sub: 'all venues',
    },
    {
      label: 'Open Compliance Items',
      value: String(openComplianceCount),
      accent: openComplianceCount > 0 ? T.amber : T.mint,
      sub: openComplianceCount > 0 ? 'needs attention' : 'all clear',
    },
    {
      label: 'Venues in RED',
      value: String(venuesInRed),
      accent: venuesInRed > 0 ? T.red : T.mint,
      sub: venuesInRed > 0 ? 'critical status' : 'all clear',
    },
    {
      label: 'Labour Status',
      value: overTarget > 0 ? `${overTarget} over` : 'All on target',
      accent: overTarget > 0 ? T.amber : T.mint,
      sub: `${onTarget} on target`,
    },
  ];

  return (
    <div className="go-kpi-strip" style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20,
    }}>
      {kpis.map((kpi, i) => (
        <div
          key={i}
          role="region"
          aria-label={`${kpi.label}: ${kpi.value}`}
          className="group-kpi-card go-transition"
          style={{
            background: T.surface1, border: `1px solid ${T.borderBlue}`,
            borderRadius: 6, overflow: 'hidden', fontVariantNumeric: 'tabular-nums',
          }}
        >
          <div style={{ height: 2, background: kpi.accent }} />
          <div style={{ padding: 16 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 6 }}>{kpi.label}</div>
            <div style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 'clamp(16px, 2vw, 28px)', color: kpi.accent, letterSpacing: '0.05em', lineHeight: 1.1, marginBottom: 4 }}>{kpi.value}</div>
            <div style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.textMuted }}>{kpi.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Severity chip ─────────────────────────────────────────────────────────────

function SevChip({ sev }) {
  if (!sev) return null;
  const crit = sev === 'critical';
  return (
    <span style={{
      fontFamily: FONTS.mono, fontWeight: 600, fontSize: 9, letterSpacing: '0.04em',
      padding: '2px 5px', borderRadius: 3,
      background: crit ? T.redBg : T.amberBg,
      color: crit ? T.red : T.amber,
      border: `1px solid ${crit ? 'rgba(232,80,80,0.35)' : 'rgba(232,160,32,0.35)'}`,
      marginLeft: 4, textTransform: 'uppercase',
    }}>{crit ? 'CRIT' : 'WARN'}</span>
  );
}

// ─── Tablet metric card ────────────────────────────────────────────────────────

function MCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: T.surface2, border: `1px solid ${T.borderBlueSm}`,
      borderRadius: 4, padding: '8px 10px',
    }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 15, color: color || T.text, letterSpacing: '0.05em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontFamily: FONTS.ui, fontSize: 10, color: T.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Venue table ─────────────────────────────────────────────────────────────

function VenueTable({ venues, onDrillIn }) {
  const thSt = {
    fontFamily: FONTS.mono, fontWeight: 400, fontSize: 10, color: T.textMuted,
    textTransform: 'uppercase', letterSpacing: '0.10em',
    padding: '10px 16px', textAlign: 'left',
    borderBottom: `1px solid ${T.borderBlue}`,
    background: T.surface2,
  };
  const COLS = '2fr 1fr 1fr 1fr 60px 44px';

  return (
    <div style={{
      background: T.surface1, border: `1px solid ${T.borderBlue}`, borderRadius: 6, overflow: 'hidden',
    }}>
      {/* Desktop header */}
      <div className="go-table-head" style={{ display: 'grid', gridTemplateColumns: COLS }}>
        {['Venue', 'Weekly Revenue', 'Compliance', 'Labour', 'Flags', ''].map((col, i) => (
          <div key={i} style={thSt}>{col}</div>
        ))}
      </div>

      {venues.map((v, idx) => {
        const crit     = v.status === 'critical';
        const isLast   = idx === venues.length - 1;
        const delta    = fmtDelta(v.weeklyRevenueDeltaPct);
        const deltaCol = (v.weeklyRevenueDeltaPct || 0) >= 0 ? T.mint : T.red;
        const labOver  = v.labourStatus === 'over-target';
        const labNone  = v.labourStatus === 'no-data';

        return (
          <div key={v.venueId}>
            {/* Desktop row */}
            <div
              className={`group-venue-row go-transition${crit ? ' venue-row-crit' : ''}`}
              style={{
                display: 'grid', gridTemplateColumns: COLS, alignItems: 'center',
                borderLeft: crit ? `3px solid ${T.red}` : '3px solid transparent',
                background: crit ? 'rgba(232,80,80,0.04)' : 'transparent',
                borderBottom: isLast ? 'none' : `1px solid ${T.borderBlueSm}`,
                cursor: 'pointer',
              }}
              onClick={() => onDrillIn && onDrillIn(v.venueId)}
              role="row"
            >
              {/* Name */}
              <div className="go-venue-desk-cells" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className={crit ? 'status-dot-crit' : ''}
                  style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                    background: crit ? T.red : v.status === 'attention' ? T.amber : T.mint,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontFamily: FONTS.ui, fontWeight: 600, fontSize: 13, color: crit ? '#ff8080' : T.text }}>
                  {v.venueName}
                </span>
              </div>

              {/* Revenue */}
              <div className="go-venue-desk-cells" style={{ padding: '12px 16px' }}>
                <div style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 13, color: T.text, letterSpacing: '0.05em', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCents(v.weeklyRevenueCents)}
                </div>
                {delta && <div style={{ fontFamily: FONTS.ui, fontSize: 10, color: deltaCol, marginTop: 2 }}>{delta} vs forecast</div>}
              </div>

              {/* Compliance */}
              <div className="go-venue-desk-cells" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center' }}>
                {v.complianceAlertCount > 0 ? (
                  <>
                    <span style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 13, color: T.text }}>{v.complianceAlertCount}</span>
                    <SevChip sev={v.complianceHighestSeverity} />
                  </>
                ) : (
                  <span style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.mint }}>✓ Clear</span>
                )}
              </div>

              {/* Labour */}
              <div className="go-venue-desk-cells" style={{ padding: '12px 16px' }}>
                {labNone ? (
                  <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: T.textMuted }}>—</span>
                ) : (
                  <span style={{
                    fontFamily: FONTS.ui, fontWeight: 500, fontSize: 11,
                    padding: '2px 7px', borderRadius: 10,
                    background: labOver ? T.redBg : T.mintBg,
                    color: labOver ? T.red : T.mint,
                  }}>
                    {labOver ? `+${(v.labourOverHours || 0).toFixed(1)}h over` : 'On target'}
                  </span>
                )}
              </div>

              {/* Flags */}
              <div className="go-venue-desk-cells" style={{ padding: '12px 16px', textAlign: 'center' }}>
                {v.activeCriticalFlags > 0 ? (
                  <span style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 13, color: T.red }}>{v.activeCriticalFlags}</span>
                ) : (
                  <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: T.textMuted }}>—</span>
                )}
              </div>

              {/* Drill-in */}
              <div className="go-venue-desk-cells" style={{ padding: '12px 8px', textAlign: 'center' }}>
                <button
                  className="drill-arrow go-transition"
                  aria-label={`View ${v.venueName} dashboard`}
                  onClick={(e) => { e.stopPropagation(); onDrillIn && onDrillIn(v.venueId); }}
                  style={{
                    background: 'transparent', border: `1px solid ${T.borderBlue}`,
                    borderRadius: 4, width: 28, height: 28, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: T.textSub, fontSize: 14, fontFamily: FONTS.ui,
                  }}
                >→</button>
              </div>
            </div>

            {/* Tablet / mobile: venue name + 4-col grid */}
            <div className="go-venue-tablet-grid" style={{
              display: 'none',
              borderBottom: isLast ? 'none' : `1px solid ${T.borderBlueSm}`,
            }}>
              {/* Name row */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '12px 16px 6px',
                  borderLeft: crit ? `3px solid ${T.red}` : '3px solid transparent',
                  background: crit ? 'rgba(232,80,80,0.04)' : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => onDrillIn && onDrillIn(v.venueId)}
              >
                <span
                  className={crit ? 'status-dot-crit' : ''}
                  style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                    background: crit ? T.red : v.status === 'attention' ? T.amber : T.mint,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontFamily: FONTS.ui, fontWeight: 600, fontSize: 13, color: crit ? '#ff8080' : T.text, flex: 1 }}>
                  {v.venueName}
                </span>
                <span style={{ color: T.textSub, fontSize: 14, fontFamily: FONTS.ui }}>→</span>
              </div>

              {/* Metrics grid */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
                padding: '0 16px 12px',
                borderLeft: crit ? `3px solid ${T.red}` : '3px solid transparent',
                background: crit ? 'rgba(232,80,80,0.04)' : 'transparent',
              }}>
                <MCard label="Revenue" value={fmtCents(v.weeklyRevenueCents)} sub={delta ? `${delta} forecast` : undefined} color={delta && v.weeklyRevenueDeltaPct < 0 ? T.red : T.text} />
                <MCard label="Compliance" value={v.complianceAlertCount > 0 ? String(v.complianceAlertCount) : '✓'} sub={v.complianceHighestSeverity || 'clear'} color={v.complianceAlertCount > 0 ? (v.complianceHighestSeverity === 'critical' ? T.red : T.amber) : T.mint} />
                <MCard label="Labour" value={labOver ? `+${(v.labourOverHours || 0).toFixed(1)}h` : labNone ? '—' : '✓'} sub={labOver ? 'over budget' : labNone ? 'no data' : 'on target'} color={labOver ? T.red : labNone ? T.textMuted : T.mint} />
                <MCard label="Flags" value={v.activeCriticalFlags > 0 ? String(v.activeCriticalFlags) : '—'} sub={v.activeCriticalFlags > 0 ? 'critical' : 'none'} color={v.activeCriticalFlags > 0 ? T.red : T.textMuted} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Critical banner ──────────────────────────────────────────────────────────

function CritBanner({ venues }) {
  const crit = venues.filter((v) => v.status === 'critical');
  if (!crit.length) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="venue-row-crit"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', marginBottom: 16,
        background: T.redBg, border: `1px solid rgba(232,80,80,0.35)`, borderRadius: 6,
      }}
    >
      <span className="status-dot-crit" style={{ width: 8, height: 8, borderRadius: '50%', background: T.red, flexShrink: 0 }} />
      <span style={{ fontFamily: FONTS.ui, fontWeight: 600, fontSize: 12, color: T.red }}>
        {crit.length === 1
          ? `${crit[0].venueName} is in critical status`
          : `${crit.length} venues in critical status`}
      </span>
      <span style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.textSub }}>
        — {crit.map((v) => v.venueName).join(', ')}
      </span>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * GroupOverview
 *
 * Full-page component. Renders own sidebar + topbar (mirrors AdminReportingScreen pattern).
 *
 * @param {{ summary, venues }}  data       From GET /api/admin/group-overview
 * @param {function}             onNavChange (navLabel) → called when user clicks nav item
 * @param {function}             onDrillIn  (venueId) → drill into single-venue dashboard
 * @param {string}               groupName  Display name for the group
 * @param {string}               dmName     Logged-in user's name
 * @param {string}               dmRole     Logged-in user's role label
 * @param {number}               notifCount Notification count for bell
 */
export default function GroupOverview({
  data,
  onNavChange,
  onDrillIn,
  groupName  = 'Pinnacle Hotel Group',
  dmName     = '',
  dmRole     = '',
  notifCount = 0,
  loading    = false,
  onRetry    = null,
}) {
  const [now] = useState(new Date());
  const { summary, venues } = data;
  const critCount = venues.filter((v) => v.status === 'critical').length;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: GROUP_CSS }} />
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: T.bg }}>

        <Sidebar activeNav="Group Overview" onNavChange={onNavChange} dmName={dmName} dmRole={dmRole} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Topbar groupName={groupName} notifCount={notifCount} now={now} />

          <main style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 32px' }}>

            {/* Loading state */}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                <p style={{ fontFamily: FONTS.ui, fontSize: 13, color: T.textMuted }}>Loading group overview…</p>
              </div>
            )}

            {/* Error/empty state */}
            {!loading && !groupName && onRetry && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 0' }}>
                <p style={{ fontFamily: FONTS.ui, fontSize: 13, color: T.textMuted, textAlign: 'center', margin: 0 }}>
                  Could not load group overview.
                </p>
                <button onClick={onRetry} style={{
                  fontFamily: FONTS.ui, fontSize: 12,
                  background: 'transparent', border: `1px solid ${T.borderBlue}`,
                  color: T.copperMain, borderRadius: 4, padding: '6px 16px', cursor: 'pointer',
                }}>Retry</button>
              </div>
            )}

            {/* Page header */}
            <div style={{
              marginBottom: 20, display: 'flex',
              alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
            }}>
              <div>
                <h1 style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 26, color: T.text, margin: 0, marginBottom: 4, letterSpacing: '-0.01em' }}>
                  Group Overview
                </h1>
                <p style={{ fontFamily: FONTS.ui, fontSize: 13, color: T.textSub, margin: 0 }}>
                  {groupName} · {venues.length} venue{venues.length !== 1 ? 's' : ''}
                </p>
              </div>
              {critCount > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: T.redBg, color: T.red,
                  fontFamily: FONTS.ui, fontWeight: 600, fontSize: 12,
                  padding: '4px 10px', borderRadius: 20,
                }}>
                  <span className="status-dot-crit" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                  {critCount} Critical
                </span>
              )}
            </div>

            {/* Critical banner */}
            <CritBanner venues={venues} />

            {/* KPI strip */}
            <KpiStrip summary={summary} />

            {/* Table heading */}
            <div style={{
              marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.10em' }}>
                All Venues · Weekly Summary
              </span>
              <span style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.textMuted }}>
                Click a row to drill in →
              </span>
            </div>

            {venues.length === 0 ? (
              <div style={{
                background: T.surface1, border: `1px solid ${T.borderBlue}`,
                borderRadius: 6, padding: '32px 24px', textAlign: 'center',
              }}>
                <p style={{ fontFamily: FONTS.ui, fontSize: 13, color: T.textMuted, margin: 0 }}>
                  No venues in scope. Contact your administrator.
                </p>
              </div>
            ) : (
              <VenueTable venues={venues} onDrillIn={onDrillIn} />
            )}
          </main>
        </div>
      </div>
    </>
  );
}
