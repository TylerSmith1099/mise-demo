// TeamDevelopmentScreen — Progression Tracker, Feature 2: Team Development View.
// MIS-536 / MIS-521 spec. Mobile-first, 375px base. No sub-12px text (Standard 8).
//
// Data dependency: GET /api/team-development
//   { venueName, summary, staff[], teamGaps[], spotlight }
//
// Rendered for tier 5 (Duty Manager) in the "Team" tab.
// Staff tiles sorted: stagnant/flagged → watch → developing → steady → not_started.
import React, { useEffect, useState } from 'react';
import { fetchTeamDevelopment } from '../api.js';

// Development status → display config.
const STATUS_CONFIG = {
  stagnant:    { label: 'Stagnant',    color: 'var(--red)',   bg: 'rgba(232,80,80,0.12)',   flagIcon: true },
  watch:       { label: 'Watch',       color: 'var(--amber)', bg: 'rgba(232,160,32,0.12)',  flagIcon: true },
  developing:  { label: 'Developing',  color: 'var(--cyan)',  bg: 'rgba(0,200,232,0.12)',   flagIcon: false },
  steady:      { label: 'Steady',      color: 'var(--mint)',  bg: 'rgba(0,232,122,0.12)',   flagIcon: false },
  not_started: { label: 'Not Started', color: 'var(--text-muted)', bg: 'rgba(58,96,144,0.12)', flagIcon: false },
};

// Sort order: flagged/stagnant first.
const STATUS_ORDER = { stagnant: 0, watch: 1, developing: 2, steady: 3, not_started: 4 };

