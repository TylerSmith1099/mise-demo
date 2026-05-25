// Revenue Intelligence Card — top of the Run Sheet, Duty Manager / Venue Manager only.
// Spec: Mise-Revenue-Intelligence-Spec-V1.md (MIS-238).
//
// Layout: compact summary (default) → expanded blocks on tap → drill-down bottom sheet.
// 375px-first: all 5 department rows + header fit in one viewport without scroll.
// IBM Plex Mono (font-data) for numbers; DM Sans (font-sans) for labels.
// Status colours: mint=#00E87A (green), amber=#E8A020, red=#E85050.
// Trend direction is REVERSED vs revenue: +X% means labour rising = bad (red).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRevenueIntelligence, flagRevenueItem } from '../api.js';

const POLL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------
const STATUS_COLOR = {
  green: '#00E87A',
  amber: '#E8A020',
  red: '#E85050',
  early: '#F5EFE499',
  unavailable: '#F5EFE499',
};

function statusColor(s) {
  return STATUS_COLOR[s] ?? '#F5EFE499';
}

// Trend: +X% = labour rising = bad (red). -X% = falling = good (mint).
function trendColor(delta) {
  if (delta == null || delta === 0) return '#F5EFE466';
  return delta > 0 ? '#E85050' : '#00E87A';
}

function trendLabel(trend) {
  if (!trend || trend.delta == null) return '—';
  if (trend.delta === 0) return '—';
  const sign = trend.delta > 0 ? '+' : '';
  return `${sign}${trend.delta}% Sat`;
}

function fmtPct(pct) {
  if (pct == null) return '—';
  return `${pct}%`;
}

