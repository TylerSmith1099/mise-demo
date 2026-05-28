// Bookings screen — DM (tier 5) tab showing upcoming and past restaurant bookings.
// Date navigation: prev / today / next day. Grouped by service window.
// Data from GET /api/bookings/:date (MIS-642).
import React, { useCallback, useEffect, useState } from 'react';
import { fetchBookings } from '../api.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function brisToday() {
  return new Date(Date.now() + 10 * 3_600_000).toISOString().slice(0, 10);
}
function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtDate(s) {
  const d = new Date(s + 'T12:00:00Z');
  const today = brisToday();
  const tom   = addDays(today, 1);
  const yest  = addDays(today, -1);
  if (s === today) return 'Today';
  if (s === tom)   return 'Tomorrow';
  if (s === yest)  return 'Yesterday';
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const STATUS_COLOUR = {
  confirmed:  '#00E87A',
  tentative:  '#E8A020',
  completed:  'var(--cream-40)',
  cancelled:  '#E85050',
};
const STATUS_LABEL = {
  confirmed:  'Confirmed',
  tentative:  'Tentative',
  completed:  'Completed',
  cancelled:  'Cancelled',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function ServiceSection({ service }) {
  const total = service.bookings.reduce((s, b) => s + b.partySize, 0);
  const vips  = service.bookings.filter((b) => b.isVip).length;

  return (
    <div style={{ borderRadius: 16, border: '1px solid var(--gold-25)', background: 'var(--surface)', overflow: 'hidden' }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(234,200,138,0.12)' }}>
        <span style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 15, fontWeight: 600, color: 'var(--gold)' }}>
          {service.label}
        </span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {vips > 0 && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: '#E8A020', background: 'rgba(232,160,32,0.12)', paddingInline: 8, paddingBlock: 3, borderRadius: 10 }}>
              {vips} VIP
            </span>
          )}
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--cream-60)' }}>
            {service.bookings.length} bookings · {total} pax
          </span>
        </div>
      </div>

      {/* Booking rows */}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {service.bookings.map((b, i) => (
          <li
            key={b.bookingId || i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderTop: i > 0 ? '1px solid rgba(234,200,138,0.06)' : 'none',
            }}
          >
            {/* Time */}
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, color: 'var(--cream-80)', minWidth: 40, flexShrink: 0 }}>
              {b.slotTime || '—'}
            </span>

            {/* Guest info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500, color: 'var(--cream)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.guestName}
                </span>
                {b.isVip && (
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: '#E8A020', background: 'rgba(232,160,32,0.15)', paddingInline: 5, paddingBlock: 2, borderRadius: 6, flexShrink: 0 }}>
                    VIP
                  </span>
                )}
              </div>
              {b.notes && (
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: 'var(--cream-55)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.notes}
                </p>
              )}
            </div>

            {/* Party size */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cream-40)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: 'var(--cream-80)', fontWeight: 600 }}>
                {b.partySize}
              </span>
            </div>

            {/* Status pill */}
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: STATUS_COLOUR[b.status] || 'var(--cream-40)',
                background: (STATUS_COLOUR[b.status] || 'transparent') + '18',
                paddingInline: 7,
                paddingBlock: 3,
                borderRadius: 8,
                flexShrink: 0,
              }}
            >
              {STATUS_LABEL[b.status] || b.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BookingsScreen({ onAuthError }) {
  const [date, setDate] = useState(brisToday);
  const [state, setState] = useState({ status: 'loading', data: null });

  const load = useCallback((d) => {
    setState((s) => ({ ...s, status: 'loading' }));
    fetchBookings(d)
      .then((data) => setState({ status: 'ready', data }))
      .catch((err) => {
        if (err.status === 401) { onAuthError?.(); return; }
        setState({ status: 'error', data: null });
      });
  }, [onAuthError]);

  useEffect(() => { load(date); }, [date, load]);

  const totalBookings = (state.data?.services || []).reduce((s, svc) => s + svc.bookings.length, 0);
  const totalPax      = (state.data?.services || []).reduce((s, svc) => s + svc.bookings.reduce((a, b) => a + b.partySize, 0), 0);

  return (
    <section
      data-testid="bookings-screen"
      style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 420, margin: '0 auto' }}
      aria-label="Bookings"
    >
      {/* Header + date navigation */}
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingInline: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--cream-40)', margin: 0 }}>
            Bookings
          </p>
          {state.status === 'loading' && (
            <div style={{ width: 12, height: 12, border: '2px solid rgba(234,200,138,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'bk-spin 0.8s linear infinite' }} />
          )}
        </div>

        {/* Date nav row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setDate((d) => addDays(d, -1))}
            aria-label="Previous day"
            style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--gold-25)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>

          <div style={{ flex: 1, textAlign: 'center' }}>
            <h2 style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 17, fontWeight: 700, color: 'var(--gold)', margin: 0 }}>
              {fmtDate(date)}
            </h2>
            {state.status === 'ready' && totalBookings > 0 && (
              <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--cream-60)', margin: 0 }}>
                {totalBookings} bookings · {totalPax} pax
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setDate((d) => addDays(d, 1))}
            aria-label="Next day"
            style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--gold-25)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>

        {/* Today shortcut — visible only when not on today */}
        {date !== brisToday() && (
          <button
            type="button"
            onClick={() => setDate(brisToday())}
            style={{ alignSelf: 'center', paddingInline: 14, paddingBlock: 5, borderRadius: 16, border: '1px solid var(--gold-25)', background: 'transparent', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: 'var(--gold)', minHeight: 32 }}
          >
            Back to Today
          </button>
        )}
      </header>

      {/* Error state */}
      {state.status === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 20px', gap: 8 }}>
          <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, color: 'var(--cream)', margin: 0 }}>Couldn't load bookings</p>
          <button type="button" onClick={() => load(date)} style={{ marginTop: 8, paddingInline: 16, paddingBlock: 8, borderRadius: 20, border: '1px solid var(--gold-25)', background: 'transparent', color: 'var(--gold)', fontFamily: "'DM Sans', sans-serif", fontSize: 13, cursor: 'pointer', minHeight: 44 }}>Retry</button>
        </div>
      )}

      {/* Loading skeletons */}
      {state.status === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2].map((n) => (
            <div key={n} style={{ height: 120, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--gold-25)', opacity: 0.5 }} />
          ))}
        </div>
      )}

      {/* Service sections */}
      {state.status === 'ready' && (
        <>
          {(state.data?.services || []).length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', gap: 8 }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--cream-40)" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 600, color: 'var(--cream)', margin: 0 }}>No bookings</p>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: 'var(--cream-55)', margin: 0, textAlign: 'center' }}>No bookings found for {fmtDate(date)}.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(state.data.services).map((svc) => (
                <ServiceSection key={svc.window} service={svc} />
              ))}
            </div>
          )}
        </>
      )}

      <style>{`@keyframes bk-spin { to { transform: rotate(360deg); } }`}</style>
    </section>
  );
}
