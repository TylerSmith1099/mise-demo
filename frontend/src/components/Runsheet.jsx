// Run Sheet — rebuilt 9-section duty manager screen (MIS-639 / MIS-626 W3).
// Source spec: Mise-RunSheet-Component-Spec-V1.md (MIS-637) + RunSheet-Rebuild-UX-V1.md (MIS-638).
//
// Section order (locked per HoP spec):
//   1. Today's context header   — always expanded
//   2. Compliance / alerts       — expanded if any critical alert
//   3. Staff roster              — collapsed to counts
//   4. Sports calendar           — collapsed
//   5. Chef specials + 86        — collapsed
//   6. Bookings summary          — collapsed (absent for tier 7)
//   7. Shift incentives          — collapsed
//   8. Daily budget + labour     — collapsed (absent for tier 7)
//   9. Handover notes            — always last
//
// Role-scoping is server-side: sections absent from the payload are not rendered.
// Props:
//   onAuthError(): called on 401 to drop back to <Login>
//   roleTier: from verified session (used for UI hints only — sections controlled by server)
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  fetchRunSheetFull,
  acknowledgeRunSheetAlert,
  saveHandoverNote,
} from '../api.js';

// ─── constants ───────────────────────────────────────────────────────────────

const SEVERITY = {
  critical: { bg: 'bg-red/15', border: 'border-red', text: 'text-red',    dot: '#E85050' },
  warning:  { bg: 'bg-amber/15', border: 'border-amber', text: 'text-amber',  dot: '#E8A020' },
  advisory: { bg: 'bg-blue-main/15', border: 'border-blue-main', text: 'text-blue-light', dot: '#2E6BAE' },
  ok:       { bg: 'bg-mint/10', border: 'border-mint', text: 'text-mint',   dot: '#00E87A' },
};

const CERT_STATUS = {
  ok:       { color: 'text-mint',  bg: 'bg-mint/10 border-mint/30' },
  expiring: { color: 'text-amber', bg: 'bg-amber/10 border-amber/30' },
  expired:  { color: 'text-red',   bg: 'bg-red/10 border-red/30' },
  missing:  { color: 'text-red',   bg: 'bg-red/10 border-red/30' },
};

function hhmm(iso, tz = 'Australia/Brisbane') {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
  });
}

// ─── shared UI atoms ──────────────────────────────────────────────────────────

