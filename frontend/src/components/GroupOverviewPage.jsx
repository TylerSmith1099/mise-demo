/**
 * GroupOverviewPage — MIS-478
 *
 * Estate-level group roll-up view for Group GM / Area Manager roles.
 * Implements the Designer's visual spec (MIS-477 / Deliverables/Design/Group-Rollup-Spec-V2.md).
 *
 * Brand: Deep Meridian LOCKED. Do not deviate from token values.
 *
 * Components:
 *   1. Page header (eyebrow, title, period, decorative export/period controls)
 *   2. Critical alert banner (conditional — RED venues only)
 *   3. Group KPI strip (4 cards: revenue, compliance, venues in RED, labour)
 *   4. Venue table (6-col desktop, card layout tablet; RED → AMBER → OK sort)
 *
 * Breakpoints: 1280px desktop, 768px tablet.
 * Accessibility: ARIA roles on table, rows, banner, KPI strip.
 *
 * Data dependency: fetchGroupOverview() → GET /api/admin/group-overview
 * Data contract: see Group-Rollup-Spec-V2.md §Data Contract
 */

import React, { useState } from 'react';

// ── Deep Meridian tokens — LOCKED ─────────────────────────────────────────
const T = {
  bg:         '#090F1A',
  card:       '#0E1E32',
  cardHover:  '#162840',
  sidebar:    '#060C15',
  border:     'rgba(46,107,174,0.20)',
  borderMd:   'rgba(46,107,174,0.35)',
  text:       '#E0EEFF',
  textDim:    '#7AAAD0',
  textMute:   '#3A6090',
  copper:     '#B87A3C',
  copperDim:  'rgba(184,122,60,0.10)',
  divider:    'rgba(46,107,174,0.06)',
  cyan:       '#00C8E8',
  mint:       '#00E87A',
  red:        '#E85050',
  amber:      '#E8A020',
};

const FONTS = {
  head:  "'Space Grotesk', system-ui, sans-serif",
  body:  "'Plus Jakarta Sans', system-ui, sans-serif",
  ui:    "'DM Sans', system-ui, sans-serif",
  mono:  "'IBM Plex Mono', 'Courier New', monospace",
};

// ── Injected CSS (keyframes + responsive + hover) ─────────────────────────
const PAGE_CSS = `
  @keyframes grp-pulse {
    0%,100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }
  .grp-pulse-dot { animation: grp-pulse 2s ease-in-out infinite; }

  @keyframes grp-row-pulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(232,80,80,0.25); }
    50%      { box-shadow: 0 0 0 4px rgba(232,80,80,0); }
  }
  .grp-venue-row { cursor: pointer; position: relative; transition: background 0.12s; }
  .grp-venue-row:hover { background: rgba(22,40,64,0.8) !important; }
  .grp-venue-row:hover .grp-drill { color: #B87A3C !important; transform: translateX(2px); }
  .grp-venue-row:focus { outline: 2px solid rgba(0,200,232,0.4); outline-offset: -2px; }
  .grp-drill { transition: color 0.12s, transform 0.12s; }

  .grp-chip { cursor: pointer; transition: border-color 0.12s, background 0.12s; }
  .grp-chip:hover { opacity: 0.85; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }

  /* ── Tablet: 768px–1279px ── */
  @media (min-width: 768px) and (max-width: 1279px) {
    .grp-kpi-strip  { grid-template-columns: 1fr 1fr !important; }
    .grp-col-header { display: none !important; }
    .grp-venue-row  { display: flex !important; flex-direction: column !important;
                      padding: 14px 16px !important; gap: 10px !important; }
    .grp-venue-cells { display: grid !important;
                       grid-template-columns: repeat(4, 1fr) !important; gap: 8px; }
    .grp-cell-label { font-family: 'DM Sans',system-ui,sans-serif; font-size: 10px;
                      text-transform: uppercase; letter-spacing: 0.08em;
                      color: #3A6090; margin-bottom: 2px; }
    .grp-drill-col  { display: none !important; }
    .grp-table-grid { display: block !important; }
  }

  /* ── Mobile: <768px ── */
  @media (max-width: 767px) {
    .grp-kpi-strip  { grid-template-columns: 1fr 1fr !important; }
    .grp-col-header { display: none !important; }
    .grp-venue-row  { display: flex !important; flex-direction: column !important;
                      padding: 12px 16px !important; gap: 8px !important; }
    .grp-venue-cells { display: grid !important;
                       grid-template-columns: repeat(4, 1fr) !important; gap: 6px; }
    .grp-cell-label { font-family: 'DM Sans',system-ui,sans-serif; font-size: 10px;
                      text-transform: uppercase; letter-spacing: 0.08em;
                      color: #3A6090; margin-bottom: 2px; }
    .grp-drill-col  { display: none !important; }
    .grp-table-grid { display: block !important; }
  }
`;

