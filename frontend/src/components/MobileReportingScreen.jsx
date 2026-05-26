/**
 * MobileReportingScreen (MIS-429)
 *
 * Mobile reporting surface for Duty Manager (tier 5).
 * Time-bounded to ≤7 days per MIS-426 §3.2 (enforced server-side; scopeClamped flag shown).
 * Gaming Attendant (tier 7) has no reporting surface — caller must gate on tier before mounting.
 *
 * Layout (375px):
 *   TimeChipRow (always visible)
 *   ActiveFilterChipRow
 *   KPIStrip (2 visible, hint at 3rd)
 *   ChartCard (line chart, SVG)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { queryAdminReport } from '../api.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const today = () => new Date().toISOString().slice(0, 10);

function timePeriodToRange(tp) {
  const t = today();
  switch (tp) {
    case 'today':     return { from: t, to: t, grain: 'hour' };
    case 'this_week': return { from: addDays(t, -6),  to: t, grain: 'day' };
    case 'last_week': return { from: addDays(t, -13), to: addDays(t, -7), grain: 'day' };
    default:          return { from: addDays(t, -6),  to: t, grain: 'day' };
  }
}

function fmtValue(v, unit) {
  if (v == null) return '—';
  if (unit === 'cents') {
    const n = Math.round(v / 100);
    return n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
      ? `$${(n / 1_000).toFixed(0)}k`
      : `$${n}`;
  }
  if (unit === 'pct') return v.toFixed(1) + '%';
  return v.toLocaleString('en-AU');
}

function fmtDelta(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

const fmtDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', {
  day: '2-digit', month: 'short', timeZone: 'UTC',
});

// ─── SVG Line Chart (mobile, compact) ────────────────────────────────────────

function MobileLineChart({ primary, comparison, unit }) {
  const pts = primary?.points || [];
  const cpts = comparison?.points || [];

  const allVals = [...pts, ...cpts].map((p) => p.v).filter((v) => v != null);
  if (allVals.length === 0) {
    return (
      <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(122,170,208,0.6)', fontSize: 13, fontFamily: "'DM Sans', sans-serif" }}>
        No data
      </div>
    );
  }

  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;
  const N = pts.length;
  const W = 340, H = 120;
  const PAD = { top: 8, right: 12, bottom: 28, left: 54 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const xs = (i) => PAD.left + (i / Math.max(N - 1, 1)) * cW;
  const ys = (v) => PAD.top + cH - ((v - minV) / range) * cH;

  const polyPts = (arr) => arr.filter((p) => p.v != null).map((p, i) => `${xs(i)},${ys(p.v)}`).join(' ');

  const xStep = Math.max(1, Math.ceil(N / 5));
  const xLabels = pts
    .filter((_, i) => i % xStep === 0 || i === N - 1)
    .map((p, _, arr) => ({ t: p.t, x: xs(pts.indexOf(p)) }));

  const yMid = (minV + maxV) / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 120 }} aria-label="Chart">
      {/* Grid */}
      {[minV, yMid, maxV].map((v, i) => (
        <line key={i} x1={PAD.left} y1={ys(v)} x2={W - PAD.right} y2={ys(v)}
          stroke="rgba(46,107,174,0.15)" strokeWidth="1" />
      ))}
      {[minV, yMid, maxV].map((v, i) => (
        <text key={i} x={PAD.left - 4} y={ys(v) + 4}
          fill="rgba(122,170,208,0.7)" fontSize="12" textAnchor="end"
          fontFamily="'IBM Plex Mono', monospace">
          {fmtValue(v, unit)}
        </text>
      ))}

      {/* X-labels */}
      {xLabels.map(({ t, x }, i) => (
        <text key={i} x={x} y={H - 4}
          fill="rgba(122,170,208,0.7)" fontSize="12" textAnchor="middle"
          fontFamily="'IBM Plex Mono', monospace">
          {fmtDate(t.slice(0, 10))}
        </text>
      ))}

      {/* Comparison line */}
      {cpts.length > 0 && (
        <polyline points={polyPts(cpts)} fill="none"
          stroke="rgba(46,107,174,0.30)" strokeWidth="1.5" strokeDasharray="4,3" />
      )}

      {/* Area fill */}
      {pts.length > 0 && (
        <path
          d={`M ${xs(0)},${ys(pts[0]?.v ?? minV)} ` +
            pts.map((p, i) => `L ${xs(i)},${ys(p.v ?? minV)}`).join(' ') +
            ` L ${xs(N - 1)},${PAD.top + cH} L ${xs(0)},${PAD.top + cH} Z`}
          fill="rgba(46,107,174,0.08)"
        />
      )}

      {/* Primary line */}
      {pts.length > 0 && (
        <polyline points={polyPts(pts)} fill="none"
          stroke="#2E6BAE" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      )}
    </svg>
  );
}

