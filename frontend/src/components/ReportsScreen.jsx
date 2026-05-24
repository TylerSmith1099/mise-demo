// Reports screen — 7-day P&L summary for Venue Manager (Tier 4, MIS-253).
// Reads from /api/reports which queries the pnl_summary table seeded by
// scripts/seed-steward-extras.js. Gaming shows NET RTV, never raw meter turnover.
import React, { useEffect, useState } from 'react';
import { fetchReports } from '../api.js';

const DEPT_LABEL = {
  beverage:    'Beverage',
  food:        'Food',
  gaming:      'Gaming',
  bottle_shop: 'Bottle Shop',
  total:       'Total',
};

const DEPT_COLOUR = {
  beverage:    '#00C8E8',
  food:        '#E8A020',
  gaming:      '#00E87A',
  bottle_shop: '#B8863A',
  total:       '#E0D4B0',
};

function fmt(n) {
  if (n == null) return '—';
  return n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
    ? `$${(n / 1_000).toFixed(0)}k`
    : `$${n.toFixed(0)}`;
}

function pctColour(pct) {
  if (pct == null) return 'text-cream/60';
  if (pct > 32) return 'text-red-400';
  if (pct > 28) return 'text-yellow-400';
  return 'text-mint';
}

export default function ReportsScreen({ onAuthError }) {
  const [state, setState] = useState({ status: 'loading', data: null });

  useEffect(() => {
    let live = true;
    fetchReports()
      .then((data) => live && setState({ status: 'ready', data }))
      .catch((err) => {
        if (err.status === 401) return onAuthError?.();
        live && setState({ status: err.status === 404 ? 'empty' : 'error', data: null });
      });
    return () => { live = false; };
  }, [onAuthError]);

  if (state.status === 'loading') {
    return (
      <Centered>
        <div className="h-10 w-10 animate-pulse rounded-2xl border border-gold/50" />
      </Centered>
    );
  }

  if (state.status === 'empty') {
    return (
      <Centered>
        <p className="text-base font-semibold text-cream">No reports data yet.</p>
        <p className="mt-1 text-sm text-cream/55">Reports will appear once trading data is available.</p>
      </Centered>
    );
  }

  if (state.status === 'error') {
    return (
      <Centered>
        <p className="text-base font-semibold text-cream">Couldn't load reports.</p>
        <p className="mt-1 text-sm text-cream/55">Check your connection and try again.</p>
      </Centered>
    );
  }

  const { periodLabel, departments } = state.data;
  const depts = departments.filter((d) => d.department !== 'total');
  const total = departments.find((d) => d.department === 'total');

  return (
    <section
      data-testid="reports-screen"
      className="mise-rise mx-auto flex w-full max-w-[420px] flex-col gap-3"
      aria-label="Revenue reports"
    >
      <header className="flex items-baseline justify-between px-1">
        <div>
          <p className="font-data text-[10px] uppercase tracking-wider text-cream/40">Reports</p>
          <h2 className="font-data text-sm font-semibold text-gold">{periodLabel}</h2>
        </div>
        {total && (
          <span className="font-data text-sm text-cream/60">
            Total{' '}
            <span className="text-cream">{fmt(total.revenue)}</span>
          </span>
        )}
      </header>

      <ul className="flex flex-col gap-2">
        {depts.map((d) => (
          <li key={d.department}>
            <div className="rounded-2xl border border-hairline bg-surface px-3.5 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: DEPT_COLOUR[d.department] || '#B8863A' }}
                    aria-hidden="true"
                  />
                  <span className="text-[14px] font-semibold text-cream/90">
                    {DEPT_LABEL[d.department] || d.department}
                  </span>
                </div>
                <span className="font-data text-sm text-cream">{fmt(d.revenue)}</span>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-x-2 text-center">
                <Stat label="Labour $" value={fmt(d.labourCost)} />
                <Stat
                  label="Labour %"
                  value={d.labourPct != null ? `${d.labourPct}%` : '—'}
                  colourClass={pctColour(d.labourPct)}
                />
                {d.department === 'gaming' ? (
                  <Stat label="Net RTV" value={fmt(d.netGamingRevenue)} />
                ) : (
                  <div />
                )}
              </div>

              {d.department === 'gaming' && d.meterTurnover != null && (
                <p className="mt-1.5 font-data text-[10px] text-cream/35">
                  Meter turnover {fmt(d.meterTurnover)} — not used as revenue base
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {total && (
        <div className="rounded-2xl border border-gold/30 bg-surface px-3.5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold text-gold">Total</span>
            <span className="font-data text-sm text-cream">{fmt(total.revenue)}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-2 text-center">
            <Stat label="Labour $" value={fmt(total.labourCost)} />
            <Stat
              label="Labour %"
              value={total.labourPct != null ? `${total.labourPct}%` : '—'}
              colourClass={pctColour(total.labourPct)}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, colourClass = 'text-cream/80' }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-data text-[10px] uppercase tracking-wider text-cream/35">{label}</span>
      <span className={`font-data text-sm font-semibold ${colourClass}`}>{value}</span>
    </div>
  );
}

function Centered({ children }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}
