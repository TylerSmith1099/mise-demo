// MyDevelopmentScreen — Progression Tracker, Feature 1: Individual Development Profile.
// MIS-536 / MIS-521 spec. Mobile-first, 375px base. No sub-12px text (Standard 8).
//
// Data dependency: GET /api/development-profile
//   { staffName, role, knowledgeAreas[], recentActivity, certifications[], nudge, sessionCount }
//
// Rendered for tier 7 (Gaming Attendant). Also used by tier 5 for self-view
// if navigated to the "Growth" tab directly.
import React, { useEffect, useState } from 'react';
import { fetchDevelopmentProfile } from '../api.js';

// Signal → colour mapping using Deep Meridian brand tokens.
const SIGNAL_CONFIG = {
  solid:   { label: 'Solid',   color: 'var(--mint)',  bg: 'rgba(0,232,122,0.12)',  icon: '●' },
  active:  { label: 'Active',  color: 'var(--cyan)',  bg: 'rgba(0,200,232,0.12)',  icon: '●' },
  growing: { label: 'Growing', color: 'var(--gold)',  bg: 'rgba(46,107,174,0.15)', icon: '●' },
  watch:   { label: 'Watch',   color: 'var(--amber)', bg: 'rgba(232,160,32,0.12)', icon: '●' },
};

// Cert status → colour and icon.
const CERT_CONFIG = {
  current:  { color: 'var(--mint)',  icon: '✓' },
  expiring: { color: 'var(--amber)', icon: '!' },
  expired:  { color: 'var(--red)',   icon: '✗' },
};

function lastEngagedLabel(daysAgo) {
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return `${daysAgo} days ago`;
}

export default function MyDevelopmentScreen({ onAuthError }) {
  const [state, setState] = useState({ status: 'loading', profile: null });

  useEffect(() => {
    let live = true;
    fetchDevelopmentProfile()
      .then((p) => live && setState({ status: 'ready', profile: p }))
      .catch((err) => {
        if (err.status === 401) return onAuthError?.();
        live && setState({ status: 'error', profile: null });
      });
    return () => { live = false; };
  }, [onAuthError]);

  if (state.status === 'loading') {
    return <LoadingState />;
  }
  if (state.status === 'error') {
    return <ErrorState />;
  }

  const { profile } = state;

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        paddingBottom: 24,
      }}
    >
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
          My Development
        </p>
        <h1
          style={{
            margin: '0 0 2px',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--cream)',
            lineHeight: 1.2,
          }}
        >
          {profile.staffName}
        </h1>
        <p
          style={{
            margin: 0,
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 14,
            color: 'var(--text-sub)',
          }}
        >
          {profile.role}
        </p>
        {/* Session count — shows Mise is tracking */}
        {profile.sessionCount > 0 && (
          <p
            style={{
              margin: '8px 0 0',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            {profile.sessionCount} Mise sessions — your development picture builds with every shift
          </p>
        )}
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Knowledge Areas */}
        <Section title="Knowledge Areas">
          {profile.knowledgeAreas.length === 0 ? (
            <EmptyProfileState />
          ) : (
            profile.knowledgeAreas.map((area) => (
              <KnowledgeAreaRow key={area.category} area={area} />
            ))
          )}
        </Section>

        {/* Recent Activity */}
        {profile.recentActivity?.topics?.length > 0 && (
          <Section title="Recent Activity">
            <div
              style={{
                background: 'var(--surface-1)',
                borderRadius: 10,
                padding: '14px 16px',
                border: '1px solid var(--gold-25)',
              }}
            >
              <p
                style={{
                  margin: '0 0 8px',
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  fontSize: 14,
                  color: 'var(--text-sub)',
                  lineHeight: 1.4,
                }}
              >
                This week you asked about:
              </p>
              <p
                style={{
                  margin: 0,
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  fontSize: 15,
                  color: 'var(--cream)',
                  lineHeight: 1.5,
                }}
              >
                {profile.recentActivity.topics.join(', ')}
                {profile.recentActivity.totalTopics > profile.recentActivity.topics.length && (
                  <span style={{ color: 'var(--text-sub)' }}>
                    {' '}and {profile.recentActivity.totalTopics - profile.recentActivity.topics.length} more
                  </span>
                )}
                .
              </p>
            </div>
          </Section>
        )}

        {/* Certifications */}
        {profile.certifications?.length > 0 && (
          <Section title="Certifications">
            <div
              style={{
                background: 'var(--surface-1)',
                borderRadius: 10,
                border: '1px solid var(--gold-25)',
                overflow: 'hidden',
              }}
            >
              {profile.certifications.map((cert, i) => (
                <CertRow
                  key={cert.type}
                  cert={cert}
                  isLast={i === profile.certifications.length - 1}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Learning Nudge */}
        {profile.nudge && (
          <Section title="Learning Nudge">
            <NudgeCard nudge={profile.nudge} />
          </Section>
        )}

        {/* No nudge + completed profile: positive reinforcement */}
        {!profile.nudge && profile.knowledgeAreas.length > 0 && (
          <div
            style={{
              marginTop: 8,
              padding: '12px 16px',
              background: 'rgba(0,232,122,0.07)',
              borderRadius: 10,
              border: '1px solid rgba(0,232,122,0.2)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 14,
                color: 'var(--mint)',
                lineHeight: 1.5,
              }}
            >
              No active learning nudges — you're on track. Keep it up.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
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
        {title}
      </p>
      {children}
    </div>
  );
}

function KnowledgeAreaRow({ area }) {
  const sig = SIGNAL_CONFIG[area.signal] || SIGNAL_CONFIG.watch;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '13px 16px',
        background: 'var(--surface-1)',
        borderRadius: 10,
        border: '1px solid var(--gold-25)',
        marginBottom: 8,
        minHeight: 44,
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 15,
            fontWeight: 500,
            color: 'var(--cream)',
            lineHeight: 1.3,
          }}
        >
          {area.category}
        </p>
        {area.lastEngagedDaysAgo != null && (
          <p
            style={{
              margin: '2px 0 0',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1,
            }}
          >
            {lastEngagedLabel(area.lastEngagedDaysAgo)}
          </p>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          background: sig.bg,
          borderRadius: 20,
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            fontSize: 8,
            color: sig.color,
            lineHeight: 1,
          }}
        >
          ●
        </span>
        <span
          style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: sig.color,
            lineHeight: 1,
          }}
        >
          {sig.label}
        </span>
      </div>
    </div>
  );
}

