/**
 * AdminReportingScreen (MIS-429)
 *
 * Desktop reporting & filtering surface. Full page including sidebar so it can
 * replace AdminDesktopHomepage when the "Reports" nav item is active.
 *
 * Security: role/scope is derived server-side from the verified JWT.
 * The component sends no role or venueIds in the request body — those come
 * from resolveScope() on the server. Requested venueIds in the scope filter
 * are validated against the server-resolved set (any out-of-scope id → 403).
 *
 * Tiers: query tiers 2-5; export tiers 2-4 (DM cannot export).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { queryAdminReport, exportAdminReport } from '../api.js';

// ─── Design tokens (mirrors AdminDesktopHomepage.jsx) ───────────────────────
const T = {
  bg:         '#1C1612',
  card:       '#251E18',
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
  redBg:      'rgba(232,80,80,0.10)',
  amberBg:    'rgba(232,160,32,0.10)',
};

const FONTS = {
  display: "'Space Grotesk', system-ui, sans-serif",
  body:    "'Plus Jakarta Sans', system-ui, sans-serif",
  ui:      "'DM Sans', system-ui, sans-serif",
  mono:    "'IBM Plex Mono', 'Courier New', monospace",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', {
  day: '2-digit', month: 'short', timeZone: 'UTC',
});

const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const today = () => new Date().toISOString().slice(0, 10);

function timePeriodToRange(tp) {
  const t = today();
  switch (tp) {
    case 'today':      return { from: t, to: t, grain: 'hour' };
    case 'this_week':  return { from: addDays(t, -6),  to: t, grain: 'day' };
    case 'last_week':  return { from: addDays(t, -13), to: addDays(t, -7), grain: 'day' };
    case 'this_month': return { from: addDays(t, -29), to: t, grain: 'day' };
    case '3months':    return { from: addDays(t, -89), to: t, grain: 'week' };
    case 'this_year':  return { from: addDays(t, -364), to: t, grain: 'month' };
    default:           return { from: addDays(t, -28), to: t, grain: 'day' };
  }
}

function fmtValue(v, unit) {
  if (v == null) return '—';
  if (unit === 'cents') return '$' + Math.round(v / 100).toLocaleString('en-AU');
  if (unit === 'pct') return v.toFixed(1) + '%';
  return v.toLocaleString('en-AU');
}

function fmtDelta(cur, prev, unit) {
  if (cur == null || prev == null || prev === 0) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── SVG Line Chart ──────────────────────────────────────────────────────────

function LineChart({ primary, comparison, unit, height = 220 }) {
  const width = 100; // percentage-based via viewBox scaling

  const allPoints = [
    ...(primary?.points || []),
    ...(comparison?.points || []),
  ].filter((p) => p.v != null);

  if (allPoints.length === 0) {
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: T.textMuted, fontFamily: FONTS.ui, fontSize: 13,
      }}>
        No data for this period
      </div>
    );
  }

  const vals = allPoints.map((p) => p.v);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;

  const W = 600, H = height;
  const PAD = { top: 16, right: 20, bottom: 40, left: 64 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const pts = primary?.points || [];
  const N = pts.length;

  const xScale = (i) => PAD.left + (i / Math.max(N - 1, 1)) * chartW;
  const yScale = (v) => PAD.top + chartH - ((v - minV) / range) * chartH;

  const toPolyline = (points) =>
    points
      .filter((p) => p.v != null)
      .map((p, i) => `${xScale(i)},${yScale(p.v)}`)
      .join(' ');

  const numYLabels = 4;
  const yLabels = Array.from({ length: numYLabels + 1 }, (_, i) => {
    const v = minV + (range * i) / numYLabels;
    const y = yScale(v);
    return { v, y };
  });

  const xLabelStep = Math.max(1, Math.ceil(N / 8));
  const xLabels = pts
    .filter((_, i) => i % xLabelStep === 0 || i === N - 1)
    .map((p, _, arr) => {
      const origI = pts.indexOf(p);
      return { t: p.t, x: xScale(origI) };
    });

  const compPts = comparison?.points || [];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}
      aria-label="Revenue chart"
    >
      {/* Grid lines */}
      {yLabels.map(({ y }, i) => (
        <line key={i} x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
          stroke="rgba(184,134,58,0.10)" strokeWidth="1" />
      ))}

      {/* Y-axis labels */}
      {yLabels.map(({ v, y }, i) => (
        <text key={i} x={PAD.left - 6} y={y + 4}
          fill={T.textMuted} fontSize="10" textAnchor="end"
          fontFamily="'IBM Plex Mono', monospace">
          {fmtValue(v, unit)}
        </text>
      ))}

      {/* X-axis labels */}
      {xLabels.map(({ t, x }, i) => (
        <text key={i} x={x} y={H - 8}
          fill={T.textMuted} fontSize="10" textAnchor="middle"
          fontFamily="'IBM Plex Mono', monospace">
          {fmtDate(t.slice(0, 10))}
        </text>
      ))}

      {/* Comparison line (dashed) */}
      {compPts.length > 0 && (
        <polyline
          points={toPolyline(compPts)}
          fill="none"
          stroke={T.textDim}
          strokeWidth="1.5"
          strokeDasharray="4,3"
        />
      )}

      {/* Primary area fill */}
      {pts.length > 0 && (
        <path
          d={
            `M ${xScale(0)},${yScale(pts[0]?.v ?? minV)} ` +
            pts.map((p, i) => `L ${xScale(i)},${yScale(p.v ?? minV)}`).join(' ') +
            ` L ${xScale(N - 1)},${PAD.top + chartH} L ${xScale(0)},${PAD.top + chartH} Z`
          }
          fill="rgba(184,134,58,0.07)"
        />
      )}

      {/* Primary line */}
      {pts.length > 0 && (
        <polyline
          points={toPolyline(pts)}
          fill="none"
          stroke={T.gold}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

// ─── KPI Strip ───────────────────────────────────────────────────────────────

function KpiStrip({ primary, comparison, unit, meta }) {
  const pts = primary?.points || [];
  const cpts = comparison?.points || [];

  const total = pts.reduce((s, p) => s + (p.v ?? 0), 0);
  const ctotal = cpts.reduce((s, p) => s + (p.v ?? 0), 0);
  const avg = pts.length ? total / pts.length : 0;
  const maxPt = pts.reduce((m, p) => (p.v > (m?.v ?? -Infinity) ? p : m), null);
  const minPt = pts.reduce((m, p) => (p.v < (m?.v ?? Infinity) ? p : m), null);

  const delta = fmtDelta(total, ctotal, unit);
  const deltaPos = delta?.startsWith('+');

  const kpis = [
    { label: 'Total', value: fmtValue(total, unit), delta, deltaPos },
    { label: 'Average', value: fmtValue(avg, unit), delta: null },
    { label: 'Peak', value: maxPt ? fmtValue(maxPt.v, unit) : '—', sub: maxPt ? fmtDate(maxPt.t.slice(0, 10)) : null },
    { label: 'Low', value: minPt ? fmtValue(minPt.v, unit) : '—', sub: minPt ? fmtDate(minPt.t.slice(0, 10)) : null },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
      {kpis.map((k) => (
        <div key={k.label} style={{
          background: T.card, border: `1px solid ${T.goldBorder}`,
          borderRadius: 6, padding: '12px 16px',
        }}>
          <div style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.textMuted, marginBottom: 4 }}>
            {k.label}
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 18, fontWeight: 600, color: T.text }}>
            {k.value}
          </div>
          {k.delta && (
            <div style={{
              fontFamily: FONTS.ui, fontSize: 11,
              color: k.deltaPos ? T.mint : T.red,
              marginTop: 3,
            }}>
              {k.delta} vs prev
            </div>
          )}
          {k.sub && (
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: T.textMuted, marginTop: 3 }}>
              {k.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Filter Chip ─────────────────────────────────────────────────────────────

function Chip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 20,
        border: `1px solid ${active ? T.gold : T.goldBorder}`,
        background: active ? T.goldActive : 'transparent',
        color: active ? T.gold : T.textMuted,
        fontFamily: FONTS.ui,
        fontWeight: active ? 500 : 400,
        fontSize: 12,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.12s ease',
      }}
    >
      {label}
    </button>
  );
}