// ── Pill helper ───────────────────────────────────────────────────────────
function Pill({ kind, children }) {
  const styles = {
    ok:   { background: 'rgba(0,232,122,0.12)',  color: T.mint  },
    warn: { background: 'rgba(232,160,32,0.15)', color: T.amber },
    crit: { background: 'rgba(232,80,80,0.15)',  color: T.red   },
    cyan: { background: 'rgba(0,200,232,0.12)',  color: T.cyan  },
  };
  const s = styles[kind] || styles.cyan;
  return (
    <span style={{
      ...s,
      fontFamily:    FONTS.mono,
      fontSize:      10,
      fontWeight:    600,
      padding:       '2px 7px',
      borderRadius:  4,
      display:       'inline-block',
      whiteSpace:    'nowrap',
    }}>
      {children}
    </span>
  );
}

// ── Component 2 — Critical Alert Banner ──────────────────────────────────
function CriticalBanner({ venues, onJumpToVenue }) {
  const redVenues = venues.filter((v) => v.status === 'red');
  if (redVenues.length === 0) return null;

  const first = redVenues[0];
  const reason = first.compliance.highest_severity === 'L4'
    ? 'L4 compliance items open'
    : first.labour.status === 'over'
    ? `labour ${first.labour.variance_pct}% over target`
    : 'active critical flags';

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          12,
        background:   'rgba(232,80,80,0.07)',
        border:       '1px solid rgba(232,80,80,0.35)',
        borderRadius: 6,
        padding:      '12px 18px',
        marginBottom: 20,
        flexWrap:     'wrap',
      }}
    >
      <span
        className="grp-pulse-dot"
        style={{ width: 8, height: 8, borderRadius: '50%', background: T.red, flexShrink: 0 }}
        aria-hidden="true"
      />
      <span style={{ flex: 1, fontFamily: FONTS.ui, fontSize: 13, color: '#ff8080', fontWeight: 500, minWidth: 200 }}>
        <strong>{redVenues.length} venue{redVenues.length > 1 ? 's' : ''} in critical status</strong>
        <span style={{ color: T.textDim, fontWeight: 400 }}>{' '}— {first.name} has {reason}</span>
      </span>
      <button
        onClick={() => onJumpToVenue(first.id)}
        style={{
          background:   'none',
          border:       'none',
          color:        T.copper,
          fontFamily:   FONTS.ui,
          fontSize:     11,
          fontWeight:   500,
          cursor:       'pointer',
          padding:      0,
          flexShrink:   0,
          whiteSpace:   'nowrap',
        }}
      >
        Jump to venue →
      </button>
    </div>
  );
}

