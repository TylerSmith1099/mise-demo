/**
 * AdminDesktopHomepageContainer (MIS-430)
 *
 * Data layer for the admin desktop homepage. Fetches live data from
 * /api/admin/homepage, opens the SSE stream for real-time updates, and
 * transforms raw API rows into the shape expected by AdminDesktopHomepage.
 *
 * Architecture:
 *   - Initial load:  GET /api/admin/homepage (composite payload)
 *   - Live updates:  SSE /api/admin/stream → incidents, staff, compliance
 *   - Scheduled:     re-fetch every REFRESH_MS for revenue/labour (no streaming)
 *   - onVenueChange: re-fetch homepage with venueId filter (scope unchanged)
 *
 * Security: clientId and venueIds come from the verified JWT via scope.
 * The container never sends client_id in the request body.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import AdminDesktopHomepage from './AdminDesktopHomepage.jsx';
import AdminReportingScreen from './AdminReportingScreen.jsx';
import { fetchAdminHomepage, openAdminStream } from '../api.js';

const REFRESH_MS = 5 * 60 * 1000; // 5-minute revenue/labour poll

// ─── Data transform helpers ─────────────────────────────────────────────────

const TODAY_STR = () => new Date().toISOString().slice(0, 10);

function formatCents(cents) {
  if (cents == null) return '—';
  return '$' + Math.round(cents / 100).toLocaleString('en-AU');
}

function formatVariance(todayRev) {
  if (!todayRev || todayRev.variance_cents == null || !todayRev.forecast_revenue_cents) return null;
  const pct = Math.round((todayRev.variance_cents / todayRev.forecast_revenue_cents) * 100);
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct}% vs forecast`;
}

function labourPct(todayLabour) {
  if (!todayLabour || !todayLabour.net_revenue_cents || !todayLabour.labour_cost_cents) return '—';
  return ((todayLabour.labour_cost_cents / todayLabour.net_revenue_cents) * 100).toFixed(1);
}

// Severity_level (int 1-4) → component label (L1-L4).
function severityLabel(level) {
  return `L${level}`;
}

// Group shifts into area buckets for the floor view panel.
const AREA_RULES = [
  { test: /gaming|floor manager|gaming attendant/i, label: 'Gaming Floor' },
  { test: /bar|bistro|chef|kitchen|food/i,          label: 'Bar & Bistro' },
  { test: /security/i,                              label: 'Security' },
  { test: /manager|duty|venue|coordinator/i,        label: 'Management' },
];

function roleArea(roleName) {
  const r = AREA_RULES.find((a) => a.test.test(roleName));
  return r ? r.label : 'Other';
}

function groupStaffByArea(shifts) {
  const map = new Map();
  for (const s of shifts) {
    const area = roleArea(s.role_name || '');
    if (!map.has(area)) map.set(area, []);
    const clockIn = s.clock_in_at
      ? new Date(s.clock_in_at).toLocaleTimeString('en-AU', {
          hour: '2-digit', minute: '2-digit', hour12: false,
        })
      : '—';
    map.get(area).push({
      name:  s.full_name || 'Unknown',
      role:  s.role_name || '—',
      clockIn,
    });
  }
  // Return in the order defined in AREA_RULES (plus any "Other" at the end).
  const ordered = AREA_RULES.map((r) => r.label).filter((l) => map.has(l));
  if (map.has('Other')) ordered.push('Other');
  return ordered.map((label) => ({ label, members: map.get(label) }));
}

// Build a timeline from today's shifts and open incidents.
function buildTimeline(shifts, openIncidents) {
  const events = [];

  // Clock-in events (earliest per role area).
  const clocks = [...shifts]
    .filter((s) => s.clock_in_at)
    .sort((a, b) => new Date(a.clock_in_at) - new Date(b.clock_in_at));
  for (const s of clocks.slice(0, 4)) {
    const time = new Date(s.clock_in_at).toLocaleTimeString('en-AU', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    events.push({ time, label: `${s.full_name || s.role_name} checked in`, state: 'complete' });
  }

  // Open incidents.
  for (const i of openIncidents.slice(0, 3)) {
    const time = new Date(i.incident_at).toLocaleTimeString('en-AU', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    events.push({
      time,
      label: `L${i.severity_level} — ${i.incident_type}${i.location_in_venue ? ' · ' + i.location_in_venue : ''}`,
      state: 'incident',
    });
  }

  // "Now" marker.
  const nowTime = new Date().toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  events.push({ time: nowTime, label: 'Now', state: 'now' });

  // Sort by time string (HH:mm, same-day — good enough for MVP).
  events.sort((a, b) => {
    if (a.state === 'now') return 1;
    if (b.state === 'now') return -1;
    return a.time.localeCompare(b.time);
  });

  return events;
}

// Build colour tokens inline (mirrors the component's T object — kept in sync).
const T = {
  cyan: '#00C8E8', mint: '#00E87A', red: '#E85050', amber: '#E8A020',
};

function buildKpis(apiData) {
  const { shiftSummary, incidents, reports, revenue, labour } = apiData;
  const todayStr = TODAY_STR();
  const todayRev = revenue?.find((r) => r.business_date?.startsWith(todayStr)) || revenue?.[0];
  const todayLab = labour?.find((l) => l.business_date?.startsWith(todayStr)) || labour?.[0];

  const openIncidents = (incidents || []).filter(
    (i) => i.status === 'active' || i.status === 'open',
  );
  const pendingReports = (reports || []).filter(
    (r) => r.status === 'draft' || r.status === 'submitted' || r.status === 'escalated',
  );

  return [
    {
      label:      'Staff on Floor',
      value:      String(shiftSummary?.onFloorNow ?? 0),
      subvalue:   `${shiftSummary?.shifts?.length ?? 0} rostered`,
      accentColor: T.cyan,
      trend:      { arrow: '→', label: `${shiftSummary?.onFloorNow ?? 0} active now` },
      trendColor: T.cyan,
    },
    {
      label:      'Active Incidents',
      value:      String(openIncidents.length),
      subvalue:   openIncidents.length > 0 ? 'Requires attention' : 'All clear',
      accentColor: openIncidents.length > 0 ? T.amber : T.mint,
      badges:     openIncidents.slice(0, 3).map((i) => severityLabel(i.severity_level)),
    },
    {
      label:      'Pending Sign-offs',
      value:      String(pendingReports.length),
      subvalue:   `${pendingReports.length} outstanding`,
      accentColor: pendingReports.length > 0 ? T.amber : T.mint,
      trend:      pendingReports.length > 0
        ? { arrow: '!', label: 'Awaiting action' }
        : { arrow: '✓', label: 'All actioned' },
      trendColor: pendingReports.length > 0 ? T.amber : T.mint,
    },
    {
      label:      'Revenue Today',
      value:      formatCents(todayRev?.net_revenue_cents),
      subvalue:   todayRev?.forecast_revenue_cents
        ? `vs ${formatCents(todayRev.forecast_revenue_cents)} forecast`
        : 'No forecast',
      accentColor: (todayRev?.variance_cents ?? 0) >= 0 ? T.mint : T.red,
      trend:      todayRev
        ? { arrow: (todayRev.variance_cents ?? 0) >= 0 ? '↑' : '↓', label: formatVariance(todayRev) || '' }
        : null,
      trendColor: (todayRev?.variance_cents ?? 0) >= 0 ? T.mint : T.red,
      isStale:    todayRev?.is_stale || false,
    },
    {
      label:      'Labour Cost Today',
      value:      todayLab ? `${todayLab.worked_hours} hrs` : '—',
      subvalue:   todayLab
        ? `${formatCents(todayLab.labour_cost_cents)} · ${labourPct(todayLab)}% rev`
        : 'No data',
      accentColor: T.mint,
      trend:      todayLab?.budgeted_hours
        ? {
            arrow: todayLab.worked_hours <= todayLab.budgeted_hours ? '↓' : '↑',
            label: `${Math.abs(todayLab.worked_hours - todayLab.budgeted_hours).toFixed(1)} hrs ${
              todayLab.worked_hours <= todayLab.budgeted_hours ? 'under' : 'over'
            } budget`,
          }
        : null,
      trendColor: T.mint,
      isStale:    todayLab?.is_stale || false,
    },
  ];
}

// Derive the single highest-priority exception from live API data.
// Priority: critical compliance > open L4 incident > open L3 incident > labour over budget.
// Returns { text, severity, actionLabel } or null (all clear).
function buildGreetingLine(apiData) {
  const { incidents, compliance, labour } = apiData;
  const todayStr = TODAY_STR();
  const todayLab = labour?.find((l) => l.business_date?.startsWith(todayStr)) || labour?.[0];

  // 1. Critical compliance item
  const criticalCompliance = (compliance || []).find((c) => c.severity === 'critical');
  if (criticalCompliance) {
    const label = criticalCompliance.event_type || 'compliance item';
    return {
      text: `One thing needs you — ${criticalCompliance.description || label} is flagged as critical.`,
      severity: 'critical',
      actionLabel: 'Review compliance',
    };
  }

  // 2. L4 incident open
  const l4 = (incidents || []).find(
    (i) => i.severity_level >= 4 && (i.status === 'active' || i.status === 'open'),
  );
  if (l4) {
    return {
      text: `One thing needs you — L4 ${l4.incident_type || 'incident'} is open at ${l4.location_in_venue || 'venue'}.`,
      severity: 'critical',
      actionLabel: 'View incident',
    };
  }

  // 3. Warning compliance item
  const warnCompliance = (compliance || []).find((c) => c.severity !== 'critical');
  if (warnCompliance) {
    return {
      text: `One thing needs your eye — ${warnCompliance.description || warnCompliance.event_type || 'compliance item'} requires attention.`,
      severity: 'warning',
      actionLabel: 'Review compliance',
    };
  }

  // 4. L3 incident open
  const l3 = (incidents || []).find(
    (i) => i.severity_level >= 3 && (i.status === 'active' || i.status === 'open'),
  );
  if (l3) {
    return {
      text: `One thing needs your eye — L3 ${l3.incident_type || 'incident'} is open at ${l3.location_in_venue || 'venue'}.`,
      severity: 'warning',
      actionLabel: 'View incident',
    };
  }

  // 5. Labour over budget
  if (todayLab?.budgeted_hours && todayLab.worked_hours > todayLab.budgeted_hours) {
    const over = (todayLab.worked_hours - todayLab.budgeted_hours).toFixed(1);
    return {
      text: `One thing needs your eye — labour is ${over} hrs over budget today.`,
      severity: 'warning',
      actionLabel: 'Review roster',
    };
  }

  return null;
}

function transformToProps(apiData, session) {
  const { shiftSummary, incidents, reports, compliance, dataFreshness } = apiData;

  const openIncidents = (incidents || []).filter(
    (i) => i.status === 'active' || i.status === 'open',
  );

  // Venue status: critical if L4 open; attention if any L3+ or compliance; clear otherwise.
  const hasL4 = openIncidents.some((i) => i.severity_level >= 4);
  const hasL3 = openIncidents.some((i) => i.severity_level >= 3);
  const venueStatus = hasL4 ? 'critical' : hasL3 || compliance?.length > 0 ? 'attention' : 'clear';

  const scopeVenueIds = apiData.scope?.venueIds || [];
  const venueName = session?.venueName || 'Venue';

  return {
    venueName,
    dmName:     session?.staffName || '—',
    dmRole:     session?.role || '—',
    venueStatus,
    activeNav:  'Dashboard',
    notificationCount:
      (compliance?.length || 0) +
      (reports?.filter((r) => r.status === 'draft' || r.status === 'submitted')?.length || 0),
    venues: scopeVenueIds.map((id) => ({ id, name: id === scopeVenueIds[0] ? venueName : id })),
    selectedVenueId: scopeVenueIds[0] || 'default',
    kpis: buildKpis(apiData),
    staffOnFloor: groupStaffByArea(shiftSummary?.shifts || []),
    incidents: (incidents || []).slice(0, 10).map((i) => ({
      severity: severityLabel(i.severity_level),
      type:     i.incident_type || 'Incident',
      location: i.location_in_venue || 'Venue',
      handler:  i.reported_by_name || '—',
      meta:     formatIncidentMeta(i),
      href:     '#',
    })),
    complianceAlerts: (compliance || []).map((c) => ({
      severity: c.severity === 'critical' ? 'overdue' : 'warning',
      title:    c.event_type || 'Compliance Event',
      sub:      c.description || '—',
      action:   'Review →',
      href:     '#',
    })),
    pendingActions: (reports || []).slice(0, 5).map((r) => ({
      title:       `Incident Report`,
      sub:         `${r.incident_type || 'Report'} · ${r.obligation_type || r.status || 'Pending'}`,
      status:      r.status === 'draft' ? 'awaiting-dm' : 'other',
      actionLabel: r.status === 'draft' ? 'Sign' : 'View →',
      actionState: r.fulfilled ? 'signed' : '',
    })),
    timelineEvents: buildTimeline(shiftSummary?.shifts || [], openIncidents),
    quickActions: [
      { label: 'Build Roster',        primary: true  },
      { label: 'Log Incident',        primary: false },
      { label: 'Export Shift Report', primary: false },
      { label: 'View Compliance',     primary: false },
      { label: 'Send Staff Alert',    primary: false },
    ],
    greetingLine: buildGreetingLine(apiData),
  };
}

function formatIncidentMeta(incident) {
  if (!incident.incident_at) return '';
  const at = new Date(incident.incident_at);
  const time = at.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
  const now = Date.now();
  const minAgo = Math.round((now - at.getTime()) / 60_000);
  const isOpen = incident.status === 'active' || incident.status === 'open';
  if (isOpen) return `${time} · ${minAgo} min ongoing`;
  return `${time} · Resolved`;
}

// ─── Loading / error skeletons ───────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#1C1612', flexDirection: 'column', gap: 16,
    }}>
      <div style={{
        width: 56, height: 56, border: '1px solid rgba(184,134,58,0.5)', borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        fontSize: 24, fontWeight: 700, color: '#B8863A',
      }}>M</div>
      <p style={{
        fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13,
        color: 'rgba(245,239,228,0.45)', margin: 0,
      }}>Loading dashboard…</p>
    </div>
  );
}

function ErrorScreen({ message, onRetry }) {
  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#1C1612', flexDirection: 'column', gap: 16,
    }}>
      <p style={{
        fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14,
        color: '#E85050', margin: 0, textAlign: 'center', maxWidth: 360,
      }}>{message || 'Failed to load dashboard data.'}</p>
      <button
        onClick={onRetry}
        style={{
          fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13,
          background: 'transparent', border: '1px solid rgba(184,134,58,0.4)',
          color: '#B8863A', borderRadius: 4, padding: '8px 20px', cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  );
}

// ─── Container ───────────────────────────────────────────────────────────────

export default function AdminDesktopHomepageContainer({ session, onAuthError }) {
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeNav, setActiveNav] = useState('Dashboard');
  const sseRef = useRef(null);
  const refreshTimerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchAdminHomepage();
      setRawData(data);
      setError(null);
    } catch (err) {
      if (err.status === 401) { onAuthError(); return; }
      setError(err.message || 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, [onAuthError]);

  // Initial load + periodic refresh for revenue/labour.
  useEffect(() => {
    load();
    refreshTimerRef.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(refreshTimerRef.current);
  }, [load]);

  // Open SSE stream for live sections (incidents, staff, compliance).
  useEffect(() => {
    const es = openAdminStream((event) => {
      setRawData((prev) => {
        if (!prev) return prev;
        switch (event.type) {
          case 'incident:new':
            return { ...prev, incidents: [event, ...(prev.incidents || [])] };

          case 'incident:updated':
            return {
              ...prev,
              incidents: (prev.incidents || []).map((i) =>
                i.incident_id === event.incident_id ? { ...i, ...event } : i,
              ),
            };

          case 'staff:clock_in': {
            const newShift = {
              shift_id:    event.shift_id,
              venue_id:    event.venue_id,
              staff_id:    event.staff_id,
              role_name:   event.role_name,
              clock_in_at: event.clock_in_at,
              full_name:   event.full_name,
              status:      'active',
            };
            const existing = prev.shiftSummary?.shifts || [];
            const updated = existing.some((s) => s.shift_id === newShift.shift_id)
              ? existing.map((s) => (s.shift_id === newShift.shift_id ? { ...s, ...newShift } : s))
              : [newShift, ...existing];
            return {
              ...prev,
              shiftSummary: {
                ...prev.shiftSummary,
                onFloorNow: updated.filter((s) => s.clock_in_at && !s.clock_out_at).length,
                shifts: updated,
              },
            };
          }

          case 'staff:clock_out': {
            const updatedShifts = (prev.shiftSummary?.shifts || []).map((s) =>
              s.shift_id === event.shift_id ? { ...s, clock_out_at: event.clock_out_at, status: 'completed' } : s,
            );
            return {
              ...prev,
              shiftSummary: {
                ...prev.shiftSummary,
                onFloorNow: updatedShifts.filter((s) => s.clock_in_at && !s.clock_out_at).length,
                shifts: updatedShifts,
              },
            };
          }

          case 'compliance:alert_new':
            return { ...prev, compliance: [event, ...(prev.compliance || [])] };

          default:
            return prev;
        }
      });
    });
    sseRef.current = es;
    es.onerror = () => {
      // SSE reconnects automatically; log but don't disrupt the UI.
      console.warn('[admin-stream] SSE error — browser will reconnect');
    };
    return () => {
      es.close();
      sseRef.current = null;
    };
  }, []);

  const handleVenueChange = useCallback(
    async (venueId) => {
      // For now, re-fetch the homepage (scope is fixed server-side per JWT).
      // Future: allow multi-venue users to filter by venueId param.
      await load();
    },
    [load],
  );

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} onRetry={load} />;
  if (!rawData) return <LoadingScreen />;

  // Reports nav section renders its own full-page layout.
  if (activeNav === 'Reports') {
    return (
      <AdminReportingScreen
        session={session}
        onNavChange={setActiveNav}
        onAuthError={onAuthError}
      />
    );
  }

  const props = transformToProps(rawData, session);

  return (
    <AdminDesktopHomepage
      {...props}
      activeNav={activeNav}
      onVenueChange={handleVenueChange}
      onNavChange={setActiveNav}
    />
  );
}