function fmtMoney(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function statusDot(status) {
  return <span aria-hidden="true" style={{ color: statusColor(status), fontSize: 12 }}>●</span>;
}

function earlyLabel(status) {
  if (status === 'early') return 'Early shift — data stabilising';
  if (status === 'unavailable') return 'Data unavailable';
  return null;
}

// ---------------------------------------------------------------------------
// Compact row: one department in the summary card.
// ---------------------------------------------------------------------------
function CompactRow({ dept, isRtv }) {
  const early = earlyLabel(dept.status);
  return (
    <div className="grid items-center gap-x-1.5" style={{ gridTemplateColumns: '80px 52px 12px 1fr 72px' }}>
      {/* Department label */}
      <span className="truncate text-[13px] text-cream/90">{dept.label}</span>

      {/* Labour % — IBM Plex Mono, status colour */}
      <span
        className="font-data text-[14px] font-bold text-right"
        style={{ color: early ? '#F5EFE499' : statusColor(dept.status) }}
      >
        {early ? '—' : fmtPct(dept.labourPct)}
      </span>

      {/* Status dot */}
      <span className="text-center">
        {early ? (
          <span className="font-data text-[12px]" style={{ color: '#F5EFE466' }}>○</span>
        ) : (
          statusDot(dept.status)
        )}
      </span>

      {/* Benchmark label */}
      <span className="truncate text-[12px]" style={{ color: '#F5EFE499' }}>
        {dept.benchmark.label}
      </span>

      {/* Trend — IBM Plex Mono */}
      <span
        className="font-data text-[12px] text-right"
        style={{ color: trendColor(dept.trend?.delta) }}
      >
        {early ? '—' : trendLabel(dept.trend)}
      </span>
    </div>
  );
}

// F&B Combined compact row
function CombinedRow({ combined }) {
  const { fAndB } = combined;
  const early = earlyLabel(fAndB.status);
  return (
    <div className="grid items-center gap-x-1.5" style={{ gridTemplateColumns: '80px 52px 12px 1fr 72px' }}>
      <span className="truncate text-[13px] text-cream/90">F&B</span>
      <span
        className="font-data text-[14px] font-bold text-right"
        style={{ color: early ? '#F5EFE499' : statusColor(fAndB.status) }}
      >
        {early ? '—' : fmtPct(fAndB.labourPct)}
      </span>
      <span className="text-center">
        {early ? (
          <span className="font-data text-[12px]" style={{ color: '#F5EFE466' }}>○</span>
        ) : (
          statusDot(fAndB.status)
        )}
      </span>
      <span className="truncate text-[12px]" style={{ color: '#F5EFE499' }}>
        {fAndB.benchmark.label}
      </span>
      <span
        className="font-data text-[12px] text-right"
        style={{ color: trendColor(fAndB.trend?.delta) }}
      >
        {early ? '—' : trendLabel(fAndB.trend)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded department block.
// ---------------------------------------------------------------------------
function ExpandedBlock({ dept, onDrillDown }) {
  const early = earlyLabel(dept.status);
  const isGaming = dept.id === 'gaming';

  return (
    <div className="rounded-xl border border-hairline bg-surface px-3 py-2.5">
      {/* Block header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-cream/90">{dept.label}</span>
        <span className="flex items-center gap-1.5">
          {early ? (
            <span className="font-data text-[12px]" style={{ color: '#F5EFE466' }}>Early shift</span>
          ) : (
            <>
              {statusDot(dept.status)}
              <span className="font-data text-[12px] uppercase tracking-wide" style={{ color: statusColor(dept.status) }}>
                {dept.status}
              </span>
            </>
          )}
        </span>
      </div>

      <div className="h-px mb-2" style={{ background: '#3a2f26' }} />

      {/* Figures */}
      <div className="flex flex-col gap-1">
        <ExpandedLine label="Labour this shift" value={fmtMoney(dept.labourCost)} />
        {isGaming ? (
          <>
            <ExpandedLine label="Net revenue (RTV)" value={fmtMoney(dept.revenue)} />
            <ExpandedLine
              label="Meter turnover"
              value={fmtMoney(dept.meterTurnover)}
              muted
            />
          </>
        ) : (
          <ExpandedLine label="Revenue this shift" value={fmtMoney(dept.revenue)} />
        )}
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-cream/60">Labour %</span>
          <span
            className="font-data text-[14px] font-bold"
            style={{ color: early ? '#F5EFE499' : statusColor(dept.status) }}
          >
            {early ? '— Early shift' : fmtPct(dept.labourPct)}
          </span>
        </div>
        <ExpandedLine label="Benchmark" value={dept.benchmark.label} plain />
        {dept.trend && !early && (
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-cream/60">Trend</span>
            <span className="font-data text-[12px]" style={{ color: trendColor(dept.trend.delta) }}>
              {trendLabel(dept.trend)}
            </span>
          </div>
        )}
        {dept.drillDown && !early && (
          <>
            <ExpandedLine label="Variance" value={`+${(dept.labourPct - dept.benchmark.value).toFixed(1)}% over benchmark`} warn />
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-cream/60">Max remaining spend</span>
              <span className="font-data text-[12px] text-amber">{fmtMoney(dept.drillDown.maxRemainingSpend)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-cream/60">Burn rate</span>
              <span className="font-data text-[12px] text-cream/70">
                ~{fmtMoney(dept.drillDown.currentBurnRatePerHour)}/hr
              </span>
            </div>
          </>
        )}
      </div>

      {/* Drill-down link — all departments */}
      <button
        type="button"
        onClick={() => onDrillDown(dept)}
        className="mt-2.5 flex w-full items-center justify-end gap-1 text-[12px] text-gold/80 active:text-gold"
        style={{ minHeight: 36 }}
      >
        Tap to drill down →
      </button>
    </div>
  );
}

function ExpandedLine({ label, value, muted, plain, warn }) {
  let valueColor = 'text-cream/90';
  if (muted) valueColor = 'text-cream/40';
  if (warn) valueColor = 'text-amber';
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-cream/60">{label}</span>
      <span className={`font-data text-[12px] ${valueColor}`}>{value}</span>
    </div>
  );
}

// F&B Combined expanded block
function CombinedExpandedBlock({ combined, depts, onDrillDown }) {
  const { fAndB } = combined;
  const bar  = depts.find((d) => d.id === 'bar');
  const food = depts.find((d) => d.id === 'food');
  const early = earlyLabel(fAndB.status);

  return (
    <div className="rounded-xl border border-hairline bg-surface px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-cream/90">Food + Beverage Combined</span>
        <span className="flex items-center gap-1.5">
          {statusDot(fAndB.status)}
          <span className="font-data text-[12px] uppercase tracking-wide" style={{ color: statusColor(fAndB.status) }}>
            {fAndB.status}
          </span>
        </span>
      </div>
      <div className="h-px mb-2" style={{ background: '#3a2f26' }} />
      <div className="flex flex-col gap-1">
        <ExpandedLine label="F&B Labour" value={fmtMoney(fAndB.labourCost)} />
        <ExpandedLine label="F&B Revenue" value={fmtMoney(fAndB.revenue)} />
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-cream/60">Combined %</span>
          <span className="font-data text-[14px] font-bold" style={{ color: statusColor(fAndB.status) }}>
            {early ? '—' : fmtPct(fAndB.labourPct)}
          </span>
        </div>
        <ExpandedLine label="Benchmark" value={fAndB.benchmark.label} plain />
        {fAndB.trend && !early && (
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-cream/60">Trend</span>
            <span className="font-data text-[12px]" style={{ color: trendColor(fAndB.trend.delta) }}>
              {trendLabel(fAndB.trend)}
            </span>
          </div>
        )}
        {/* Sub-line: Bar and Food individual status */}
        {bar && food && (
          <div className="mt-1 flex items-center gap-3 rounded-lg px-2 py-1.5" style={{ background: '#2f2620' }}>
            <span className="text-[12px] text-cream/60">
              Bar: <span className="font-data" style={{ color: statusColor(bar.status) }}>{fmtPct(bar.labourPct)}</span>
              {' '}{statusDot(bar.status)}
            </span>
            <span className="text-[12px] text-cream/60">
              Food: <span className="font-data" style={{ color: statusColor(food.status) }}>{fmtPct(food.labourPct)}</span>
              {' '}{statusDot(food.status)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drill-down bottom sheet.
// ---------------------------------------------------------------------------
function DrillDownSheet({ dept, onClose, onFlag }) {
  const [flagState, setFlagState] = useState('idle'); // idle | pending | done
  const isGreenDept = dept.status === 'green';

  async function handleFlag() {
    setFlagState('pending');
    try {
      await onFlag({ department: dept.label, labourPct: dept.labourPct });
      setFlagState('done');
    } catch {
      setFlagState('idle');
    }
  }

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(28,22,18,0.75)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl px-4 pb-8 pt-4"
        style={{ background: '#261e18', maxHeight: '80dvh', overflowY: 'auto' }}
        role="dialog"
        aria-label={`${dept.label} drill-down`}
      >
        {/* Handle */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-hairline" />

        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-semibold text-cream">
            {dept.label} — Drill Down
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-cream/50 active:text-cream"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="h-px mb-3" style={{ background: '#3a2f26' }} />

        {/* Staff list */}
        <p className="mb-2 text-[12px] text-cream/50">Staff on shift now:</p>
        {dept.staffOnShift?.length > 0 ? (
          <div className="flex flex-col gap-2 mb-4">
            {dept.staffOnShift.map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: '#2f2620' }}>
                <div>
                  <span className="text-[13px] text-cream/90">{s.name}</span>
                  <span className="ml-2 text-[12px] text-cream/50">{s.role}</span>
                </div>
                <div className="text-right">
                  <span className="font-data text-[12px] text-cream/60">{s.hoursRemaining}h rem.</span>
                  <span className="font-data ml-2 text-[12px] text-cream/50">${s.hourlyRate}/hr</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-4 text-[12px] text-amber">No staff rostered — verify coverage.</p>
        )}

        {/* Current figures */}
        <div className="flex flex-col gap-1.5 mb-4 rounded-xl border border-hairline px-3 py-3" style={{ background: '#1c1612' }}>
          <DrillLine label="Current labour cost this shift" value={fmtMoney(dept.labourCost)} />
          <DrillLine
            label={dept.id === 'gaming' ? 'Net revenue (RTV) so far' : 'Revenue so far this shift'}
            value={fmtMoney(dept.revenue)}
          />
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-cream/60">Labour %</span>
            <span className="flex items-center gap-1.5">
              <span className="font-data text-[14px] font-bold" style={{ color: statusColor(dept.status) }}>
                {fmtPct(dept.labourPct)}
              </span>
              {statusDot(dept.status)}
            </span>
          </div>
        </div>

        {/* To-reach-benchmark section (RED/AMBER only) */}
        {dept.drillDown && !isGreenDept && (
          <div className="flex flex-col gap-1.5 mb-4 rounded-xl border px-3 py-3" style={{ borderColor: '#E8502066' }}>
            <p className="text-[12px] text-amber mb-1">To reach ≤{dept.benchmark.value}% benchmark by end of shift:</p>
            <DrillLine label="Max remaining labour spend" value={fmtMoney(dept.drillDown.maxRemainingSpend)} colored="amber" />
            <DrillLine label="Current burn rate" value={`~${fmtMoney(dept.drillDown.currentBurnRatePerHour)}/hr`} />
          </div>
        )}

        {/* Within benchmark label for GREEN */}
        {isGreenDept && (
          <p className="mb-4 text-[12px] text-mint">Within benchmark — current tracking:</p>
        )}

        {/* Flag button — only for RED/AMBER */}
        {!isGreenDept && (
          <button
            type="button"
            onClick={flagState === 'idle' ? handleFlag : undefined}
            disabled={flagState !== 'idle'}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber/40 py-3 text-[14px] font-semibold text-amber active:bg-amber/10 disabled:opacity-50"
            style={{ minHeight: 48 }}
          >
            {flagState === 'done' ? '✓ Flagged for manager review' : 'Flag for manager review'}
          </button>
        )}
      </div>
    </>
  );
}

function DrillLine({ label, value, colored }) {
  const cls = colored === 'amber' ? 'text-amber' : 'text-cream/90';
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-cream/60">{label}</span>
      <span className={`font-data text-[12px] ${cls}`}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status summary line (header of card).
// ---------------------------------------------------------------------------
function StatusSummary({ departments, combined }) {
  const all = [...departments, combined.fAndB];
  const redCount = all.filter((d) => d.status === 'red').length;
  const amberCount = all.filter((d) => d.status === 'amber').length;

  if (redCount > 0) {
    return (
      <p className="text-[12px]" style={{ color: '#E8A020' }}>
        ⚠ {redCount} department{redCount > 1 ? 's' : ''} need{redCount === 1 ? 's' : ''} attention
      </p>
    );
  }
  if (amberCount > 0) {
    return (
      <p className="text-[12px]" style={{ color: '#E8A020' }}>
        {amberCount} department{amberCount > 1 ? 's' : ''} approaching limit
      </p>
    );
  }
  return (
    <p className="text-[12px] text-mint">All departments within benchmark</p>
  );
}

// ---------------------------------------------------------------------------
// Main component.
// ---------------------------------------------------------------------------
export default function RevenueIntelligence({ onAuthError }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [expanded, setExpanded] = useState(false);
  const [drillDown, setDrillDown] = useState(null);
  const liveRef = useRef(true);

  const load = useCallback(() => {
    fetchRevenueIntelligence()
      .then((data) => {
        if (liveRef.current) setState({ status: 'ready', data });
      })
      .catch((err) => {
        if (!liveRef.current) return;
        if (err.status === 401) return onAuthError?.();
        if (err.status === 403) return; // Non-manager — component should not be rendered
        setState({ status: 'error', data: null });
      });
  }, [onAuthError]);

  useEffect(() => {
    liveRef.current = true;
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      liveRef.current = false;
      clearInterval(id);
    };
  }, [load]);

  const handleFlag = useCallback(
    ({ department, labourPct }) => flagRevenueItem({ department, labourPct }),
    [],
  );

  if (state.status === 'loading') {
    return (
      <div className="mb-4 h-[56px] animate-pulse rounded-2xl border border-hairline bg-surface" />
    );
  }
  if (state.status === 'error' || !state.data) return null;

  const { departments, combined } = state.data;

  // Build ordered rows: Gaming, Bar, Food, Retail + F&B combined.
  const rows = departments;

  return (
    <>
      <div className="mb-4 rounded-2xl border border-hairline bg-surface px-3 pb-3 pt-2.5">
        {/* Header row */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center justify-between pb-1.5"
          style={{ minHeight: 36 }}
          aria-expanded={expanded}
        >
          <span
            className="text-[12px] tracking-widest"
            style={{ color: '#B8863A', fontVariant: 'small-caps', textTransform: 'uppercase' }}
          >
            Revenue Intelligence
          </span>
          <span
            className="font-data text-[12px] transition-transform duration-150"
            style={{ color: '#B8863A', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}
            aria-hidden="true"
          >
            ▼
          </span>
        </button>

        <StatusSummary departments={departments} combined={combined} />

        <div className="h-px my-2" style={{ background: '#3a2f26' }} />

        {!expanded ? (
          /* Compact view — all rows visible without scroll */
          <div className="flex flex-col gap-1.5">
            {rows.map((dept) => (
              <CompactRow key={dept.id} dept={dept} />
            ))}
            <CombinedRow combined={combined} />
          </div>
        ) : (
          /* Expanded view — detailed blocks */
          <div className="flex flex-col gap-2">
            {rows.map((dept) => (
              <ExpandedBlock key={dept.id} dept={dept} onDrillDown={setDrillDown} />
            ))}
            <CombinedExpandedBlock combined={combined} depts={rows} onDrillDown={setDrillDown} />
          </div>
        )}
      </div>

      {/* Drill-down bottom sheet */}
      {drillDown && (
        <DrillDownSheet
          dept={drillDown}
          onClose={() => setDrillDown(null)}
          onFlag={handleFlag}
        />
      )}
    </>
  );
}