export default function TeamDevelopmentScreen({ onAuthError }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [selectedStaff, setSelectedStaff] = useState(null);

  useEffect(() => {
    let live = true;
    fetchTeamDevelopment()
      .then((d) => live && setState({ status: 'ready', data: d }))
      .catch((err) => {
        if (err.status === 401) return onAuthError?.();
        live && setState({ status: 'error', data: null });
      });
    return () => { live = false; };
  }, [onAuthError]);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error')   return <ErrorState />;

  const { data } = state;
  const sortedStaff = [...(data.staff || [])].sort(
    (a, b) => (STATUS_ORDER[a.developmentStatus] ?? 99) - (STATUS_ORDER[b.developmentStatus] ?? 99),
  );

  // Staff detail slide-in view
  if (selectedStaff) {
    return (
      <StaffDetailView
        staff={selectedStaff}
        onBack={() => setSelectedStaff(null)}
      />
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 24 }}>
      {/* Header */}
      <div
        style={{
          padding: '20px 16px 16px',
          borderBottom: '1px solid var(--gold-25)',
          background: 'var(--surface-1)',
        }}
      >
        <p
          style={{
            margin: '0 0 4px',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-sub)',
          }}
        >
          Team Development
        </p>
        <h1
          style={{
            margin: 0,
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--cream)',
            lineHeight: 1.2,
          }}
        >
          {data.venueName}
        </h1>
        <p
          style={{
            margin: '4px 0 0',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 13,
            color: 'var(--text-muted)',
          }}
        >
          Flags based on Mise activity — not roster status
        </p>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Summary Strip */}
        <div style={{ marginTop: 16 }}>
          <SummaryStrip summary={data.summary} />
        </div>

        {/* Staff Tiles */}
        <div style={{ marginTop: 20 }}>
          <p
            style={{
              margin: '0 0 10px',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-sub)',
            }}
          >
            Gaming Team
          </p>
          {sortedStaff.map((staff) => (
            <StaffTile
              key={staff.id}
              staff={staff}
              onTap={() => setSelectedStaff(staff)}
            />
          ))}
        </div>

        {/* Team Knowledge Gaps */}
        {data.teamGaps?.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <p
              style={{
                margin: '0 0 10px',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-sub)',
              }}
            >
              Team Knowledge Gaps
            </p>
            <div
              style={{
                background: 'var(--surface-1)',
                borderRadius: 10,
                border: '1px solid var(--gold-25)',
                overflow: 'hidden',
              }}
            >
              {data.teamGaps.map((gap, i) => (
                <GapRow
                  key={gap.topic}
                  gap={gap}
                  rank={i + 1}
                  isLast={i === data.teamGaps.length - 1}
                />
              ))}
            </div>
          </div>
        )}

        {/* Spotlight — one notably-developing staff member */}
        {data.spotlight && (
          <div
            style={{
              marginTop: 16,
              padding: '14px 16px',
              background: 'rgba(0,232,122,0.07)',
              borderRadius: 10,
              border: '1px solid rgba(0,232,122,0.2)',
            }}
          >
            <p
              style={{
                margin: '0 0 4px',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--mint)',
              }}
            >
              Notable Progress
            </p>
            <p
              style={{
                margin: 0,
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 14,
                color: 'var(--cream)',
                lineHeight: 1.5,
              }}
            >
              <strong>{data.spotlight.name}:</strong> {data.spotlight.note}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SummaryStrip({ summary }) {
  const stats = [
    { value: summary.totalStaff,      label: 'Staff' },
    { value: summary.activeThisWeek,  label: 'Active', color: 'var(--mint)' },
    { value: summary.stagnantFlags,   label: 'Stagnant', color: summary.stagnantFlags > 0 ? 'var(--red)' : 'var(--text-sub)' },
    { value: summary.openCertFlags,   label: 'Cert flags', color: summary.openCertFlags > 0 ? 'var(--amber)' : 'var(--text-sub)' },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 8,
      }}
    >
      {stats.map(({ value, label, color }) => (
        <div
          key={label}
          style={{
            background: 'var(--surface-1)',
            borderRadius: 10,
            padding: '12px 8px',
            border: '1px solid var(--gold-25)',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              margin: '0 0 3px',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 20,
              fontWeight: 700,
              color: color || 'var(--cream)',
              lineHeight: 1,
            }}
          >
            {value}
          </p>
          <p
            style={{
              margin: 0,
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1.2,
            }}
          >
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}

function StaffTile({ staff, onTap }) {
  const config = STATUS_CONFIG[staff.developmentStatus] || STATUS_CONFIG.not_started;
  const hasFlagOrCert = staff.activeFlag || staff.certFlag;

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`View ${staff.name}'s development profile`}
      style={{
        display: 'block',
        width: '100%',
        background: 'var(--surface-1)',
        borderRadius: 10,
        border: hasFlagOrCert ? `1px solid ${config.color}30` : '1px solid var(--gold-25)',
        padding: '14px 16px',
        marginBottom: 8,
        minHeight: 44,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        {/* Name + role */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            {config.flagIcon && (
              <span
                aria-hidden="true"
                style={{
                  fontSize: 14,
                  color: config.color,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ⚠
              </span>
            )}
            <span
              style={{
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--cream)',
                lineHeight: 1.2,
              }}
            >
              {staff.name}
            </span>
          </div>
          <p
            style={{
              margin: '0 0 8px',
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: 13,
              color: 'var(--text-sub)',
              lineHeight: 1.2,
            }}
          >
            {staff.role}
          </p>

          {/* Flags */}
          {staff.activeFlag && (
            <p
              style={{
                margin: '0 0 3px',
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 13,
                color: config.color,
                lineHeight: 1.4,
              }}
            >
              {staff.activeFlag}
            </p>
          )}
          {staff.certFlag && (
            <p
              style={{
                margin: 0,
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 13,
                color: 'var(--amber)',
                lineHeight: 1.4,
              }}
            >
              {staff.certFlag}
            </p>
          )}

          {/* Top strength */}
          {staff.topStrength && (
            <p
              style={{
                margin: '4px 0 0',
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 13,
                color: 'var(--text-sub)',
                lineHeight: 1.4,
              }}
            >
              Strong: {staff.topStrength}
            </p>
          )}
        </div>

        {/* Status pill + last activity */}
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px 10px',
              background: config.bg,
              borderRadius: 20,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: 13,
                fontWeight: 600,
                color: config.color,
                lineHeight: 1,
              }}
            >
              {config.label}
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1,
            }}
          >
            {staff.lastActivityLabel}
          </p>
        </div>
      </div>

      {/* Tap hint */}
      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: '1px solid var(--gold-25)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <span
          style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 12,
            color: 'var(--gold)',
          }}
        >
          View profile →
        </span>
      </div>
    </button>
  );
}

function GapRow({ gap, rank, isLast }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        padding: '13px 16px',
        borderBottom: isLast ? 'none' : '1px solid var(--gold-25)',
        gap: 12,
        minHeight: 44,
      }}
    >
      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--amber)',
          lineHeight: 1.4,
          flexShrink: 0,
          width: 16,
        }}
      >
        {rank}.
      </span>
      <div>
        <p
          style={{
            margin: '0 0 2px',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--cream)',
            lineHeight: 1.3,
          }}
        >
          {gap.topic}
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            fontSize: 13,
            color: 'var(--text-sub)',
            lineHeight: 1.4,
          }}
        >
          {gap.description}
        </p>
      </div>
    </div>
  );
}

