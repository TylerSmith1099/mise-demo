/**
 * Admin Desktop Homepage — V1
 * Output of MIS-413 (UI Agent). Design spec: MIS-410.
 *
 * Data layer: all sample data flows through props so the technical track
 * (MIS-411 / MIS-412) can wire live API data without rebuilding the component.
 *
 * Usage (sample data):
 *   import AdminHomepage, { SAMPLE_DATA } from './Admin-Desktop-Homepage-V1';
 *   <AdminHomepage {...SAMPLE_DATA} />
 */

import React, { useState, useEffect } from 'react';

// ─── Design tokens ───────────────────────────────────────────────────────────
const T = {
  bg:         '#1C1612',
  card:       '#251E18',
  cardHover:  '#2C2219',
  sidebar:    '#140F0B',
  text:       '#F5EFE4',
  textMuted:  'rgba(245,239,228,0.45)',
  textDim:    'rgba(245,239,228,0.25)',
  gold:       '#B8863A',
  goldBorder: 'rgba(184,134,58,0.18)',
  goldLight:  'rgba(184,134,58,0.12)',
  goldActive: 'rgba(184,134,58,0.22)',
  cyan:       '#00C8E8',
  mint:       '#00E87A',
  red:        '#E85050',
  amber:      '#E8A020',
  cyanBg:     'rgba(0,200,232,0.10)',
  mintBg:     'rgba(0,232,122,0.10)',
  redBg:      'rgba(232,80,80,0.10)',
  amberBg:    'rgba(232,160,32,0.10)',
};

const FONTS = {
  display: "'Playfair Display', Georgia, serif",
  ui:      "'DM Sans', system-ui, sans-serif",
  mono:    "'IBM Plex Mono', 'Courier New', monospace",
};

// ─── Inline styles helpers ────────────────────────────────────────────────────
const cardBase = {
  background:   T.card,
  border:       `1px solid ${T.goldBorder}`,
  borderRadius: 6,
  boxShadow:    '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
};

// ─── Global CSS (injected once) ───────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;600&family=DM+Sans:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body { background: ${T.bg}; color: ${T.text}; font-family: ${FONTS.ui}; }

  :focus-visible { outline: 2px solid rgba(184,134,58,0.5); outline-offset: 2px; }

  @keyframes pulse-red {
    0%,100% { box-shadow: 0 0 0 0 rgba(232,80,80,0.4); }
    50%      { box-shadow: 0 0 0 6px rgba(232,80,80,0); }
  }
  @keyframes fade-in-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .admin-content { animation: fade-in-up 0.25s ease-out; }
  .incident-l4   { animation: pulse-red 2s ease-in-out infinite; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }

  .nav-item:hover  { background: rgba(255,255,255,0.04); color: ${T.text}; }
  .nav-item:focus  { outline: 2px solid ${T.goldBorder}; }
  .panel-row:hover { background: rgba(255,255,255,0.02); }
  .kpi-card:hover  { border-color: ${T.gold}; }
  .venue-sel:hover { border-color: ${T.gold}; }
  .venue-sel:focus { outline: 2px solid rgba(184,134,58,0.3); }
  .bell-btn:hover  { background: ${T.goldLight}; }
  .btn-primary:hover  { opacity: 0.90; }
  .btn-primary:focus  { outline: 2px solid rgba(184,134,58,0.4); }
  .btn-secondary:hover { border-color: ${T.gold}; background: ${T.goldLight}; }
  .btn-secondary:focus { outline: 2px solid rgba(184,134,58,0.3); }
  .action-btn:hover { background: ${T.goldLight}; }
  .action-btn:focus { outline: 1px solid ${T.gold}; }

  /* tablet sidebar collapse */
  @media (min-width: 768px) and (max-width: 1279px) {
    .sidebar { width: 52px !important; }
    .sidebar-label, .sidebar-tagline, .nav-label { display: none; }
    .nav-item { justify-content: center; padding: 9px !important; }
    .kpi-strip { grid-template-columns: repeat(3, 1fr) !important; }
    .dashboard-grid { grid-template-columns: repeat(2, 1fr) !important; }
    .sidebar-logo { font-size: 14px !important; letter-spacing: 0.04em !important; }
  }
  @media (max-width: 767px) {
    .sidebar { display: none !important; }
    .kpi-strip { grid-template-columns: repeat(2, 1fr) !important; }
    .dashboard-grid { grid-template-columns: 1fr !important; }
  }

  .transition { transition: all 0.15s ease; }
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityBadge({ level }) {
  const isRed = level === 'L3' || level === 'L4';
  return (
    <span style={{
      fontFamily:    FONTS.ui,
      fontWeight:    700,
      fontSize:      9,
      letterSpacing: '0.04em',
      padding:       '2px 6px',
      borderRadius:  3,
      background:    isRed ? T.redBg  : T.amberBg,
      color:         isRed ? T.red    : T.amber,
      border:        `1px solid ${level === 'L4' ? 'rgba(232,80,80,0.50)' : isRed ? 'rgba(232,80,80,0.30)' : 'rgba(232,160,32,0.30)'}`,
    }}>
      {level}
    </span>
  );
}