// ─── KPI cell ─────────────────────────────────────────────────────────────────

function KpiCell({ label, value, delta }) {
  const pos = delta?.startsWith('+');
  return (
    <div style={{
      minWidth: 140,
      background: 'rgba(14,30,50,0.8)',
      border: '1px solid rgba(46,107,174,0.18)',
      borderRadius: 10,
      padding: '12px 16px',
      flexShrink: 0,
    }}>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: 'rgba(122,170,208,0.8)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, fontWeight: 600, color: '#00C8E8' }}>
        {value}
      </div>
      {delta && (
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, marginTop: 3, color: pos ? '#00E87A' : '#E85050' }}>
          {delta} vs prev
        </div>
      )}
    </div>
  );
}

// ─── Time chip ───────────────────────────────────────────────────────────────

function TimeChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px',
        borderRadius: 20,
        border: `1px solid ${active ? '#2E6BAE' : 'rgba(46,107,174,0.22)'}`,
        background: active ? 'rgba(46,107,174,0.18)' : 'transparent',
        color: active ? '#5A9BD4' : 'rgba(122,170,208,0.6)',
        fontFamily: "'DM Sans', sans-serif",
        fontWeight: active ? 500 : 400,
        fontSize: 13,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        minHeight: 36,
      }}
    >
      {label}
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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

const TIME_CHIPS = [
  { id: 'today',     label: 'Today' },
  { id: 'this_week', label: 'This Week' },
  { id: 'last_week', label: 'Last Week' },
];

const METRIC_CHIPS = [
  { id: 'revenue',      label: 'Revenue' },
  { id: 'labour_cost',  label: 'Labour $' },
  { id: 'labour_pct',   label: 'Labour %' },
  { id: 'transactions', label: 'Transactions' },
];