function SectionCard({ id, title, badge, statusDot, defaultOpen = false, children, sectionRef }) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (sectionRef) sectionRef.current = { open: () => setOpen(true) };
  }, [sectionRef]);

  return (
    <div id={id} className="rounded-2xl border border-hairline bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        {statusDot && (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: statusDot }}
            aria-hidden="true"
          />
        )}
        <span className="flex-1 font-display text-[18px] font-semibold text-cream">{title}</span>
        {badge && (
          <span className="font-data text-[13px] text-cream/50 mr-1 truncate max-w-[160px]">{badge}</span>
        )}
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          className={`text-cream/40 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}

function EmptyState({ message, tone = 'muted' }) {
  const cls = tone === 'ok'
    ? 'text-mint bg-mint/10 border-mint/30'
    : 'text-cream/50 bg-surface-2 border-hairline';
  return (
    <div className={`rounded-xl border px-4 py-3 text-[14px] ${cls}`}>{message}</div>
  );
}

// ─── Section 1: Context Header ────────────────────────────────────────────────

function ContextHeader({ header }) {
  if (!header) return <Skeleton className="h-20 w-full" />;
  return (
    <div className="rounded-2xl border border-hairline bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-data text-[12px] uppercase tracking-wider text-text-sub">
            {header.venueName}
          </p>
          <p className="font-display text-[16px] font-semibold text-cream mt-0.5">
            {header.shiftLabel
              ? `${header.dateLabel} · ${header.shiftLabel}`
              : header.dateLabel}
          </p>
          <p className="font-data text-[13px] text-text-sub mt-0.5">
            {hhmm(header.shiftStart)} – {hhmm(header.shiftEnd)}
          </p>
        </div>
        {header.weather && (
          <div className="text-right shrink-0">
            <p className="font-data text-[18px] font-bold" style={{ color: '#5A9BD4' }}>
              {header.weather.temperatureC}°C
            </p>
            <p className="font-sans text-[12px] text-cream/50">
              {header.weather.conditionLabel}
            </p>
          </div>
        )}
      </div>
      {header.publicHoliday && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
          <span className="font-sans text-[13px] text-amber">
            {header.publicHoliday.name} — penalty rates apply
          </span>
        </div>
      )}
      {header.tradingHoursOverride && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-blue-main/30 bg-blue-main/10 px-2.5 py-1">
          <span className="font-sans text-[13px] text-blue-light">
            {header.tradingHoursOverride}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Section 2: Compliance Alerts ────────────────────────────────────────────

function AlertsSection({ alerts, onAck, sectionRef }) {
  const [expanded, setExpanded] = useState({});
  const [ackLoading, setAckLoading] = useState({});
  const hasCritical = alerts.some((a) => a.severity === 'critical');

  const toggleAlert = (id) =>
    setExpanded((s) => ({ ...s, [id]: !s[id] }));

  const handleAck = async (alert) => {
    setAckLoading((s) => ({ ...s, [alert.alertId]: true }));
    try {
      await acknowledgeRunSheetAlert({ refId: alert.alertId, alertType: alert.alertType });
      onAck(alert.alertId);
    } catch (_) {}
    finally { setAckLoading((s) => ({ ...s, [alert.alertId]: false })); }
  };

  return (
    <SectionCard
      id="section-alerts"
      title="Compliance"
      badge={alerts.length > 0 ? `${alerts.length} flag${alerts.length === 1 ? '' : 's'}` : null}
      statusDot={hasCritical ? SEVERITY.critical.dot : alerts.length > 0 ? SEVERITY.warning.dot : SEVERITY.ok.dot}
      defaultOpen={hasCritical || alerts.length > 0}
      sectionRef={sectionRef}
    >
      {alerts.length === 0 ? (
        <EmptyState message="No open compliance items for this shift." tone="ok" />
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map((alert) => {
            const sev = SEVERITY[alert.severity] || SEVERITY.warning;
            const isOpen = expanded[alert.alertId];
            return (
              <div
                key={alert.alertId}
                className={`rounded-xl border ${sev.border} ${sev.bg} overflow-hidden`}
              >
                <button
                  type="button"
                  onClick={() => toggleAlert(alert.alertId)}
                  className="flex min-h-[44px] w-full items-center gap-3 px-3 py-3 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sev.dot }} aria-hidden="true" />
                  <span className={`flex-1 text-[14px] font-medium ${sev.text}`}>{alert.label}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    className={`text-cream/40 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {isOpen && alert.severity === 'critical' && (
                  <div className="px-3 pb-3">
                    <p className="text-[13px] text-cream/70 mb-2">
                      Tap Acknowledge to log this alert as seen and actioned.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleAck(alert)}
                      disabled={ackLoading[alert.alertId]}
                      className="rounded-lg border border-amber/40 bg-amber/15 px-4 py-2 font-sans text-[13px] font-semibold text-amber disabled:opacity-50"
                    >
                      {ackLoading[alert.alertId] ? 'Logging…' : 'Acknowledge'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Section 3: Staff Roster ──────────────────────────────────────────────────

function RosterSection({ roster, sectionRef }) {
  const { groups = [] } = roster || {};
  const countBadge = groups
    .slice(0, 3)
    .map((g) => `${g.label.split('/')[0].trim().split(' ')[0]} ${g.members.length}`)
    .join(' · ');

  return (
    <SectionCard id="section-roster" title="Staff Roster" badge={countBadge} sectionRef={sectionRef}>
      {groups.length === 0 ? (
        <EmptyState message="No roster published for this shift." />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.groupKey}>
              <div className="mb-2 flex items-center gap-2">
                <span className="font-sans text-[12px] font-semibold uppercase tracking-wider text-text-sub">
                  {group.label}
                </span>
                <span className="font-data text-[12px] text-cream/40">{group.members.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {group.members.map((m) => (
                  <RosterRow key={m.staffId} member={m} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function RosterRow({ member }) {
  const statusColour =
    member.status === 'active'    ? '#00E87A'
    : member.status === 'scheduled' ? '#5A9BD4'
    : '#E8A020';
  return (
    <div className="flex min-h-[52px] items-start gap-3 rounded-xl border border-hairline bg-surface-2 px-3 py-2.5">
      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: statusColour }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-editorial text-[15px] font-semibold text-cream">{member.name}</span>
          {member.isCurrentUser && (
            <span className="rounded-md border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-sans text-[11px] text-blue-bright">
              You
            </span>
          )}
        </div>
        <p className="font-sans text-[13px] text-cream/60">
          {member.role} · {hhmm(member.shiftStart)}–{hhmm(member.shiftEnd)}
        </p>
        <p className="font-data text-[12px] text-cream/40">Break: {member.breakLabel}</p>
        {member.certs?.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {member.certs.map((c) => {
              const s = CERT_STATUS[c.status] || CERT_STATUS.ok;
              return (
                <span
                  key={c.type}
                  className={`rounded-md border px-2 py-0.5 font-sans text-[11px] font-semibold ${s.bg} ${s.color}`}
                >
                  {c.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section 4: Sports ────────────────────────────────────────────────────────

function SportsSection({ sports }) {
  const badge = sports?.[0]
    ? `${sports[0].competition || ''} ${sports[0].startTime || ''}`.trim()
    : null;
  return (
    <SectionCard id="section-sports" title="Sport" badge={badge}>
      {!sports?.length ? (
        <EmptyState message="No fixtures today." />
      ) : (
        <div className="flex flex-col gap-3">
          {sports.map((event) => (
            <div key={event.eventId} className="rounded-xl border border-hairline bg-surface-2 px-3 py-3">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="font-editorial text-[15px] font-semibold text-cream">
                      {event.teams || event.eventName}
                    </p>
                    {event.isSoundOn && (
                      <span className="rounded-md border border-mint/40 bg-mint/10 px-2 py-0.5 font-sans text-[11px] font-semibold text-mint">
                        SOUND ON
                      </span>
                    )}
                  </div>
                  <p className="font-data text-[13px] text-cream/60">
                    {event.competition} · {event.startTime} · {event.channelLabel}
                  </p>
                  {event.screens?.length > 0 && (
                    <p className="font-sans text-[12px] text-text-sub mt-0.5">
                      {event.screens.map((s) => s.label).join(', ')}
                    </p>
                  )}
                </div>
                {event.crowdImpact && (
                  <span
                    className={`rounded-md border px-2 py-0.5 font-sans text-[11px] font-semibold shrink-0 ${
                      event.crowdImpact === 'high'   ? 'border-amber/40 bg-amber/10 text-amber' :
                      event.crowdImpact === 'medium' ? 'border-gold/30 bg-gold/10 text-blue-light' :
                      'border-hairline bg-surface text-cream/50'
                    }`}
                  >
                    {event.crowdImpact.charAt(0).toUpperCase() + event.crowdImpact.slice(1)} crowd
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Section 5: Specials + 86 ─────────────────────────────────────────────────

function SpecialsSection({ specials: data }) {
  const specials  = data?.specials  || [];
  const eightySix = data?.eightySix || [];
  const badge = `${specials.length} special${specials.length === 1 ? '' : 's'} · ${eightySix.length} 86'd`;
  return (
    <SectionCard id="section-specials" title="Specials + 86" badge={badge}>
      {specials.length === 0 && eightySix.length === 0 ? (
        <EmptyState message="No specials or 86 items today." />
      ) : (
        <div className="flex flex-col gap-3">
          {specials.length > 0 && (
            <div>
              <p className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-wider text-text-sub">
                Tonight's Specials
              </p>
              <div className="flex flex-col gap-2">
                {specials.map((s) => (
                  <div key={s.id} className="rounded-xl border border-hairline bg-surface-2 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap flex-1">
                        <p className="font-editorial text-[15px] font-semibold text-cream">{s.dishName}</p>
                        {s.isPushed && (
                          <span className="rounded-md border border-gold/30 bg-gold/10 px-1.5 py-0.5 font-sans text-[11px] text-blue-bright">
                            Push tonight
                          </span>
                        )}
                      </div>
                      <p className="font-data text-[15px] font-bold shrink-0" style={{ color: '#D4A060' }}>
                        ${s.priceDollars}
                      </p>
                    </div>
                    {s.description && (
                      <p className="font-sans text-[13px] text-cream/60 mt-0.5">{s.description}</p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(s.allergenTags || []).map((tag) => (
                        <span key={tag} className="rounded-md border border-mint/30 bg-mint/10 px-2 py-0.5 font-sans text-[11px] font-semibold text-mint">
                          {tag}
                        </span>
                      ))}
                      {s.availableCount != null && (
                        <span className="rounded-md border border-hairline px-2 py-0.5 font-data text-[11px] text-cream/50">
                          {s.availableCount} remaining
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {eightySix.length > 0 && (
            <div>
              <p className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-wider text-text-sub">
                86'd
              </p>
              <div className="flex flex-wrap gap-2">
                {eightySix.map((e) => (
                  <div key={e.id} className="rounded-xl border border-red/30 bg-red/10 px-3 py-2">
                    <p className="font-editorial text-[14px] font-semibold text-red">{e.itemName}</p>
                    <p className="font-sans text-[12px] text-cream/50">
                      {e.category === 'bar' ? 'Bar' : 'Kitchen'}
                      {e.reason ? ` · ${e.reason}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Section 6: Bookings ──────────────────────────────────────────────────────

function BookingsSection({ bookings }) {
  return (
    <SectionCard
      id="section-bookings"
      title="Bookings"
      badge={bookings ? `${bookings.totalCovers} covers` : '—'}
    >
      {!bookings ? (
        <EmptyState message="No bookings yet." />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            {[
              { label: 'Total', value: bookings.totalCovers, color: '#5A9BD4' },
              { label: 'Lunch', value: bookings.lunchCovers, color: null },
              { label: 'Dinner', value: bookings.dinnerCovers, color: null },
            ].map((stat) => (
              <div key={stat.label} className="flex-1 rounded-xl border border-hairline bg-surface-2 px-3 py-2 text-center">
                <p className="font-data text-[22px] font-bold" style={stat.color ? { color: stat.color } : {}}>
                  {stat.value}
                </p>
                <p className="font-sans text-[12px] text-cream/50">{stat.label}</p>
              </div>
            ))}
          </div>
          {bookings.largeGroups?.length > 0 && (
            <div>
              <p className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-wider text-text-sub">
                Large Groups (8+)
              </p>
              <div className="flex flex-col gap-2">
                {bookings.largeGroups.map((g) => (
                  <div key={g.id} className="rounded-xl border border-hairline bg-surface-2 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap flex-1">
                        <p className="font-editorial text-[15px] font-semibold text-cream">{g.guestName}</p>
                        {g.vip && (
                          <span className="rounded-md border border-amber/40 bg-amber/10 px-1.5 py-0.5 font-sans text-[11px] text-amber">
                            VIP
                          </span>
                        )}
                      </div>
                      <p className="font-data text-[15px] font-bold shrink-0" style={{ color: '#5A9BD4' }}>
                        {g.pax} pax
                      </p>
                    </div>
                    <p className="font-data text-[13px] text-cream/60">
                      {g.time} · {g.area}{g.occasion ? ` · ${g.occasion}` : ''}
                    </p>
                    {g.dietary?.length > 0 && (
                      <p className="font-sans text-[12px] text-text-sub mt-0.5">Dietary: {g.dietary.join(', ')}</p>
                    )}
                    {g.specialRequirements && (
                      <p className="font-sans text-[12px] text-amber mt-0.5">{g.specialRequirements}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Section 7: Incentives ────────────────────────────────────────────────────

function IncentivesSection({ incentives }) {
  const badge = incentives?.length > 0 ? incentives[0].name : null;
  return (
    <SectionCard id="section-incentives" title="Incentives" badge={badge}>
      {!incentives?.length ? (
        <EmptyState message="No incentives this shift." />
      ) : (
        <div className="flex flex-col gap-3">
          {incentives.map((inc) => (
            <div key={inc.id} className="rounded-xl border border-hairline bg-surface-2 px-3 py-3">
              <p className="font-editorial text-[15px] font-semibold text-cream">{inc.name}</p>
              {inc.targetDescription && (
                <p className="font-sans text-[13px] text-cream/70 mt-0.5">{inc.targetDescription}</p>
              )}
              {inc.rewardDescription && (
                <p className="font-sans text-[13px] text-amber mt-1">{inc.rewardDescription}</p>
              )}
              {inc.leaderboard?.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 font-sans text-[11px] uppercase tracking-wider text-text-sub">
                    Leaderboard
                  </p>
                  {inc.leaderboard.map((row) => (
                    <div key={row.rank} className="flex items-center gap-3 py-1">
                      <span className="font-data text-[12px] text-cream/40 w-4">{row.rank}.</span>
                      <span className="font-editorial text-[14px] flex-1 text-cream/80">{row.name}</span>
                      <span className="font-data text-[14px] font-bold" style={{ color: '#D4A060' }}>
                        {row.score}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Section 8: Budget + Labour ───────────────────────────────────────────────

function BudgetSection({ budget }) {
  if (!budget) {
    return (
      <SectionCard id="section-budget" title="Budget">
        <EmptyState message="Targets not set for today." />
      </SectionCard>
    );
  }
  const { departments, labourSnapshot } = budget;
  const total  = departments.reduce((s, d) => s + d.budgetDollars, 0);
  const actual = departments.reduce((s, d) => s + d.actualDollars, 0);
  const pct    = total > 0 ? Math.round((actual / total) * 100) : 0;
  return (
    <SectionCard
      id="section-budget"
      title="Budget"
      badge={`$${Math.round(total / 1000)}k target · ${pct}%`}
      statusDot={pct >= 80 ? '#00E87A' : '#E8A020'}
    >
      <div className="flex flex-col gap-2">
        {labourSnapshot?.gamingLabourFlag && (
          <div
            className={`rounded-xl border px-3 py-2.5 mb-1 ${
              labourSnapshot.gamingLabourFlag === 'critical'
                ? 'border-red/40 bg-red/10'
                : 'border-amber/40 bg-amber/10'
            }`}
          >
            <p className={`font-sans text-[14px] font-semibold ${
              labourSnapshot.gamingLabourFlag === 'critical' ? 'text-red' : 'text-amber'
            }`}>
              Gaming labour {labourSnapshot.gamingLabourPct}% net RTV
              {labourSnapshot.gamingLabourFlag === 'critical' ? ' — over threshold' : ' — approaching limit'}
            </p>
          </div>
        )}
        {departments.map((d) => {
          const clr =
            d.paceStatus === 'ahead' || d.paceStatus === 'on_track' ? '#00E87A' :
            d.paceStatus === 'behind' ? '#E8A020' : '#E85050';
          return (
            <div key={d.department} className="rounded-xl border border-hairline bg-surface-2 px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-sans text-[13px] font-semibold text-cream/80 capitalize">
                  {d.department.replace(/_/g, '-')}
                </span>
                <span className="font-data text-[13px] font-bold" style={{ color: '#5A9BD4' }}>
                  ${d.actualDollars.toLocaleString()} / ${d.budgetDollars.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(d.pctToTarget, 100)}%`, background: clr }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="font-data text-[12px]" style={{ color: clr }}>{d.pctToTarget}%</span>
                {d.lastWeekDollars != null && (
                  <span className="font-data text-[12px] text-cream/40">
                    vs LW ${d.lastWeekDollars.toLocaleString()}
                    {d.varianceDollars != null && (
                      <span className={d.varianceDollars >= 0 ? ' text-mint' : ' text-red'}>
                        {' '}({d.varianceDollars >= 0 ? '+' : ''}${d.varianceDollars.toLocaleString()})
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {labourSnapshot && (
          <div className="rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 mt-1">
            <p className="font-sans text-[11px] uppercase tracking-wider text-text-sub mb-1">Labour This Shift</p>
            <p className="font-data text-[13px] text-cream/70">
              {labourSnapshot.staffCount} staff rostered
              {labourSnapshot.estCostDollars > 0 ? ` · Est. $${labourSnapshot.estCostDollars.toLocaleString()}` : ''}
              {labourSnapshot.gamingLabourPct != null ? ` · Gaming ${labourSnapshot.gamingLabourPct}% net RTV` : ''}
            </p>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Section 9: Handover Notes ────────────────────────────────────────────────

function HandoverSection({ handover, onSave }) {
  const [draft, setDraft]     = useState(handover?.current?.bodyText || '');
  const [saving, setSaving]   = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const autoRef               = useRef(null);

  useEffect(() => {
    if (!handover?.canWrite) return;
    autoRef.current = setInterval(async () => {
      if (!saving) {
        setSaving(true);
        try { await onSave(draft); setSavedAt(new Date()); }
        catch (_) {}
        finally { setSaving(false); }
      }
    }, 30000);
    return () => clearInterval(autoRef.current);
  }, [draft, handover?.canWrite, onSave, saving]);

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(draft); setSavedAt(new Date()); }
    catch (_) {}
    finally { setSaving(false); }
  };

  const fmtTime = (dt) => dt?.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <SectionCard id="section-handover" title="Handover Notes">
      <div className="flex flex-col gap-3">
        {handover?.incoming ? (
          <div className="rounded-xl border border-hairline bg-surface-2 px-3 py-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-sans text-[12px] font-semibold text-text-sub">From last shift</span>
              {handover.incoming.authorName && (
                <span className="font-data text-[12px] text-cream/50">{handover.incoming.authorName}</span>
              )}
            </div>
            {handover.incoming.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {handover.incoming.tags.map((tag) => (
                  <span key={tag} className="rounded-md border border-hairline px-2 py-0.5 font-sans text-[11px] text-cream/50">
                    {tag.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
            <p className="font-editorial text-[14px] text-cream/80 whitespace-pre-wrap leading-relaxed">
              {handover.incoming.bodyText}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber/30 bg-amber/10 px-3 py-2.5">
            <p className="font-sans text-[14px] text-amber">No handover note from last shift.</p>
          </div>
        )}

        {handover?.priorities?.length > 0 && (
          <div>
            <p className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-wider text-text-sub">
              Shift Priorities
            </p>
            {handover.priorities.map((p) => (
              <div key={p.order} className="flex gap-3 py-1.5 items-start">
                <span
                  className="shrink-0 mt-0.5 h-5 w-5 rounded-full flex items-center justify-center font-data text-[11px] font-bold text-charcoal"
                  style={{ background: '#B87A3C' }}
                >
                  {p.order}
                </span>
                <span className="font-editorial text-[14px] text-cream/80">{p.body}</span>
              </div>
            ))}
          </div>
        )}

        {handover?.canWrite && handover?.current && !handover.current.isLocked && (
          <div>
            <p className="mb-1.5 font-sans text-[12px] font-semibold uppercase tracking-wider text-text-sub">
              Your Handover Note
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add notes, incidents, equipment faults, follow-ups…"
              className="w-full min-h-[120px] rounded-xl border border-hairline bg-surface-2 px-3 py-3 font-editorial text-[14px] text-cream/80 placeholder:text-cream/30 focus:outline-none focus:border-blue-main/50 resize-none"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="font-data text-[12px] text-cream/40">
                {saving ? 'Saving…' : savedAt ? `Saved ${fmtTime(savedAt)}` : 'Auto-saves every 30s'}
              </span>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 font-sans text-[13px] font-semibold text-blue-bright disabled:opacity-50"
              >
                Save note
              </button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── root component ───────────────────────────────────────────────────────────

export default function Runsheet({ onAuthError, roleTier }) {
  const [status, setStatus]           = useState('loading');
  const [sheet, setSheet]             = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const alertsRef  = useRef(null);
  const rosterRef  = useRef(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await fetchRunSheetFull();
      setSheet(data);
      setLastUpdated(new Date());
      setStatus('ready');
    } catch (err) {
      if (err.status === 401) return onAuthError?.();
      setStatus(err.status === 404 ? 'no_shift' : 'error');
    }
  }, [onAuthError]);

  useEffect(() => { load(); }, [load]);

  const onAckAlert = useCallback((alertId) => {
    setSheet((s) => s
      ? { ...s, alerts: s.alerts.filter((a) => a.alertId !== alertId) }
      : s
    );
  }, []);

  const onSaveHandover = useCallback(async (bodyText) => {
    await saveHandoverNote({ bodyText, tags: [] });
  }, []);

  if (status === 'loading') {
    return (
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (status === 'no_shift') {
    return (
      <div className="mx-auto flex w-full max-w-[420px]">
        <div className="w-full rounded-2xl border border-hairline bg-surface px-5 py-8 text-center">
          <p className="font-display text-[16px] font-semibold text-cream">No active shift</p>
          <p className="mt-1 font-sans text-[14px] text-cream/50">
            Your run sheet will appear here when a shift is rostered.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[420px]">
        <div className="w-full rounded-2xl border border-red/30 bg-red/10 px-5 py-8 text-center">
          <p className="font-display text-[16px] font-semibold text-red">Couldn't load run sheet</p>
          <p className="mt-2 font-sans text-[14px] text-cream/50">Check your connection and try again.</p>
          <button
            type="button"
            onClick={load}
            className="mt-4 rounded-xl border border-gold/40 bg-gold/10 px-6 py-2.5 font-sans text-[14px] font-semibold text-blue-bright"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <section
      data-testid="run-sheet-full"
      className="mise-rise mx-auto flex w-full max-w-[420px] flex-col gap-3"
      aria-label="Shift run sheet"
    >
      {/* App-bar */}
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="font-data text-[12px] uppercase tracking-wider text-cream/40">Run Sheet</p>
          {lastUpdated && (
            <p className="font-data text-[11px] text-cream/30">
              Updated {lastUpdated.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          className="flex h-[44px] w-[44px] items-center justify-center rounded-xl text-cream/40 active:text-cream/80"
          aria-label="Refresh run sheet"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M3 12a9 9 0 1 0 .5-3M3 12V7m0 5H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* 1. Context Header — always visible, not collapsible */}
      <ContextHeader header={sheet?.header} />

      {/* 2. Compliance */}
      {sheet?.alerts !== undefined && (
        <AlertsSection alerts={sheet.alerts} onAck={onAckAlert} sectionRef={alertsRef} />
      )}

      {/* 3. Roster */}
      {sheet?.roster !== undefined && (
        <RosterSection roster={sheet.roster} sectionRef={rosterRef} />
      )}

      {/* 4. Sports */}
      {sheet?.sports !== undefined && (
        <SportsSection sports={sheet.sports} />
      )}

      {/* 5. Specials + 86 */}
      {sheet?.specials !== undefined && (
        <SpecialsSection specials={sheet.specials} />
      )}

      {/* 6. Bookings — server omits for tier 7 */}
      {sheet?.bookings !== undefined && (
        <BookingsSection bookings={sheet.bookings} />
      )}

      {/* 7. Incentives */}
      {sheet?.incentives !== undefined && (
        <IncentivesSection incentives={sheet.incentives} />
      )}

      {/* 8. Budget — server omits for tier 7 */}
      {sheet?.budget !== undefined && (
        <BudgetSection budget={sheet.budget} />
      )}

      {/* 9. Handover — always last */}
      {sheet?.handover !== undefined && (
        <HandoverSection handover={sheet.handover} onSave={onSaveHandover} />
      )}
    </section>
  );
}