// ─── Active filter chip row ───────────────────────────────────────────────────

function ActiveFilterChipRow({ filters, scopeClamped }) {
  const chips = [];
  chips.push({ label: filters.timePeriod.replace('_', ' ') });
  if (filters.metric !== 'revenue') chips.push({ label: filters.metric.replace('_', ' ') });
  if (filters.comparison !== 'none') chips.push({ label: 'vs ' + filters.comparison.replace('_', ' ') });
  if (scopeClamped) chips.push({ label: '⚠ Time-bounded to 7d', warn: true });

  if (chips.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
      {chips.map((c, i) => (
        <span key={i} style={{
          padding: '3px 10px',
          borderRadius: 12,
          background: c.warn ? T.amberBg : T.goldLight,
          color: c.warn ? T.amber : T.gold,
          fontFamily: FONTS.ui,
          fontSize: 11,
        }}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

// ─── Sidebar (shared layout) ──────────────────────────────────────────────────

const NAV_ITEMS_MAIN   = ['Dashboard', 'Roster', 'Reports', 'Staff', 'Forecasting', 'Budgets'];
const NAV_ITEMS_BOTTOM = ['Compliance', 'Settings'];

function Sidebar({ activeNav, onNavChange }) {
  return (
    <aside style={{
      width: 200, flexShrink: 0, background: T.sidebar,
      borderRight: `1px solid ${T.goldBorder}`,
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      <div style={{ padding: '20px 20px 16px' }}>
        <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 22, color: T.gold, letterSpacing: '0.12em' }}>
          MISE
        </div>
        <div style={{ fontFamily: FONTS.ui, fontWeight: 300, fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
          Venue Intelligence
        </div>
      </div>
      <nav style={{ flex: 1 }}>
        {NAV_ITEMS_MAIN.map((item) => {
          const isActive = item === activeNav;
          return (
            <button key={item} onClick={() => onNavChange(item)} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 20px', width: '100%', textAlign: 'left',
              fontFamily: FONTS.ui, fontWeight: isActive ? 500 : 400, fontSize: 13,
              color: isActive ? T.gold : T.textMuted,
              background: isActive ? T.goldActive : 'transparent',
              border: 'none', borderLeft: isActive ? `3px solid ${T.gold}` : '3px solid transparent',
              cursor: 'pointer',
            }}>
              {item}
            </button>
          );
        })}
      </nav>
      <div style={{ borderTop: `1px solid ${T.goldBorder}` }}>
        {NAV_ITEMS_BOTTOM.map((item) => (
          <button key={item} onClick={() => onNavChange(item)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 20px', width: '100%', textAlign: 'left',
            fontFamily: FONTS.ui, fontSize: 12, color: T.textMuted,
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}>
            {item}
          </button>
        ))}
      </div>
    </aside>
  );
}

// ─── Filter Panel ─────────────────────────────────────────────────────────────

const METRICS = [
  { id: 'revenue',       label: 'Net Revenue' },
  { id: 'labour_cost',   label: 'Labour Cost' },
  { id: 'labour_pct',    label: 'Labour %' },
  { id: 'transactions',  label: 'Transactions' },
  { id: 'incident_count', label: 'Incidents' },
];

const TIME_PERIODS = [
  { id: 'today',      label: 'Today' },
  { id: 'this_week',  label: 'This Week' },
  { id: 'last_week',  label: 'Last Week' },
  { id: 'this_month', label: 'This Month' },
  { id: '3months',    label: '3 Months' },
  { id: 'this_year',  label: 'This Year' },
];

const COMPARISONS = [
  { id: 'none',            label: 'No Compare' },
  { id: 'previous_period', label: 'Prev Period' },
  { id: 'previous_year',   label: 'vs Last Year' },
];

function FilterPanel({ filters, onChange, onExport, canExport, exporting }) {
  return (
    <div style={{
      width: 240, flexShrink: 0, background: T.card,
      borderRight: `1px solid ${T.goldBorder}`,
      display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto',
      padding: '20px 0',
    }}>
      <Section title="Time Period">
        {TIME_PERIODS.map((tp) => (
          <Chip
            key={tp.id}
            label={tp.label}
            active={filters.timePeriod === tp.id}
            onClick={() => onChange({ ...filters, timePeriod: tp.id })}
          />
        ))}
      </Section>

      <Section title="Compare Against">
        {COMPARISONS.map((c) => (
          <Chip
            key={c.id}
            label={c.label}
            active={filters.comparison === c.id}
            onClick={() => onChange({ ...filters, comparison: c.id })}
          />
        ))}
      </Section>

      <Section title="Metric">
        {METRICS.map((m) => (
          <Chip
            key={m.id}
            label={m.label}
            active={filters.metric === m.id}
            onClick={() => onChange({ ...filters, metric: m.id })}
          />
        ))}
      </Section>

      {/* Export actions (sticky bottom) */}
      <div style={{
        marginTop: 'auto', padding: '16px 16px 0',
        borderTop: `1px solid ${T.goldBorder}`,
      }}>
        <div style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Export
        </div>
        {canExport ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ExportBtn label="Export CSV" format="csv" onExport={onExport} disabled={exporting} />
            <ExportBtn label="Export PDF" format="pdf" onExport={onExport} disabled={exporting} />
          </div>
        ) : (
          <p style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>
            Export not available for your role.
          </p>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ padding: '0 16px 16px' }}>
      <div style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function ExportBtn({ label, format, onExport, disabled }) {
  return (
    <button
      onClick={() => onExport(format)}
      disabled={disabled}
      style={{
        padding: '7px 12px',
        background: 'transparent',
        border: `1px solid ${T.goldBorder}`,
        borderRadius: 4,
        color: disabled ? T.textDim : T.gold,
        fontFamily: FONTS.ui,
        fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        transition: 'all 0.12s ease',
      }}
    >
      {label}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const METRIC_UNIT = {
  revenue:       'cents',
  labour_cost:   'cents',
  labour_pct:    'pct',
  transactions:  'count',
  incident_count:'count',
};

const METRIC_LABEL = {
  revenue:       'Net Revenue',
  labour_cost:   'Labour Cost',
  labour_pct:    'Labour %',
  transactions:  'Transactions',
  incident_count:'Incident Count',
};

export default function AdminReportingScreen({ session, onNavChange, onAuthError }) {
  const [filters, setFilters] = useState({
    timePeriod: 'this_week',
    metric: 'revenue',
    comparison: 'none',
  });

  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const [exporting, setExporting] = useState(false);
  const abortRef = useRef(null);

  // DM (tier 5) cannot export
  const canExport = session?.roleTier != null && session.roleTier <= 4;

  const runQuery = useCallback(async (f) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState({ status: 'loading', data: null, error: null });

    const { from, to, grain } = timePeriodToRange(f.timePeriod);

    try {
      const result = await queryAdminReport({
        metric: f.metric,
        grain,
        range: { from, to },
        comparison: { mode: f.comparison, alignment: 'weekday' },
        view: 'desktop',
      });
      if (!ctrl.signal.aborted) {
        setState({ status: 'ready', data: result, error: null });
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (err.status === 401) { onAuthError?.(); return; }
      setState({ status: 'error', data: null, error: err.message });
    }
  }, [onAuthError]);

  useEffect(() => {
    runQuery(filters);
  }, [filters, runQuery]);

  const handleExport = useCallback(async (format) => {
    setExporting(true);
    const { from, to, grain } = timePeriodToRange(filters.timePeriod);
    try {
      const { blob, filename } = await exportAdminReport({
        metric: filters.metric,
        grain,
        range: { from, to },
        comparison: { mode: filters.comparison, alignment: 'weekday' },
        format,
        exportClass: 'internal',
        view: 'desktop',
      });
      downloadBlob(blob, filename);
    } catch (err) {
      if (err.status === 401) onAuthError?.();
    } finally {
      setExporting(false);
    }
  }, [filters, onAuthError]);

  const { data } = state;
  const unit = METRIC_UNIT[filters.metric] || 'count';
  const metricLabel = METRIC_LABEL[filters.metric] || filters.metric;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: T.bg, fontFamily: FONTS.ui }}>
      <Sidebar activeNav="Reports" onNavChange={onNavChange} />

      {/* Filter panel */}
      <FilterPanel
        filters={filters}
        onChange={setFilters}
        onExport={handleExport}
        canExport={canExport}
        exporting={exporting}
      />

      {/* Main content */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 22, color: T.gold, margin: 0 }}>
            Reports &amp; Analytics
          </h1>
          <p style={{ fontFamily: FONTS.ui, fontSize: 13, color: T.textMuted, margin: '4px 0 0' }}>
            {metricLabel} · {session?.venueName || 'All Venues'}
          </p>
        </div>

        <ActiveFilterChipRow
          filters={filters}
          scopeClamped={data?.meta?.scopeClamped}
        />

        {/* KPI strip */}
        {state.status === 'ready' && data && (
          <KpiStrip
            primary={data.primary}
            comparison={data.comparison}
            unit={unit}
            meta={data.meta}
          />
        )}

        {state.status === 'loading' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{
                background: T.card, border: `1px solid ${T.goldBorder}`,
                borderRadius: 6, padding: '12px 16px', height: 72,
                opacity: 0.5,
              }} />
            ))}
          </div>
        )}

        {/* Chart card */}
        <div style={{
          background: T.card, border: `1px solid ${T.goldBorder}`,
          borderRadius: 6, padding: '20px 24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <span style={{ fontFamily: FONTS.ui, fontWeight: 600, fontSize: 14, color: T.text }}>
                {metricLabel}
              </span>
              {data?.meta && (
                <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: T.textMuted, marginLeft: 12 }}>
                  {data.meta.range?.from} → {data.meta.range?.to}
                </span>
              )}
            </div>
            {data?.meta?.isStale && (
              <span style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.amber, background: T.amberBg, padding: '3px 8px', borderRadius: 12 }}>
                ⚠ Stale data
              </span>
            )}
          </div>

          {state.status === 'loading' && (
            <div style={{
              height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.textMuted, fontSize: 13,
            }}>
              Loading…
            </div>
          )}

          {state.status === 'error' && (
            <div style={{
              height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.red, fontSize: 13, flexDirection: 'column', gap: 8,
            }}>
              <span>Failed to load data</span>
              <button
                onClick={() => runQuery(filters)}
                style={{ fontFamily: FONTS.ui, fontSize: 12, color: T.gold, background: 'none', border: `1px solid ${T.goldBorder}`, borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}
              >
                Retry
              </button>
            </div>
          )}

          {state.status === 'ready' && data && (
            <>
              <LineChart
                primary={data.primary}
                comparison={data.comparison}
                unit={unit}
                height={220}
              />
              {/* Legend */}
              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                <LegendItem color={T.gold} label="This period" dashed={false} />
                {data.comparison?.label && (
                  <LegendItem color={T.textDim} label={data.comparison.label} dashed={true} />
                )}
              </div>
              {data.meta?.partlyEstimated && (
                <p style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.amber, marginTop: 8 }}>
                  ⚠ Labour figures include award estimates — see CFO guardrail MIS-409 §7-R
                </p>
              )}
            </>
          )}
        </div>

        {/* Data as-of footer */}
        {data?.meta?.dataAsOf && (
          <p style={{ fontFamily: FONTS.mono, fontSize: 10, color: T.textDim, marginTop: 12 }}>
            Data as of {new Date(data.meta.dataAsOf).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })} AEST
          </p>
        )}
      </main>
    </div>
  );
}

function LegendItem({ color, label, dashed }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <svg width="20" height="2" viewBox="0 0 20 2" style={{ flexShrink: 0 }}>
        <line x1="0" y1="1" x2="20" y2="1"
          stroke={color} strokeWidth="2"
          strokeDasharray={dashed ? '4,3' : 'none'} />
      </svg>
      <span style={{ fontFamily: FONTS.ui, fontSize: 11, color: T.textMuted }}>{label}</span>
    </div>
  );
}
