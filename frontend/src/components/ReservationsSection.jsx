// ReservationsSection — reservations block for the daily run sheet (MIS-243).
//
// Three-level drilldown, all within a single expandable section in the
// shift summary view:
//   1. Summary — pax booked, walk-in prediction, VIP flag (always visible)
//   2. Time slots — tap a service card to expand 30-min slot breakdown
//   3. Individual bookings — tap a slot to see guest details, VIP, dietary
//
// Brand: Option A (charcoal/gold/cream). All content from props — nothing
// hardcoded. VIP is shown prominently (gold star badge). 375px mobile-first.
//
// Props: { reservations }
//   reservations: { date, services: [ service, ... ] }
//   service: { serviceName, window, totalBookedPax, vipCount,
//              walkInPrediction, timeSlots, bookings }
//   timeSlot: { time, pax, bookingCount, bookings }
//   booking: { bookingId, time, pax, guestName, occasion, vip,
//              dietary[], tableNumber }

import React, { useState } from 'react';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const suffix = hour >= 12 ? 'pm' : 'am';
  const h12 = hour % 12 || 12;
  return `${h12}:${m}${suffix}`;
}

// ── Atoms ──────────────────────────────────────────────────────────────────

function VipBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-gold/20 px-1.5 py-0.5 font-data text-[10px] font-semibold text-gold"
      aria-label="VIP guest"
    >
      ★ VIP
    </span>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="currentColor"
      className={`shrink-0 text-cream/40 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Label({ children }) {
  return (
    <p className="font-data text-[10px] uppercase tracking-wider text-cream/40">{children}</p>
  );
}

// ── Booking drilldown ───────────────────────────────────────────────────────

function BookingRow({ booking }) {
  return (
    <div className="border-t border-hairline py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-semibold text-cream/95">{booking.guestName}</span>
            {booking.vip && <VipBadge />}
            {booking.occasion && (
              <span className="rounded bg-gold/10 px-1.5 py-0.5 font-data text-[10px] text-gold/80">
                {booking.occasion}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-data text-[11px] text-cream/50">
            <span>{booking.pax} pax</span>
            {booking.tableNumber && <span>{booking.tableNumber}</span>}
            {booking.dietary?.length > 0 && (
              <span className="text-amber/80">{booking.dietary.join(', ')}</span>
            )}
          </div>
        </div>
        <span className="shrink-0 font-data text-[12px] text-cyan/80">{fmtTime(booking.time)}</span>
      </div>
    </div>
  );
}

// ── Time slot row ────────────────────────────────────────────────────────────

function TimeSlotRow({ slot }) {
  const [open, setOpen] = useState(false);
  if (slot.bookingCount === 0) return null;

  const hasVip = slot.bookings.some((b) => b.vip);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-h-[44px] items-center gap-2 py-2"
        aria-expanded={open}
      >
        <span className="w-14 shrink-0 font-data text-[12px] text-cyan/80">{fmtTime(slot.time)}</span>
        <span className="flex-1 text-left text-[13px] text-cream/85">
          {slot.pax} pax · {slot.bookingCount} {slot.bookingCount === 1 ? 'booking' : 'bookings'}
        </span>
        {hasVip && <span className="shrink-0 font-data text-[10px] text-gold">★</span>}
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="mb-1 rounded-xl bg-charcoal/60 px-3 pb-1">
          {slot.bookings.map((b) => (
            <BookingRow key={b.bookingId} booking={b} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Service card ─────────────────────────────────────────────────────────────

function ServiceCard({ service }) {
  const [open, setOpen] = useState(false);
  const { serviceName, window: win, totalBookedPax, vipCount, walkInPrediction, timeSlots } = service;
  const nonEmptySlots = (timeSlots || []).filter((s) => s.bookingCount > 0);

  return (
    <div className="rounded-2xl border border-hairline bg-surface">
      {/* Summary header — always visible, tap to expand */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-h-[44px] items-start justify-between gap-2 px-3.5 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex-1">
          <p className="text-sm font-bold text-cream/95">{serviceName}</p>
          <p className="font-data text-[11px] text-cream/45">{win}</p>
          <p className="mt-1 font-data text-[13px] text-cyan">{totalBookedPax} pax booked</p>

          {walkInPrediction && (
            <p className="mt-0.5 text-[12px] text-cream/60">
              Expected walk-ins:{' '}
              <span className="text-cream/85">
                ~{walkInPrediction.low}–{walkInPrediction.high}
              </span>{' '}
              based on last week's trend{' '}
              <span
                className="inline-flex h-4 w-4 cursor-default items-center justify-center rounded-full border border-cream/25 font-data text-[9px] text-cream/40"
                title={walkInPrediction.confidenceLabel}
                aria-label={walkInPrediction.confidenceLabel}
              >
                ⓘ
              </span>
            </p>
          )}

          {vipCount > 0 && (
            <p className="mt-1 font-data text-[12px] font-semibold text-gold">
              ★ {vipCount} VIP {vipCount === 1 ? 'booking' : 'bookings'} today
            </p>
          )}
        </div>
        <ChevronIcon open={open} />
      </button>

      {/* Time slot drilldown */}
      {open && nonEmptySlots.length > 0 && (
        <div className="border-t border-hairline px-3.5 pb-2">
          <Label>Time slots</Label>
          <div className="mt-1 flex flex-col divide-y divide-hairline/60">
            {nonEmptySlots.map((slot) => (
              <TimeSlotRow key={slot.time} slot={slot} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Top-level section ────────────────────────────────────────────────────────

export default function ReservationsSection({ reservations }) {
  if (!reservations || !reservations.services?.length) return null;

  const { date, services } = reservations;

  // Day-level totals for the section header.
  const totalPax = services.reduce((s, sv) => s + sv.totalBookedPax, 0);
  const totalVips = services.reduce((s, sv) => s + sv.vipCount, 0);

  const serviceCountLabel =
    services.length === 1
      ? `1 service`
      : `${services.length} services`;

  return (
    <section
      data-testid="reservations-section"
      className="flex flex-col gap-3"
      aria-label="Reservations"
    >
      {/* Section header */}
      <div>
        <p className="font-data text-[10px] uppercase tracking-wider text-cream/40">
          Reservations
        </p>
        <h3 className="text-sm font-bold text-gold">
          {fmtDate(date)} · {serviceCountLabel}
        </h3>
        <p className="font-data text-[12px] text-cream/60">
          {totalPax} pax booked today
          {totalVips > 0 && (
            <span className="ml-2 text-gold">· ★ {totalVips} VIP</span>
          )}
        </p>
      </div>

      {/* One card per service */}
      {services.map((service) => (
        <ServiceCard key={service.serviceCategory} service={service} />
      ))}
    </section>
  );
}