function StatusPill({ state }) {
  const map = {
    clear:     { bg: T.mintBg,  color: T.mint,  label: 'All Clear' },
    attention: { bg: T.amberBg, color: T.amber, label: 'Attention' },
    critical:  { bg: T.redBg,   color: T.red,   label: 'Critical'  },
  };
  const { bg, color, label } = map[state] || map.clear;
  return (
    <span role="status" style={{
      display:       'inline-flex',
      alignItems:    'center',
      gap:           6,
      background:    bg,
      color,
      fontFamily:    FONTS.ui,
      fontWeight:    500,
      fontSize:      12,
      padding:       '4px 10px',
      borderRadius:  20,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
      {label}
    </span>
  );
}

function StaffAvatar({ name, size = 24 }) {
  const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('');
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: T.goldLight, border: `1px solid ${T.goldBorder}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONTS.ui, fontWeight: 600, fontSize: size * 0.35, color: T.gold,
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

function StaffRow({ member }) {
  const certWarning = member.certExpiresInDays != null && member.certExpiresInDays <= 30;
  return (
    <div className="panel-row transition" style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 16px',
      borderBottom: `1px solid rgba(184,134,58,0.06)`,
    }}>
      <StaffAvatar name={member.name} size={24} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontFamily: FONTS.ui, fontWeight: 500, fontSize: 11, color: T.text }}>{member.name}</span>
          {certWarning && (
            <span title={`Cert expires in ${member.certExpiresInDays} days`} style={{ color: T.amber, fontSize: 10 }}>⚠</span>
          )}
        </div>
        <div style={{ fontFamily: FONTS.ui, fontWeight: 400, fontSize: 10, color: T.textMuted }}>{member.role}</div>
      </div>
      <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: T.textMuted, flexShrink: 0 }}>{member.clockIn}</div>
    </div>
  );
}

function IncidentRow({ incident }) {
  const isL4 = incident.severity === 'L4';
  return (
    <div
      className={`panel-row transition${isL4 ? ' incident-l4' : ''}`}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '8px 16px',
        borderBottom: `1px solid rgba(184,134,58,0.06)`,
      }}
    >
      <SeverityBadge level={incident.severity} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONTS.ui, fontWeight: 500, fontSize: 11, color: T.text }}>{incident.type}</div>
        <div style={{ fontFamily: FONTS.ui, fontWeight: 400, fontSize: 10, color: T.textMuted }}>{incident.location} · {incident.handler}</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: T.textMuted }}>{incident.meta}</div>
      </div>
      <a href={incident.href || '#'} style={{ fontFamily: FONTS.ui, fontWeight: 400, fontSize: 10, color: T.gold, textDecoration: 'none', flexShrink: 0 }}>
        View →
      </a>
    </div>
  );
}

function ComplianceRow({ alert }) {
  const isRed = alert.severity === 'overdue';
  return (
    <div className="panel-row transition" style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '7px 16px',
      borderBottom: `1px solid rgba(184,134,58,0.06)`,
    }}>
      <span style={{ fontSize: 12, color: isRed ? T.red : T.amber, flexShrink: 0 }}>{isRed ? '🔴' : '⚠'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONTS.ui, fontWeight: 500, fontSize: 11, color: T.text }}>{alert.title}</div>
        <div style={{ fontFamily: FONTS.ui, fontWeight: 400, fontSize: 10, color: T.textMuted }}>{alert.sub}</div>
      </div>
      <a href={alert.href || '#'} style={{ fontFamily: FONTS.ui, fontWeight: 400, fontSize: 10, color: T.gold, textDecoration: 'none', flexShrink: 0 }}>
        {alert.action || 'Review →'}
      </a>
    </div>
  );
}

function PendingActionRow({ item }) {
  const dotColor = item.status === 'awaiting-dm' ? T.amber : item.status === 'info' ? T.cyan : T.textDim;
  const signed = item.actionState === 'signed';
  return (
    <div className="panel-row transition" style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '7px 16px',
      borderBottom: `1px solid rgba(184,134,58,0.06)`,
    }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0, marginTop: 4 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONTS.ui, fontWeight: 500, fontSize: 11, color: T.text }}>{item.title}</div>
        <div style={{ fontFamily: FONTS.ui, fontWeight: 400, fontSize: 10, color: T.textMuted }}>{item.sub}</div>
      </div>
      <button
        className="action-btn transition"
        style={{
          fontFamily: FONTS.ui, fontWeight: 500, fontSize: 10,
          color:  signed ? T.mint  : T.gold,
          border: `1px solid ${signed ? 'rgba(0,232,122,0.25)' : T.goldBorder}`,
          borderRadius: 4, padding: '3px 8px', background: 'transparent', cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {item.actionLabel || 'Sign'}
      </button>
    </div>
  );
}

function TimelineItem({ event, isLast }) {
  const dotStyles = {
    default:  { size: 8,  color: T.textDim },
    complete: { size: 8,  color: T.mint    },
    incident: { size: 8,  color: T.amber   },
    now:      { size: 10, color: T.gold    },
  };
  const s = dotStyles[event.state] || dotStyles.default;
  const textColor = { default: T.text, complete: T.mint, incident: T.amber, now: T.gold }[event.state] || T.text;
  const fw = { default: 400, complete: 400, incident: 500, now: 600 }[event.state] || 400;

  return (
    <div role="listitem" style={{ display: 'flex', gap: 10, position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 14 }}>
        <div style={{
          width: s.size, height: s.size, borderRadius: '50%', background: s.color, flexShrink: 0,
          ...(event.state === 'now' ? { boxShadow: '0 0 0 3px rgba(184,134,58,0.25)' } : {}),
        }} />
        {!isLast && <div style={{ width: 1, flex: 1, background: T.goldBorder, marginTop: 3 }} />}
      </div>
      <div style={{ paddingBottom: isLast ? 0 : 12 }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: T.textMuted, letterSpacing: '0.04em' }}>{event.time}</div>
        <div style={{ fontFamily: FONTS.ui, fontWeight: fw, fontSize: 11, color: textColor }}>{event.label}</div>
      </div>
    </div>
  );
}

function KpiCard({ kpi }) {
  const accentColor = kpi.accentColor || T.mint;
  const isStale = kpi.isStale;

  return (
    <div
      role="region"
      aria-label={`${kpi.label}: ${kpi.value}`}
      className="kpi-card transition"
      style={{
        ...cardBase,
        padding: 0,
        overflow: 'hidden',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <div style={{ height: 2, background: accentColor }} />
      <div style={{ padding: 16 }}>
        <div style={{ fontFamily: FONTS.ui, fontWeight: 500, fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          {kpi.label}
        </div>
        <div style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 'clamp(20px, 2.5vw, 32px)', color: T.text, lineHeight: 1.1, marginBottom: 4, letterSpacing: '0.05em' }}>
          {kpi.value}
        </div>
        {isStale ? (
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: T.amber }}>⏸ Data from {kpi.staleTime}</div>
        ) : (
          <div style={{ fontFamily: FONTS.mono, fontWeight: 400, fontSize: 11, color: T.textMuted, marginBottom: 6 }}>
            {kpi.subvalue}
          </div>
        )}
        {kpi.badges && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            {kpi.badges.map((b, i) => <SeverityBadge key={i} level={b} />)}
          </div>
        )}
        {kpi.trend && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <span style={{ color: kpi.trendColor || T.mint, fontSize: 11 }}>{kpi.trend.arrow}</span>
            <span style={{ fontFamily: FONTS.ui, fontWeight: 500, fontSize: 11, color: kpi.trendColor || T.mint }}>
              {kpi.trend.label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function PanelHeader({ title, count }) {
  return (
    <div style={{
      padding: '14px 16px', borderBottom: `1px solid ${T.goldBorder}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <span style={{ fontFamily: FONTS.display, fontWeight: 600, fontSize: 14, color: T.text }}>{title}</span>
      {count != null && (
        <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: T.textMuted }}>{count}</span>
      )}
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <div style={{
      padding: '8px 16px 4px',
      fontFamily: FONTS.ui, fontWeight: 600, fontSize: 10,
      color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.10em',
    }}>
      {children}
    </div>
  );
}

