// BottomNav — Option A spec (MIS-230). Role-specific tab bar.
// Tab configuration is derived from roleTier at login and is immutable for the
// session. Active tab: gold icon + label + 2px gold indicator at top.
// Inactive: cream-40 (muted). Safe-area-inset-bottom applied for iPhone.
//
// Props:
//   roleTier: number (from session — 7=Gaming Attendant, 5=Duty Manager, 4=Venue Manager)
//   active: string (tab id)
//   onChange(tabId): select a tab
//   alertCount?: number (unacknowledged compliance alerts)
import React from 'react';

// Role tier → tab configuration (spec section 5)
const NAV_CONFIG = {
  7: [ // Gaming Attendant
    { id: 'chat',       label: 'Chat',       Icon: ChatIcon },
    { id: 'compliance', label: 'Compliance', Icon: ShieldIcon },
    { id: 'incidents',  label: 'Incidents',  Icon: ExclamationIcon },
    { id: 'shift',      label: 'Shift',      Icon: ClockIcon },
  ],
  5: [ // Duty Manager
    { id: 'chat',       label: 'Chat',      Icon: ChatIcon },
    { id: 'run_sheet',  label: 'Run Sheet', Icon: ClipboardIcon },
    { id: 'bookings',   label: 'Bookings',  Icon: CalendarIcon },
    { id: 'labour',     label: 'Labour',    Icon: UserGroupIcon },
    { id: 'alerts',     label: 'Alerts',    Icon: BellIcon },
  ],
  4: [ // Venue Manager
    { id: 'chat',       label: 'Chat',     Icon: ChatIcon },
    { id: 'run_sheet',  label: 'Run Sheet',Icon: ClipboardIcon },
    { id: 'labour',     label: 'Labour',   Icon: UserGroupIcon },
    { id: 'revenue',    label: 'Revenue',  Icon: ChartBarIcon },
    { id: 'reports',    label: 'Reports',  Icon: DocumentIcon },
  ],
};

// Fallback for unknown tiers — chat only
const DEFAULT_TABS = [{ id: 'chat', label: 'Chat', Icon: ChatIcon }];

export default function BottomNav({ roleTier, active, onChange, alertCount = 0 }) {
  const tabs = NAV_CONFIG[roleTier] || DEFAULT_TABS;
  return (
    <nav
      aria-label="Primary navigation"
      style={{
        height: 56,
        paddingBottom: 'env(safe-area-inset-bottom)',
        background: 'var(--charcoal)',
        borderTop: '1px solid var(--gold-25)',
        display: 'flex',
        alignItems: 'stretch',
        flexShrink: 0,
      }}
    >
      {tabs.map(({ id, label, Icon }) => {
        const isActive = active === id;
        const showBadge = id === 'alerts' && alertCount > 0;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={isActive ? 'page' : undefined}
            aria-label={showBadge ? `${label}, ${alertCount} alert${alertCount > 1 ? 's' : ''}` : label}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              padding: 0,
              position: 'relative',
              minHeight: 'unset',
              transition: 'opacity 0.15s',
            }}
          >
            {/* Gold indicator bar at top of active tab */}
            {isActive && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '20%',
                  right: '20%',
                  height: 2,
                  background: 'var(--gold)',
                  borderRadius: '0 0 2px 2px',
                }}
              />
            )}

            <span style={{ position: 'relative', display: 'flex' }}>
              <Icon color={isActive ? 'var(--gold)' : 'var(--cream-40)'} />
              {showBadge && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -8,
                    background: 'var(--red)',
                    color: 'var(--charcoal)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1,
                    padding: '2px 4px',
                    borderRadius: 8,
                    minWidth: 16,
                    textAlign: 'center',
                  }}
                >
                  {alertCount}
                </span>
              )}
            </span>

            <span
              style={{
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: isActive ? 'var(--gold)' : 'var(--cream-40)',
                lineHeight: 1,
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// ---- Icons (22×22, stroke-based, currentColor via color prop) ----

const S = { fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

function ChatIcon({ color }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12Z" {...S} stroke={color} />
    </svg>
  );
}

function ShieldIcon({ color }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 4 6.5v5c0 4.5 3.5 8.7 8 9.5 4.5-.8 8-5 8-9.5v-5L12 3Z" {...S} stroke={color} />
      <path d="m9 12 2 2 4-4" {...S} stroke={color} />
    </svg>
  );
}

function ExclamationIcon({ color }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" {...S} stroke={color} />
    </svg>
  );
}

function ClockIcon({ color }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" {...S} stroke={color} />
      <path d="M12 7v5l3 3" {...S} stroke={color} />
    </svg>
  );
}

function ClipboardIcon({ color }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4h6a1 1 0 0 1 1 1H8a1 1 0 0 1 1-1Z" {...S} stroke={color} />
      <path d="M8 5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2" {...S} stroke={color} />
      <path d="m8.5 12 1.5 1.5L13 10" {...S} stroke={color} />
      <path d="M8.5 17h7" {...S} stroke={color} />
    </svg>
  );
}

function CalendarIcon({ color }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" {...S} stroke={color} />
      <path d="M16 2v4M8 2v4M3 10h18" {...S} stroke={color} />
    </svg>
  );
}

function UserGroupIcon({ color }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" {...S} stroke={color} />
      <path d="M3 20a6 6 0 0 1 12 0" {...S} stroke={color} />
      <path d="M16 6a3 3 0 0 1 0 6" {...S} stroke={color} />
      <path d="M20 20a4 4 0 0 0-7-2.7" {...S} stroke={color} />
    </svg>
  );
}

function BellIcon({ color }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" {...S} stroke={color} />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" {...S} stroke={color} />
    </svg>
  );
}

function ChartBarIcon({ color }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 20V10M12 20V4M6 20v-6" {...S} stroke={color} />
    </svg>
  );
}

function DocumentIcon({ color }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" {...S} stroke={color} />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" {...S} stroke={color} />
    </svg>
  );
}