// ── Component 3 — Group KPI Strip ─────────────────────────────────────────
function KpiCard({ label, value, valueColor, sub, accent, borderOverride, children }) {
  return (
    <div
      style={{
        background:   T.card,
        border:       `1px solid ${borderOverride || T.border}`,
        borderRadius: 6,
        overflow:     'hidden',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <div style={{ height: 2, background: accent }} />
      <div style={{ padding: 16 }}>
        <div style={{ fontFamily: FONTS.ui, fontWeight: 500, fontSize: 10, color: T.textMute, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          {label}
        </div>
        <div style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 28, color: valueColor || T.text, lineHeight: 1.1, marginBottom: 6 }}>
          {value}
        </div>
        <div style={{ fontFamily: FONTS.ui, fontSize: 12, color: T.textDim }}>
          {sub}
        </div>
        {children && <div style={{ marginTop: 8 }}>{children}</div>}
      </div>
    </div>
  );
}

function GroupKpiStrip({ totals }) {
  const {
    revenue_current, revenue_target,
    compliance_open, compliance_breakdown,
    venues_red,
    venues_over_labour,
  } = totals;

  const revDiff = revenue_target > 0 ? revenue_current - revenue_target : 0;
  const revPillKind = revDiff >= 0 ? 'ok' : 'crit';
  const revPillLabel = revenue_target > 0
    ? `${revDiff >= 0 ? '+' : ''}$${Math.abs(Math.round(revDiff / 1000))}k vs target`
    : 'No target';

  const compHasL4 = (compliance_breakdown?.L4 || 0) > 0;
  const compHasL3 = (compliance_breakdown?.L3 || 0) > 0;
  const compValueColor = compHasL4 ? T.red : compHasL3 ? T.amber : T.text;
  const compAccent = compHasL4 ? T.red : compHasL3 ? T.amber : T.copper;
  const compBorderOverride = compHasL4
    ? 'rgba(232,80,80,0.35)'
    : compHasL3
    ? 'rgba(232,160,32,0.28)'
    : T.border;

  const venueCountAll = totals.venue_count ?? 4;

  return (
    <div
      aria-label="Group summary metrics"
      className="grp-kpi-strip"
      style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap:                 16,
        marginBottom:        20,
      }}
    >
      {/* KPI 1 — Total Revenue */}
      <KpiCard
        label="Total Revenue (Week)"
        value={`$${(revenue_current / 1000).toFixed(0)}k`}
        accent={T.copper}
        sub={`vs $${(revenue_target / 1000).toFixed(0)}k target`}
      >
        <Pill kind={revPillKind}>{revPillLabel}</Pill>
      </KpiCard>

      {/* KPI 2 — Open Compliance Items */}
      <KpiCard
        label="Open Compliance Items"
        value={String(compliance_open)}
        valueColor={compValueColor}
        accent={compAccent}
        borderOverride={compBorderOverride}
        sub=""
      >
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(compliance_breakdown?.L4 || 0) > 0 && <Pill kind="crit">{compliance_breakdown.L4}× L4</Pill>}
          {(compliance_breakdown?.L3 || 0) > 0 && <Pill kind="warn">{compliance_breakdown.L3}× L3</Pill>}
          {(compliance_breakdown?.L2 || 0) > 0 && <Pill kind="warn">{compliance_breakdown.L2}× L2</Pill>}
          {compliance_open === 0 && <Pill kind="ok">All clear</Pill>}
        </div>
      </KpiCard>

      {/* KPI 3 — Venues in RED */}
      <KpiCard
        label="Venues in RED"
        value={String(venues_red)}
        valueColor={venues_red > 0 ? T.red : T.text}
        accent={venues_red > 0 ? T.red : T.copper}
        borderOverride={venues_red > 0 ? 'rgba(232,80,80,0.35)' : T.border}
        sub=""
      >
        {venues_red > 0
          ? <Pill kind="crit">{venues_red} critical</Pill>
          : <Pill kind="ok">All clear</Pill>
        }
      </KpiCard>

      {/* KPI 4 — Labour vs Target */}
      <KpiCard
        label="Labour vs Target"
        value={`${venueCountAll - venues_over_labour} / ${venueCountAll}`}
        valueColor={T.cyan}
        accent={T.copper}
        sub="venues on target"
      >
        {venues_over_labour > 0 && <Pill kind="crit">{venues_over_labour} over</Pill>}
      </KpiCard>
    </div>
  );
}

// ── Component 4 — Venue Table ──────────────────────────────────────────────

function StatusDot({ status }) {
  const color = status === 'red' ? T.red : status === 'warn' ? T.amber : T.mint;
  return (
    <span
      className={status === 'red' ? 'grp-pulse-dot' : ''}
      style={{
        display:     'inline-block',
        width:       7,
        height:      7,
        borderRadius: '50%',
        background:  color,
        flexShrink:  0,
        marginRight: 8,
        marginTop:   1,
      }}
      aria-hidden="true"
    />
  );
}

function ComplianceChips({ breakdown, highestSeverity }) {
  if (!highestSeverity) return <span style={{ color: T.mint, fontFamily: FONTS.mono, fontSize: 12 }}>✓</span>;
  const entries = [];
  if (breakdown.L4 > 0) entries.push(<Pill key="L4" kind="crit">L4</Pill>);
  if (breakdown.L3 > 0) entries.push(<Pill key="L3" kind="warn">L3</Pill>);
  if (breakdown.L2 > 0) entries.push(<Pill key="L2" kind="warn">L2</Pill>);
  if (breakdown.L1 > 0) entries.push(<Pill key="L1" kind="cyan">L1</Pill>);
  return <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{entries}</div>;
}

function LabourCell({ labour }) {
  const icon = labour.status === 'on' ? '✓' : labour.status === 'near' ? '≈' : '↑';
  const label = labour.status === 'on' ? 'On target' : labour.status === 'near' ? 'Near target' : 'Over target';
  const color = labour.status === 'on' ? T.mint : labour.status === 'near' ? T.amber : T.red;
  const pct = labour.variance_pct !== 0
    ? `${labour.variance_pct > 0 ? '+' : ''}${labour.variance_pct}%`
    : '';
  return (
    <div>
      <div style={{ fontFamily: FONTS.ui, fontSize: 13, fontWeight: 500, color }}>{icon} {label}</div>
      {pct && <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: T.textMute, marginTop: 2 }}>{pct}</div>}
    </div>
  );
}