// ─── Nav icons (minimal inline SVG) ──────────────────────────────────────────
const NavIcons = {
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

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * AdminDesktopHomepage
 *
 * @param {object} props
 * @param {string} props.venueName          - e.g. "The Waterford Hotel"
 * @param {string} props.dmName             - Duty Manager full name, e.g. "James Kovacs"
 * @param {string} props.dmRole             - e.g. "Duty Manager"
 * @param {string} props.venueStatus        - "clear" | "attention" | "critical"
 * @param {Array}  props.kpis               - Array of KPI objects (see SAMPLE_DATA)
 * @param {Array}  props.staffOnFloor       - Staff grouped list
 * @param {Array}  props.incidents          - Active incidents
 * @param {Array}  props.complianceAlerts   - Compliance alert rows
 * @param {Array}  props.pendingActions     - Pending sign-off rows
 * @param {Array}  props.timelineEvents     - Shift timeline events
 * @param {Array}  props.quickActions       - Quick action buttons
 * @param {string} props.activeNav          - Active nav item label
 * @param {number} props.notificationCount  - Bell badge count
 * @param {Array}  props.venues             - Available venues for selector
 * @param {string} props.selectedVenueId    - Currently selected venue id
 * @param {function} props.onVenueChange    - Callback when venue changes
 */
export default function AdminDesktopHomepage({
  venueName       = 'The Waterford Hotel',
  dmName          = 'James Kovacs',
  dmRole          = 'Duty Manager',
  venueStatus     = 'attention',
  kpis            = [],
  staffOnFloor    = [],
  incidents       = [],
  complianceAlerts= [],
  pendingActions  = [],
  timelineEvents  = [],
  quickActions    = [],
  activeNav       = 'Dashboard',
  notificationCount = 2,
  venues          = [{ id: 'waterford', name: 'The Waterford Hotel' }],
  selectedVenueId = 'waterford',
  onVenueChange   = () => {},
}) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const formattedDateTime = now.toLocaleDateString('en-AU', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }) + ' · ' + now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });

  const greeting = (() => {
    const h = now.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const dmFirstName = dmName.split(' ')[0];
  const dmInitials  = dmName.split(' ').map(n => n[0]).slice(0, 2).join('');

  const mainNavItems    = ['Dashboard', 'Roster', 'Reports', 'Staff', 'Forecasting', 'Budgets'];
  const bottomNavItems  = ['Compliance', 'Settings', 'Admin'];

  const NavItem = ({ label }) => {
    const isActive = label === activeNav;
    return (
      <button
        className="nav-item transition"
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            10,
          padding:        '9px 20px',
          fontFamily:     FONTS.ui,
          fontWeight:     isActive ? 500 : 400,
          fontSize:       13,
          color:          isActive ? T.gold : T.textMuted,
          background:     isActive ? T.goldActive : 'transparent',
          border:         'none',
          borderLeft:     isActive ? `3px solid ${T.gold}` : '3px solid transparent',
          borderRadius:   '0 2px 2px 0',
          cursor:         'pointer',
          width:          '100%',
          textAlign:      'left',
        }}
      >
        <span style={{ color: isActive ? T.gold : T.textMuted, flexShrink: 0 }}>
          {NavIcons[label]}
        </span>
        <span className="nav-label">{label}</span>
      </button>
    );
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: T.bg }}>

        {/* ── Sidebar ── */}
        <aside className="sidebar" style={{
          width: 200, flexShrink: 0, background: T.sidebar,
          borderRight: `1px solid ${T.goldBorder}`,
          display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
        }}>
          <div style={{ padding: '20px 20px 16px' }}>
            <div className="sidebar-logo" style={{
              fontFamily: FONTS.display, fontWeight: 700, fontSize: 22,
              color: T.gold, letterSpacing: '0.12em',
            }}>
              MISE
            </div>
            <div className="sidebar-tagline" style={{
              fontFamily: FONTS.ui, fontWeight: 300, fontSize: 10,
              color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2,
            }}>
              Venue Intelligence
            </div>
          </div>

          <nav style={{ flex: 1, overflowY: 'auto' }}>
            {mainNavItems.map(item => <NavItem key={item} label={item} />)}
          </nav>

          <div style={{ borderTop: `1px solid ${T.goldBorder}`, paddingTop: 4, paddingBottom: 8 }}>
            {bottomNavItems.map(item => <NavItem key={item} label={item} />)}
          </div>
        </aside>

        {/* ── Main ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* ── Top Bar ── */}
          <header style={{
            height: 56, flexShrink: 0,
            background: T.card, borderBottom: `1px solid ${T.goldBorder}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 24px', gap: 12,
          }}>
            {/* Venue selector */}
            <select
              className="venue-sel transition"
              value={selectedVenueId}
              onChange={e => onVenueChange(e.target.value)}
              style={{
                background: T.bg, border: `1px solid ${T.goldBorder}`, borderRadius: 4,
                padding: '6px 12px', color: T.text,
                fontFamily: FONTS.ui, fontWeight: 500, fontSize: 13,
                cursor: 'pointer', appearance: 'none',
              }}
            >
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>

            <div style={{ flex: 1 }} />

            {/* Date/time */}
            <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: T.textMuted, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
              {formattedDateTime}
            </div>

            {/* Notification bell */}
            <button
              className="bell-btn transition"
              aria-label={`${notificationCount} notifications`}
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
              {notificationCount > 0 && (
                <span style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 16, height: 16, borderRadius: '50%',
                  background: T.amber, color: T.bg,
                  fontFamily: FONTS.ui, fontWeight: 600, fontSize: 9,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {notificationCount}
                </span>
              )}
            </button>

            {/* User avatar */}
            <div
              title={`${dmName} · ${dmRole}`}
              style={{
                width: 34, height: 34, borderRadius: '50%', background: T.gold,
                color: T.bg, fontFamily: FONTS.ui, fontWeight: 600, fontSize: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'default', flexShrink: 0,
              }}
            >
              {dmInitials}
            </div>
          </header>

          {/* ── Scrollable content ── */}
          <main className="admin-content" style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 32px' }}>

            {/* Page header */}
            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h1 style={{ fontFamily: FONTS.display, fontWeight: 600, fontSize: 26, color: T.text, marginBottom: 4 }}>
                  {greeting}, {dmFirstName}.
                </h1>
                <p style={{ fontFamily: FONTS.ui, fontWeight: 400, fontSize: 13, color: T.textMuted }}>
                  {venueName} — {now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
              <StatusPill state={venueStatus} />
            </div>

            {/* KPI strip */}
            <div className="kpi-strip" style={{
              display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16,
            }}>
              {kpis.map((kpi, i) => <KpiCard key={i} kpi={kpi} />)}
            </div>

            {/* Dashboard grid */}
            <div className="dashboard-grid" style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
            }}>

              {/* Left: Staff on floor */}
              <div style={{ ...cardBase, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <PanelHeader title="Staff on Floor" count={`${staffOnFloor.reduce((s, g) => s + g.members.length, 0)} on shift`} />
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {staffOnFloor.map((group, gi) => (
                    <div key={gi}>
                      <div style={{
                        padding: '8px 16px 4px', display: 'flex', alignItems: 'center', gap: 6,
                        fontFamily: FONTS.ui, fontWeight: 600, fontSize: 10,
                        color: T.gold, textTransform: 'uppercase', letterSpacing: '0.09em',
                        borderTop: gi > 0 ? `1px solid ${T.goldBorder}` : 'none',
                      }}>
                        {group.label}
                        <span style={{ color: T.textMuted }}>{group.members.length}</span>
                      </div>
                      {group.members.map((m, mi) => <StaffRow key={mi} member={m} />)}
                    </div>
                  ))}
                </div>
              </div>

              {/* Centre: Incidents + Compliance + Pending */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Active incidents */}
                <div style={{ ...cardBase, overflow: 'hidden' }}>
                  <PanelHeader title="Active Incidents" count={incidents.length} />
                  {incidents.map((inc, i) => <IncidentRow key={i} incident={inc} />)}
                  {incidents.length === 0 && (
                    <div style={{ padding: '12px 16px', fontFamily: FONTS.ui, fontSize: 11, color: T.textMuted }}>No active incidents</div>
                  )}
                </div>

                {/* Compliance alerts */}
                <div style={{ ...cardBase, overflow: 'hidden' }}>
                  <PanelHeader title="Compliance" />
                  {complianceAlerts.length > 0 ? (
                    complianceAlerts.map((a, i) => <ComplianceRow key={i} alert={a} />)
                  ) : (
                    <div style={{ padding: '12px 16px', fontFamily: FONTS.ui, fontSize: 11, color: T.mint }}>✓ All clear</div>
                  )}
                </div>

                {/* Pending sign-offs */}
                <div style={{ ...cardBase, overflow: 'hidden' }}>
                  <PanelHeader title="Pending Sign-offs" count={pendingActions.length} />
                  {pendingActions.map((item, i) => <PendingActionRow key={i} item={item} />)}
                  {pendingActions.length === 0 && (
                    <div style={{ padding: '12px 16px', fontFamily: FONTS.ui, fontSize: 11, color: T.mint }}>✓ Nothing outstanding</div>
                  )}
                </div>
              </div>

              {/* Right: Shift timeline + Quick actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Shift timeline */}
                <div style={{ ...cardBase, overflow: 'hidden', flex: 1 }}>
                  <PanelHeader title="Shift Timeline" />
                  <div style={{ padding: '12px 16px' }}>
                    <div role="list">
                      {timelineEvents.map((ev, i) => (
                        <TimelineItem key={i} event={ev} isLast={i === timelineEvents.length - 1} />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Quick actions */}
                <div style={{ ...cardBase, overflow: 'hidden' }}>
                  <PanelHeader title="Quick Actions" />
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {quickActions.map((qa, i) => {
                      if (qa.primary) {
                        return (
                          <button key={i} className="btn-primary transition" style={{
                            width: '100%', background: T.gold, color: T.bg,
                            fontFamily: FONTS.ui, fontWeight: 600, fontSize: 12, letterSpacing: '0.03em',
                            padding: '10px 16px', borderRadius: 4, border: 'none', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          }}>
                            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <rect x="1" y="3" width="11" height="9" rx="1"/><path d="M4 1v3M9 1v3M1 6h11"/>
                            </svg>
                            {qa.label}
                          </button>
                        );
                      }
                      return (
                        <button key={i} className="btn-secondary transition" style={{
                          width: '100%', background: T.bg, color: T.text,
                          fontFamily: FONTS.ui, fontWeight: 400, fontSize: 12,
                          border: `1px solid ${T.goldBorder}`, borderRadius: 4,
                          padding: '8px 12px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}>
                          {qa.label}
                          <span style={{ color: T.textMuted, fontSize: 11 }}>→</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

// ─── Sample data (matches MIS-413 spec) ──────────────────────────────────────
export const SAMPLE_DATA = {
  venueName:  'The Waterford Hotel',
  dmName:     'James Kovacs',
  dmRole:     'Duty Manager',
  venueStatus: 'attention',
  activeNav:  'Dashboard',
  notificationCount: 2,
  venues: [{ id: 'waterford', name: 'The Waterford Hotel' }],
  selectedVenueId: 'waterford',

  kpis: [
    {
      label:      'Staff on Shift',
      value:      '14',
      subvalue:   '12 rostered',
      accentColor: T.cyan,
      trend:      { arrow: '↑', label: '2 above minimum' },
      trendColor: T.cyan,
    },
    {
      label:      'Active Incidents',
      value:      '2',
      subvalue:   'Open now',
      accentColor: T.amber,
      badges:     ['L2', 'L1'],
    },
    {
      label:      'Pending Sign-offs',
      value:      '3',
      subvalue:   '3 outstanding',
      accentColor: T.amber,
      trend:      { arrow: '!', label: 'Awaiting DM action' },
      trendColor: T.amber,
    },
    {
      label:      'Revenue Today',
      value:      '$4,820',
      subvalue:   'vs $5,100 forecast',
      accentColor: T.red,
      trend:      { arrow: '↓', label: '−5.5% vs forecast' },
      trendColor: T.red,
    },
    {
      label:      'Labour Cost Today',
      value:      '42 hrs',
      subvalue:   '$1,176 · 24.4% rev',
      accentColor: T.mint,
      trend:      { arrow: '↓', label: '2 hrs under budget' },
      trendColor: T.mint,
    },
  ],

  staffOnFloor: [
    {
      label: 'Gaming Floor',
      members: [
        { name: 'Marcus Forsyth', role: 'Floor Manager',    clockIn: '17:00' },
        { name: 'Priya Nair',     role: 'Gaming Attendant', clockIn: '17:30' },
        { name: 'Lee Chen',       role: 'Gaming Attendant', clockIn: '17:30', certExpiresInDays: 22 },
      ],
    },
    {
      label: 'Bar & Bistro',
      members: [
        { name: 'Tom Walsh',    role: 'Bar Manager',  clockIn: '16:00' },
        { name: 'Sara Kim',     role: 'Bar Staff',    clockIn: '17:00' },
        { name: 'Daniel Cross', role: 'Bistro Chef',  clockIn: '15:30' },
      ],
    },
    {
      label: 'Security',
      members: [
        { name: 'Jake Morrison', role: 'Senior Security', clockIn: '18:00' },
        { name: 'Ava Torres',    role: 'Security',        clockIn: '18:00' },
      ],
    },
  ],

  incidents: [
    {
      severity: 'L2',
      type:     'Patron Intoxication',
      location: 'Gaming Floor · Bar 2',
      handler:  'Jake Morrison',
      meta:     '21:04 · 18 min ongoing',
      href:     '#',
    },
    {
      severity: 'L1',
      type:     'Minor Complaint',
      location: 'Bistro · Table 9',
      handler:  'Tom Walsh',
      meta:     '20:47 · Resolved 20:53',
      href:     '#',
    },
  ],

  complianceAlerts: [
    {
      severity: 'warning',
      title:    'RSG Certificate Expiring',
      sub:      'Lee Chen · expires in 22 days',
      action:   'Review →',
      href:     '#',
    },
    {
      severity: 'warning',
      title:    'Liquor Licence Renewal',
      sub:      'Due 14 Jun 2026 · 20 days',
      action:   'View →',
      href:     '#',
    },
  ],

  pendingActions: [
    { title: 'Incident Report #2847',  sub: 'Patron Intoxication · Gaming Floor', status: 'awaiting-dm', actionLabel: 'Sign',   actionState: '' },
    { title: 'End-of-Shift Summary',   sub: 'Due by 23:59 tonight',               status: 'awaiting-dm', actionLabel: 'Fill',   actionState: '' },
    { title: 'Safety Checklist',       sub: 'Pre-close · Tom Walsh assigned',      status: 'other',       actionLabel: 'View →', actionState: '' },
  ],

  timelineEvents: [
    { time: '17:00', label: 'Shift start — James Kovacs checked in', state: 'complete' },
    { time: '18:00', label: 'Security team on floor', state: 'complete' },
    { time: '20:00', label: 'Peak trade period begins', state: 'complete' },
    { time: '20:47', label: 'L1 complaint — Bistro Table 9', state: 'incident' },
    { time: '21:04', label: 'L2 — Patron intoxication · ongoing', state: 'incident' },
    { time: '21:22', label: 'Now', state: 'now' },
  ],

  quickActions: [
    { label: 'Build Roster',       primary: true  },
    { label: 'Log Incident',       primary: false },
    { label: 'Export Shift Report',primary: false },
    { label: 'View Compliance',    primary: false },
    { label: 'Send Staff Alert',   primary: false },
  ],
};