function CertRow({ cert, isLast }) {
  const config = CERT_CONFIG[cert.status] || CERT_CONFIG.current;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '13px 16px',
        borderBottom: isLast ? 'none' : '1px solid var(--gold-25)',
        minHeight: 44,
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 14,
            fontWeight: 700,
            color: config.color,
            width: 16,
            textAlign: 'center',
            lineHeight: 1,
          }}
        >
          {config.icon}
        </span>
        <span
          style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--cream)',
            lineHeight: 1,
          }}
        >
          {cert.type}
        </span>
      </div>
      <div style={{ textAlign: 'right' }}>
        <p
          style={{
            margin: 0,
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 14,
            fontWeight: 500,
            color: config.color,
            lineHeight: 1.2,
          }}
        >
          {cert.label}
        </p>
        {cert.expiresLabel && (
          <p
            style={{
              margin: '2px 0 0',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1,
            }}
          >
            expires {cert.expiresLabel}
          </p>
        )}
      </div>
    </div>
  );
}

function NudgeCard({ nudge }) {
  return (
    <div
      style={{
        background: 'var(--surface-2)',
        borderRadius: 10,
        padding: '16px',
        border: '1px solid var(--gold-25)',
      }}
    >
      <p
        style={{
          margin: '0 0 12px',
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: 15,
          color: 'var(--cream)',
          lineHeight: 1.5,
        }}
      >
        {nudge.text}
      </p>
      {nudge.actionLabel && (
        <button
          type="button"
          style={{
            display: 'block',
            width: '100%',
            padding: '12px 16px',
            background: 'var(--gold)',
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--charcoal)',
            textAlign: 'center',
            minHeight: 44,
          }}
        >
          {nudge.actionLabel} →
        </button>
      )}
    </div>
  );
}

function EmptyProfileState() {
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        borderRadius: 10,
        padding: '24px 16px',
        border: '1px solid var(--gold-25)',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: 15,
          color: 'var(--text-sub)',
          lineHeight: 1.5,
        }}
      >
        Your development picture builds as you use Mise. Ask your first question to get started.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 12,
      }}
    >
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 14,
          color: 'var(--text-sub)',
        }}
      >
        Building your profile...
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 12,
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
        Couldn't load your development profile. Check your connection and try again.
      </p>
    </div>
  );
}