function VenueRow({ venue, onDrillIn }) {
  const isRed = venue.status === 'red';
  const compCount = venue.compliance.open_count;
  const compColor = venue.compliance.highest_severity === 'L4' ? T.red
    : venue.compliance.highest_severity === 'L3' ? T.amber
    : compCount === 0 ? T.mint
    : T.textDim;
  const revDelta = venue.revenue.delta_pct;
  const revDeltaKind = revDelta >= 0 ? 'ok' : 'crit';

  return (
    <div
      className="grp-venue-row"
      role="row"
      tabIndex={0}
      aria-label={`${venue.name} — ${venue.status === 'red' ? 'critical' : venue.status === 'warn' ? 'attention' : 'clear'} — click to open`}
      onClick={() => onDrillIn(venue.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDrillIn(venue.id); } }}
      style={{
        display:       'grid',
        gridTemplateColumns: '2fr 1.5fr 1fr 1fr 0.7fr 40px',
        borderBottom:  `1px solid ${isRed ? 'rgba(232,80,80,0.10)' : T.divider}`,
        background:    isRed ? 'rgba(232,80,80,0.035)' : 'transparent',
        alignItems:    'center',
        padding:       '14px 0',
      }}
    >
      {/* Col 1 — Venue */}
      <div style={{ paddingLeft: 20, display: 'flex', alignItems: 'flex-start' }}>
        <StatusDot status={venue.status} />
        <div>
          <div style={{ fontFamily: FONTS.ui, fontSize: 13, fontWeight: 500, color: isRed ? '#ff8080' : T.text, lineHeight: 1.3 }}>
            {venue.name}
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: T.textMute, marginTop: 1 }}>
            {venue.suburb} · {venue.type}
          </div>
        </div>
      </div>

      {/* Col 2 — Revenue */}
      <div className="grp-cell" style={{ paddingLeft: 8 }}>
        <div className="grp-cell-label">Revenue</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 14, fontWeight: 600, color: T.text }}>
          ${venue.revenue.current_week.toLocaleString('en-AU')}
        </div>
        <div style={{ fontFamily: FONTS.ui, fontSize: 10, color: T.textMute, marginTop: 1 }}>
          Target ${venue.revenue.target_week.toLocaleString('en-AU')}
        </div>
        <div style={{ marginTop: 3 }}>
          <Pill kind={revDeltaKind}>{revDelta >= 0 ? '+' : ''}{revDelta}%</Pill>
        </div>
      </div>

      {/* Col 3 — Compliance */}
      <div className="grp-cell" style={{ paddingLeft: 8 }}>
        <div className="grp-cell-label">Compliance</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 14, fontWeight: 600, color: compColor, marginBottom: 4 }}>
          {compCount}
        </div>
        <ComplianceChips breakdown={venue.compliance.severity_breakdown} highestSeverity={venue.compliance.highest_severity} />
      </div>

      {/* Col 4 — Labour */}
      <div className="grp-cell" style={{ paddingLeft: 8 }}>
        <div className="grp-cell-label">Labour</div>
        <LabourCell labour={venue.labour} />
      </div>

      {/* Col 5 — Critical Flags */}
      <div className="grp-cell" style={{ paddingLeft: 8 }}>
        <div className="grp-cell-label">Flags</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 14, fontWeight: 600, color: venue.critical_flags.count > 0 ? T.red : T.textMute }}>
          {venue.critical_flags.count > 0 ? venue.critical_flags.count : '—'}
        </div>
      </div>

      {/* Col 6 — Drill */}
      <div className="grp-drill-col" style={{ textAlign: 'center' }}>
        <span className="grp-drill" style={{ fontSize: 16, color: T.textMute }}>›</span>
      </div>
    </div>
  );
}

