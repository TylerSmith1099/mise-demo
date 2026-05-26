// Runsheet — the shift task list (MIS-102, component priority #3). A scrollable
// list of the current shift's tasks; each can be checked off and the completion
// time auto-populates (stamped server-side from the verified session, never by
// the client). Built 375px-first; each row is a >=44px tap target.
//
// Props:
//   onAuthError(): called on a 401 so the shell can drop to <Login>
//   roleTier: from the verified session; Revenue Intelligence renders for tier <= 5.
import React, { useCallback, useEffect, useState } from 'react';
import { fetchRunsheet, checkRunsheetItem, fetchReservations } from '../api.js';
import ReservationsSection from './ReservationsSection.jsx';
import RevenueIntelligence from './RevenueIntelligence.jsx';

function hhmm(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const CATEGORY_COLOUR = {
  compliance: '#E85050',
  gaming: '#00C8E8',
  bar: '#B87A3C',
  open_close: '#E8A020',
  open: '#00E87A',
};

export default function Runsheet({ onAuthError, roleTier }) {
  const [state, setState] = useState({ status: 'loading', sheet: null });
  const [reservations, setReservations] = useState(null);

  useEffect(() => {
    let live = true;
    fetchRunsheet()
      .then((sheet) => live && setState({ status: 'ready', sheet }))
      .catch((err) => {
        if (err.status === 401) return onAuthError?.();
        live && setState({ status: err.status === 404 ? 'empty' : 'error', sheet: null });
      });
    fetchReservations()
      .then((r) => live && setReservations(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [onAuthError]);

  const onToggle = useCallback(
    async (item) => {
      const next = !item.done;
      setState((s) => ({
        ...s,
        sheet: {
          ...s.sheet,
          items: s.sheet.items.map((it) =>
            it.id === item.id
              ? { ...it, done: next, completedAt: next ? new Date().toISOString() : null }
              : it,
          ),
        },
      }));
      try {
        const res = await checkRunsheetItem({ id: item.id, done: next });
        setState((s) => ({
          ...s,
          sheet: {
            ...s.sheet,
            items: s.sheet.items.map((it) => (it.id === item.id ? { ...it, ...res } : it)),
          },
        }));
      } catch (err) {
        if (err.status === 401) return onAuthError?.();
        setState((s) => ({
          ...s,
          sheet: {
            ...s.sheet,
            items: s.sheet.items.map((it) =>
              it.id === item.id ? { ...it, done: item.done, completedAt: item.completedAt } : it,
            ),
          },
        }));
      }
    },
    [onAuthError],
  );

  const isManager = roleTier != null && roleTier <= 5;

  if (state.status === 'loading') {
    return (
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-3">
        {isManager && <RevenueIntelligence onAuthError={onAuthError} />}
        <Centered>
          <div className="h-10 w-10 animate-pulse rounded-2xl border border-gold/50" />
        </Centered>
      </div>
    );
  }

  if (state.status === 'empty' || !state.sheet?.items?.length) {
    return (
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-3">
        {isManager && <RevenueIntelligence onAuthError={onAuthError} />}
        <Centered>
          <p className="text-base font-semibold text-cream">No runsheet for this shift yet.</p>
          <p className="mt-1 text-sm text-cream/55">
            Tasks for your shift will appear here as they are rostered.
          </p>
        </Centered>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-3">
        {isManager && <RevenueIntelligence onAuthError={onAuthError} />}
        <Centered>
          <p className="text-base font-semibold text-cream">Couldn't load the runsheet.</p>
          <p className="mt-1 text-sm text-cream/55">Check your connection and switch back to try again.</p>
        </Centered>
      </div>
    );
  }

  const { shiftLabel, shiftDate, items } = state.sheet;
  const done = items.filter((i) => i.done).length;

  return (
    <section
      data-testid="runsheet"
      className="mise-rise mx-auto flex w-full max-w-[420px] flex-col gap-3"
      aria-label="Shift runsheet"
    >
      {/* Revenue Intelligence Card — managers only, sits above the checklist */}
      {isManager && <RevenueIntelligence onAuthError={onAuthError} />}

      <header className="flex items-baseline justify-between px-1">
        <div>
          <p className="font-data text-[12px] uppercase tracking-wider text-cream/40">
            {shiftLabel ? `${shiftLabel} shift` : 'Shift runsheet'}
          </p>
          {shiftDate && (
            <h2 className="font-data text-sm font-semibold text-cyan">
              {new Date(shiftDate).toLocaleDateString('en-AU', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
              })}
            </h2>
          )}
        </div>
        <span className="font-data text-sm text-cream/60">
          <span className="text-mint">{done}</span>/{items.length}
        </span>
      </header>

      {/* Reservations section — all roles per feature spec (MIS-243) */}
      {reservations && <ReservationsSection reservations={reservations} />}

      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onToggle(item)}
              aria-pressed={item.done}
              className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-hairline bg-surface px-3.5 py-3 text-left transition-colors active:bg-surface-2"
            >
              <span
                aria-hidden="true"
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border ${
                  item.done ? 'border-mint bg-mint/15 text-mint' : 'border-cream/35 text-transparent'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="m5 12 4.5 4.5L19 7"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  {item.category && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: CATEGORY_COLOUR[item.category] || '#B87A3C' }}
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={`text-[14px] ${
                      item.done ? 'text-cream/40 line-through' : 'text-cream/90'
                    }`}
                  >
                    {item.label}
                  </span>
                </span>
                {item.done && item.completedAt ? (
                  <span className="font-data text-[12px] text-mint">
                    Done {hhmm(item.completedAt)}
                    {item.completedBy ? ` · ${item.completedBy.split(' ')[0]}` : ''}
                  </span>
                ) : item.dueAt ? (
                  <span className="font-data text-[12px] text-cream/40">Due {hhmm(item.dueAt)}</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Centered({ children }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">{children}</div>
  );
}