export default function MobileReportingScreen({ onAuthError }) {
  const [timePeriod, setTimePeriod] = useState('this_week');
  const [metric, setMetric] = useState('revenue');
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const abortRef = useRef(null);

  const runQuery = useCallback(async (tp, m) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState({ status: 'loading', data: null, error: null });
    const { from, to, grain } = timePeriodToRange(tp);

    try {
      const result = await queryAdminReport({
        metric: m,
        grain,
        range: { from, to },
        comparison: { mode: 'previous_period', alignment: 'weekday' },
        view: 'mobile',
      });
      if (!ctrl.signal.aborted) setState({ status: 'ready', data: result, error: null });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (err.status === 401) { onAuthError?.(); return; }
      setState({ status: 'error', data: null, error: err.message });
    }
  }, [onAuthError]);

  useEffect(() => { runQuery(timePeriod, metric); }, [timePeriod, metric, runQuery]);

  const { data } = state;
  const unit = METRIC_UNIT[metric] || 'count';
  const metricLabel = METRIC_LABEL[metric] || metric;

  const pts = data?.primary?.points || [];
  const cpts = data?.comparison?.points || [];
  const total = pts.reduce((s, p) => s + (p.v ?? 0), 0);
  const ctotal = cpts.reduce((s, p) => s + (p.v ?? 0), 0);
  const avg = pts.length ? total / pts.length : 0;
  const delta = fmtDelta(total, ctotal);
  const deltaPos = delta?.startsWith('+');

  return (
    <section
      data-testid="mobile-reporting-screen"
      className="mise-rise mx-auto flex w-full max-w-[420px] flex-col gap-3"
      aria-label="Reporting"
    >
      {/* Header */}
      <header className="flex items-baseline justify-between px-1">
        <div>
          <p className="font-data text-[12px] uppercase tracking-wider text-cream/40">Reports</p>
          <h2 className="font-data text-sm font-semibold text-gold">{metricLabel}</h2>
        </div>
        {data?.meta?.scopeClamped && (
          <span style={{
            fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: '#E8A020',
            background: 'rgba(232,160,32,0.10)', padding: '3px 8px', borderRadius: 12,
          }}>
            ≤7d limit
          </span>
        )}
      </header>

      {/* Time chips */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
        {TIME_CHIPS.map((tc) => (
          <TimeChip
            key={tc.id}
            label={tc.label}
            active={timePeriod === tc.id}
            onClick={() => setTimePeriod(tc.id)}
          />
        ))}
      </div>

      {/* Metric chips */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
        {METRIC_CHIPS.map((mc) => (
          <TimeChip
            key={mc.id}
            label={mc.label}
            active={metric === mc.id}
            onClick={() => setMetric(mc.id)}
          />
        ))}
      </div>

      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
        <KpiCell label="Total" value={state.status === 'loading' ? '…' : fmtValue(total, unit)} delta={state.status === 'ready' ? delta : null} />
        <KpiCell label="Average" value={state.status === 'loading' ? '…' : fmtValue(avg, unit)} />
        {pts.length > 0 && (
          <KpiCell
            label="Peak"
            value={fmtValue(Math.max(...pts.map((p) => p.v ?? 0)), unit)}
          />
        )}
      </div>

      {/* Chart card */}
      <div className="rounded-2xl border border-hairline bg-surface px-3.5 py-3">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-[13px] font-semibold text-cream/90">{metricLabel}</span>
          {data?.meta?.range && (
            <span className="font-data text-[12px] text-cream/40">
              {fmtDate(data.meta.range.from)} – {fmtDate(data.meta.range.to)}
            </span>
          )}
        </div>

        {state.status === 'loading' && (
          <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="h-8 w-8 animate-pulse rounded-lg border border-gold/30" />
          </div>
        )}

        {state.status === 'error' && (
          <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
            <p className="text-sm text-cream/55">Couldn't load data</p>
            <button
              onClick={() => runQuery(timePeriod, metric)}
              className="text-xs text-gold border border-gold/30 rounded px-3 py-1"
            >
              Retry
            </button>
          </div>
        )}

        {state.status === 'ready' && data && (
          <>
            <MobileLineChart primary={data.primary} comparison={data.comparison} unit={unit} />
            {/* Legend */}
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <LegendDot color="#2E6BAE" label="This period" />
              {data.comparison?.points?.length > 0 && (
                <LegendDot color="rgba(122,170,208,0.25)" label="Prev period" dashed />
              )}
            </div>
            {data.meta?.partlyEstimated && (
              <p className="mt-2 font-data text-[12px] text-amber/80">
                ⚠ Includes award estimates
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function LegendDot({ color, label, dashed }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <svg width="16" height="2" viewBox="0 0 16 2">
        <line x1="0" y1="1" x2="16" y2="1"
          stroke={color} strokeWidth="2"
          strokeDasharray={dashed ? '4,3' : 'none'} />
      </svg>
      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: 'rgba(224,238,255,0.45)' }}>
        {label}
      </span>
    </div>
  );
}