function VenueTable({ venues, onDrillIn }) {
  const [filter, setFilter] = useState('all');
  const displayed = filter === 'alerts'
    ? venues.filter((v) => v.status !== 'ok' || v.critical_flags.count > 0)
    : venues;

  return (
    <div style={{
      background:   T.card,
      border:       `1px solid ${T.border}`,
      borderRadius: 6,
      overflow:     'hidden',
    }}>
      {/* Table header bar */}
      <div style={{
        display:       'flex',
        alignItems:    'center',
        justifyContent:'space-between',
        padding:       '14px 20px',
        borderBottom:  `1px solid ${T.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: FONTS.head, fontWeight: 600, fontSize: 15, color: T.text }}>All Venues</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: T.textMute }}>{venues.length} venues</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { key: 'all',    label: 'All' },
            { key: 'alerts', label: '⚠ Alerts only' },
          ].map(({ key, label }) => {
            const isActive = filter === key;
            const isAlertActive = key === 'alerts' && isActive;
            return (
              <button
                key={key}
                className="grp-chip"
                onClick={() => setFilter(key)}
                style={{
                  fontFamily:   FONTS.ui,
                  fontSize:     11,
                  fontWeight:   isActive ? 500 : 400,
                  padding:      '4px 10px',
                  borderRadius: 4,
                  border:       `1px solid ${isAlertActive ? 'rgba(232,80,80,0.4)' : isActive ? T.copper : T.border}`,
                  background:   isAlertActive ? 'rgba(232,80,80,0.07)' : isActive ? T.copperDim : 'transparent',
                  color:        isAlertActive ? T.red : isActive ? T.copper : T.textMute,
                  cursor:       'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Column headers — desktop only */}
      <div
        className="grp-col-header"
        style={{
          display:             'grid',
          gridTemplateColumns: '2fr 1.5fr 1fr 1fr 0.7fr 40px',
          padding:             '8px 0',
          background:          'rgba(224,238,255,0.015)',
          borderBottom:        `1px solid ${T.divider}`,
        }}
        aria-hidden="true"
      >
        {['Venue', 'Revenue (Week)', 'Compliance', 'Labour', 'Flags', ''].map((col, i) => (
          <div
            key={i}
            style={{
              paddingLeft:   i === 0 ? 20 : 8,
              fontFamily:    FONTS.ui,
              fontSize:      10,
              fontWeight:    500,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color:         T.textMute,
            }}
          >
            {col}
          </div>
        ))}
      </div>

      {/* Venue rows */}
      <div role="rowgroup" aria-label="All venues" className="grp-table-grid">
        {displayed.map((venue) => (
          <VenueRow key={venue.id} venue={venue} onDrillIn={onDrillIn} />
        ))}
        {displayed.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: FONTS.ui, fontSize: 13, color: T.textMute }}>
            No alerts — all venues clear
          </div>
        )}
      </div>
    </div>
  );
}

// ── Component 1 — Page Header ──────────────────────────────────────────────
function PageHeader({ groupName, venueCount, periodLabel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
      <div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: T.cyan, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
          Estate View
        </div>
        <h1 style={{ fontFamily: FONTS.head, fontWeight: 600, fontSize: 24, color: T.text, margin: 0, lineHeight: 1.2 }}>
          Group Overview
        </h1>
        <div style={{ fontFamily: FONTS.ui, fontSize: 13, color: T.textDim, marginTop: 4 }}>
          {groupName} · {venueCount} venues · {periodLabel}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <button style={{
          fontFamily:   FONTS.ui, fontSize: 12, color: T.textMute,
          background:   'transparent', border: `1px solid ${T.border}`,
          borderRadius: 4, padding: '6px 14px', cursor: 'pointer',
        }}>
          ⬇ Export
        </button>
        <button style={{
          fontFamily:   FONTS.ui, fontSize: 12, color: T.textMute,
          background:   'transparent', border: `1px solid ${T.border}`,
          borderRadius: 4, padding: '6px 14px', cursor: 'pointer',
        }}>
          {periodLabel} ▾
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

/**
 * GroupOverviewPage
 *
 * @param {object} props
 * @param {object} props.data          — response from fetchGroupOverview()
 * @param {function} props.onDrillIn  — called with venueId when user clicks a venue row
 */
export default function GroupOverviewPage({ data, onDrillIn }) {
  if (!data) return null;

  const { group_name, period_label, venue_count, totals, venues } = data;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
      <div
        className="admin-content"
        style={{
          flex:       1,
          overflowY:  'auto',
          overflowX:  'hidden',
          padding:    '28px 28px 40px',
          background: T.bg,
        }}
      >
        {/* Component 1 — Page header */}
        <PageHeader
          groupName={group_name}
          venueCount={venue_count}
          periodLabel={period_label}
        />

        {/* Component 2 — Critical alert banner (conditional) */}
        <CriticalBanner venues={venues} onJumpToVenue={onDrillIn} />

        {/* Component 3 — Group KPI strip */}
        <GroupKpiStrip totals={{ ...totals, venue_count }} />

        {/* Component 4 — Venue table */}
        <VenueTable venues={venues} onDrillIn={onDrillIn} />
      </div>
    </>
  );
}