// Read-only staff profile view — tapped from the team grid.
function StaffDetailView({ staff, onBack }) {
  const config = STATUS_CONFIG[staff.developmentStatus] || STATUS_CONFIG.not_started;

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 24 }}>
      {/* Back header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          borderBottom: '1px solid var(--gold-25)',
          background: 'var(--surface-1)',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to team"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            background: 'none',
            border: '1px solid var(--gold-25)',
            borderRadius: 8,
            cursor: 'pointer',
            color: 'var(--gold)',
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          ←
        </button>
        <div>
          <p
            style={{
              margin: '0 0 2px',
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontSize: 17,
              fontWeight: 700,
              color: 'var(--cream)',
              lineHeight: 1.2,
            }}
          >
            {staff.name}
          </p>
          <p
            style={{
              margin: 0,
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: 13,
              color: 'var(--text-sub)',
            }}
          >
            {staff.role}
          </p>
        </div>
        <div
          style={{
            marginLeft: 'auto',
            padding: '5px 10px',
            background: config.bg,
            borderRadius: 20,
          }}
        >
          <span
            style={{
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: 13,
              fontWeight: 600,
              color: config.color,
              lineHeight: 1,
            }}
          >
            {config.label}
          </span>
        </div>
      </div>

      <div style={{ padding: '16px 16px 0' }}>
        {/* Read-only notice */}
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(46,107,174,0.08)',
            borderRadius: 8,
            border: '1px solid var(--gold-25)',
            marginBottom: 16,
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: 13,
              color: 'var(--text-sub)',
              lineHeight: 1.4,
            }}
          >
            Development picture — read-only. This is for development guidance, not performance management.
          </p>
        </div>

        {/* Last activity */}
        <div
          style={{
            background: 'var(--surface-1)',
            borderRadius: 10,
            border: '1px solid var(--gold-25)',
            padding: '14px 16px',
            marginBottom: 12,
          }}
        >
          <p
            style={{
              margin: '0 0 4px',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-sub)',
            }}
          >
            Last Mise Activity
          </p>
          <p
            style={{
              margin: 0,
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: 16,
              fontWeight: 600,
              color: staff.developmentStatus === 'stagnant' ? 'var(--red)' : 'var(--cream)',
            }}
          >
            {staff.lastActivityLabel}
          </p>
        </div>

        {/* Flags */}
        {(staff.activeFlag || staff.certFlag) && (
          <div
            style={{
              background: 'var(--surface-1)',
              borderRadius: 10,
              border: `1px solid ${config.color}40`,
              padding: '14px 16px',
              marginBottom: 12,
            }}
          >
            <p
              style={{
                margin: '0 0 8px',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: config.color,
              }}
            >
              Active Flags
            </p>
            {staff.activeFlag && (
              <p
                style={{
                  margin: '0 0 4px',
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  fontSize: 14,
                  color: 'var(--cream)',
                  lineHeight: 1.4,
                }}
              >
                ⚠ {staff.activeFlag}
              </p>
            )}
            {staff.certFlag && (
              <p
                style={{
                  margin: 0,
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  fontSize: 14,
                  color: 'var(--amber)',
                  lineHeight: 1.4,
                }}
              >
                ! {staff.certFlag}
              </p>
            )}
          </div>
        )}

        {/* Top strength */}
        {staff.topStrength && (
          <div
            style={{
              background: 'rgba(0,232,122,0.07)',
              borderRadius: 10,
              border: '1px solid rgba(0,232,122,0.2)',
              padding: '14px 16px',
              marginBottom: 12,
            }}
          >
            <p
              style={{
                margin: '0 0 4px',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--mint)',
              }}
            >
              Top Strength
            </p>
            <p
              style={{
                margin: 0,
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: 15,
                color: 'var(--cream)',
              }}
            >
              {staff.topStrength}
            </p>
          </div>
        )}

        {/* Not started state */}
        {staff.developmentStatus === 'not_started' && (
          <div
            style={{
              background: 'var(--surface-1)',
              borderRadius: 10,
              border: '1px solid var(--gold-25)',
              padding: '20px 16px',
              textAlign: 'center',
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 14,
                color: 'var(--text-sub)',
                lineHeight: 1.5,
              }}
            >
              No Mise activity yet. Development picture builds as they use Mise on shift.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 14,
          color: 'var(--text-sub)',
        }}
      >
        Loading team data...
      </span>
    </div>
  );
}

function ErrorState() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: 15,
          color: 'var(--text-sub)',
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        Couldn't load team development data. Check your connection and try again.
      </p>
    </div>
  );
}
