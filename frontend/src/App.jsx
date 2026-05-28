// App — top-level state machine for the Mise client.
//   1. No token            -> <Login>.
//   2. Token, loading      -> brand splash while GET /api/session resolves.
//   3. Admin tiers (1-4):  -> <AdminDesktopHomepageContainer> (full-screen desktop UI)
//   4. Staff tiers (5, 7): -> <TopBar> + tabbed body + <BottomNav> + <SlideOut>.
// Navigation is role-specific from roleTier in the verified JWT (immutable).
// A 401 anywhere drops back to login.
import React, { useCallback, useEffect, useState } from 'react';
import {
  getToken, fetchSession, sendChat, logout, clearToken,
  fetchShiftSummary, fetchHandover, fetchReservations,
  activateComplianceMonitor, fetchComplianceAlerts, acknowledgeAlert,
  sendRSACoaching, submitRSAReport,
} from './api.js';
import Login from './components/Login.jsx';
import TopBar from './components/TopBar.jsx';
import SlideOut from './components/SlideOut.jsx';
import MessageThread from './components/MessageThread.jsx';
import Composer from './components/Composer.jsx';
import ComplianceBanner from './components/ComplianceBanner.jsx';
import BottomNav from './components/BottomNav.jsx';
import Runsheet from './components/Runsheet.jsx';
import RevenueIntelligence from './components/RevenueIntelligence.jsx';
import ReportsScreen from './components/ReportsScreen.jsx';
import IncidentsScreen from './components/IncidentsScreen.jsx';
import FirstAidGate from './components/FirstAidGate.jsx';
import RSATriage from './components/RSATriage.jsx';
import AdminDesktopHomepageContainer from './components/AdminDesktopHomepageContainer.jsx';
import MobileReportingScreen from './components/MobileReportingScreen.jsx';
import MyDevelopmentScreen from './components/MyDevelopmentScreen.jsx';
import BookingsScreen from './components/BookingsScreen.jsx';
import TeamDevelopmentScreen from './components/TeamDevelopmentScreen.jsx';

// Admin desktop tiers: 1=Group Admin, 2=Area Manager, 3=General Manager,
// 4=Venue Coordinator/Venue Manager — oversight roles whose primary surface
// is the desktop homepage.
// Tier 5 (Duty Manager) and tier 7 (Gaming Attendant) stay on the mobile shell:
// the DM runs shift handover / runsheet on a phone during shifts (demo Scene 2),
// so routing tier 5 to the full-screen desktop view would break that flow.
// CTO ruling (MIS-431): role-scope/venue isolation is verified at the API + RLS
// layer (backend `admin-homepage` permission still permits tier 5) and via QA on
// the endpoints — it does not require forcing the DM's default UI to desktop.
const ADMIN_DESKTOP_TIERS = new Set([1, 2, 3, 4]);

const HANDOVER_INTENT = /handover/i;
const MANAGER_MAX_TIER = 5;
const GAMING_ATTENDANT_TIER = 7;

// First-aid trigger: matches messages that indicate a medical emergency. When
// matched, the FirstAidGate intercepts the message before any AI content is
// shown — the hard gate is the first thing staff sees (MIS-391, §6.4).
const FIRST_AID_INTENT = /\b(first[\s-]?aid|medical emergency|someone (collapsed|fell|is unconscious|is not breathing|having a seizure)|CPR|cardiac arrest|unconscious|not breathing|anaphylaxis|allergic reaction|epipen|choking|choke|heart attack|overdose|bleeding heavily|major trauma|emergency response)\b/i;

// RSA triage trigger: matches patron intoxication / service refusal situations.
// When matched, RSATriage intercepts and runs the 5-question triage flow instead
// of sending the message directly to the AI chat (MIS-389).
const RSA_INTENT = /\b(intoxicat|drunk|had too much|service refus|refuse service|patron (needs? to|should) leave|ask(ing)? (them|him|her|a patron|the patron) to leave|patron who('?s| is) (drunk|slurring|unsteady|wasted)|rsa situation|rsa help|rsa|difficult patron|patron behav|trouble with a patron|patron trouble|patron problem|customer (seems?|is) (drunk|intoxicat|affected)|someone (seems?|is) intoxicat|they('?ve| have) had (too much|enough)|i think (they|he|she|this patron)('?s| is) (drunk|intoxicat|affected)|cut (them|him|her) off|cutting (them|him|her) off|refusing service)\b/i;
const ALERT_POLL_MS = 2500;

let msgSeq = 0;
const nextId = () => `m${++msgSeq}`;
const clock = () =>
  new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(authed);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [sending, setSending] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [reservations, setReservations] = useState(null);
  const [tab, setTab] = useState('chat');
  const [menuOpen, setMenuOpen] = useState(false);

  // First-aid gate state (MIS-391).
  // gateQuery: the original message that triggered the gate.
  // gateAnswer/gateCitations: populated once the user confirms 000 and the AI responds.
  const [gateOpen, setGateOpen] = useState(false);
  const [gateQuery, setGateQuery] = useState(null);
  const [gateAnswer, setGateAnswer] = useState(null);
  const [gateCitations, setGateCitations] = useState([]);

  // RSA triage state (MIS-389): open when an RSA situation intent is detected.
  const [rsaOpen, setRsaOpen] = useState(false);

  const dropToLogin = useCallback(() => {
    clearToken();
    setAuthed(false);
    setSession(null);
    setMessages([]);
    setConversationId(null);
    setAlerts([]);
    setSummary(null);
    setReservations(null);
    setTab('chat');
    setMenuOpen(false);
    setGateOpen(false);
    setGateQuery(null);
    setGateAnswer(null);
    setGateCitations([]);
    setRsaOpen(false);
  }, []);

  const isManager = session?.roleTier != null && session.roleTier <= MANAGER_MAX_TIER;
  const isSharedStation = session?.roleTier === GAMING_ATTENDANT_TIER;

  // Compliance Monitor: arm on manager login, poll for Critical alerts.
  useEffect(() => {
    if (!authed || !isManager) return;
    let live = true;
    activateComplianceMonitor().catch(() => {});
    const poll = () => {
      fetchComplianceAlerts()
        .then((res) => live && setAlerts(res.alerts || []))
        .catch((err) => { if (err.status === 401) dropToLogin(); });
    };
    poll();
    const id = setInterval(poll, ALERT_POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, [authed, isManager, dropToLogin]);

  const onAcknowledge = useCallback(async (eventId, note) => {
    await acknowledgeAlert({ eventId, note });
    // 2s grace period so the ComplianceBanner can show its "Action logged" confirmation
    // before the next alert (if any) mounts in its place.
    setTimeout(() => setAlerts((a) => a.filter((x) => x.eventId !== eventId)), 2000);
  }, []);

  // Resolve session identity.
  useEffect(() => {
    if (!authed) return;
    let live = true;
    setLoading(true);
    fetchSession()
      .then((s) => live && setSession(s))
      .catch((err) => { if (err.status === 401) dropToLogin(); })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [authed, dropToLogin]);

  // Shift summary for manager opening surface.
  useEffect(() => {
    if (!authed || !isManager) return;
    let live = true;
    fetchShiftSummary()
      .then((s) => live && setSummary(s))
      .catch((err) => { if (err.status === 401) dropToLogin(); });
    return () => { live = false; };
  }, [authed, isManager, dropToLogin]);

  // Reservations — all roles (per feature spec MIS-243).
  useEffect(() => {
    if (!authed || !session) return;
    let live = true;
    fetchReservations()
      .then((r) => live && setReservations(r))
      .catch((err) => { if (err.status === 401) dropToLogin(); });
    return () => { live = false; };
  }, [authed, session, dropToLogin]);

  // Called when the user confirms 000 is called — fetch the AI guidance.
  const onGateConfirmed = useCallback(async () => {
    if (!gateQuery) return;
    try {
      // Expand short trigger phrases so RAG retrieves first-aid content rather
      // than gambling-adjacent chunks (MIS-421 QA finding).
      const ragMessage = gateQuery.trim().length < 50
        ? `first aid emergency: ${gateQuery.trim()}`
        : gateQuery;
      const res = await sendChat({ message: ragMessage, conversationId });
      if (res.conversationId) setConversationId(res.conversationId);
      setGateAnswer(res.answer);
      setGateCitations(res.citations || []);
    } catch (err) {
      if (err.status === 401) { dropToLogin(); return; }
      setGateAnswer('Unable to load guidance. Call 000 and follow the dispatcher\'s instructions.');
    }
  }, [gateQuery, conversationId, dropToLogin]);

  const onGateDismiss = useCallback(() => {
    setGateOpen(false);
    setGateQuery(null);
    setGateAnswer(null);
    setGateCitations([]);
  }, []);

  const onSend = useCallback(
    async (text) => {
      // First-aid gate intercept (MIS-391): show the mandatory emergency-services
      // gate before any guidance content. §6.4 — no bypass path.
      if (FIRST_AID_INTENT.test(text)) {
        setGateQuery(text);
        setGateAnswer(null);
        setGateCitations([]);
        setGateOpen(true);
        return;
      }

      // RSA triage intercept (MIS-389): patron intoxication / service refusal.
      // Opens the 3-phase triage flow instead of sending to the AI directly.
      if (RSA_INTENT.test(text)) {
        setRsaOpen(true);
        return;
      }

      const userMsg = { id: nextId(), role: 'user', content: text, time: clock() };
      const pendingId = nextId();
      setMessages((m) => [...m, userMsg, { id: pendingId, role: 'mise', pending: true }]);
      setSending(true);

      if (isManager && HANDOVER_INTENT.test(text)) {
        try {
          const handover = await fetchHandover();
          setMessages((m) =>
            m.map((msg) =>
              msg.id === pendingId
                ? { id: pendingId, role: 'mise', kind: 'handover', handover, time: clock() }
                : msg,
            ),
          );
        } catch (err) {
          if (err.status === 401) { dropToLogin(); return; }
          setMessages((m) =>
            m.map((msg) =>
              msg.id === pendingId
                ? { id: pendingId, role: 'mise', error: true, content: "Couldn't load the handover just now. Try again.", time: clock() }
                : msg,
            ),
          );
        } finally {
          setSending(false);
        }
        return;
      }

      try {
        const res = await sendChat({ message: text, conversationId });
        if (res.conversationId) setConversationId(res.conversationId);
        setMessages((m) =>
          m.map((msg) =>
            msg.id === pendingId
              ? {
                  id: pendingId, role: 'mise',
                  content: res.answer,
                  citations: res.citations,
                  confidence: res.confidence,
                  lowConfidence: res.lowConfidence,
                  confidenceFloor: res.confidenceFloor,
                  time: clock(),
                }
              : msg,
          ),
        );
      } catch (err) {
        if (err.status === 401) { dropToLogin(); return; }
        setMessages((m) =>
          m.map((msg) =>
            msg.id === pendingId
              ? { id: pendingId, role: 'mise', error: true, content: "Couldn't reach Mise just now. Check your connection and try again.", time: clock() }
              : msg,
          ),
        );
      } finally {
        setSending(false);
      }
    },
    [conversationId, dropToLogin, isManager, gateQuery],
  );

  const onLogout = useCallback(async () => {
    await logout().catch(() => {});
    dropToLogin();
  }, [dropToLogin]);

  const shell = { height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--charcoal)', maxWidth: 430, margin: '0 auto' };

  if (!authed) {
    return (
      <div style={shell}>
        <Login onAuthenticated={() => setAuthed(true)} />
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...shell, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 56, height: 56,
          border: '1px solid rgba(46, 107, 174, 0.5)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontSize: 24, fontWeight: 700,
          color: 'var(--gold)',
        }}>
          M
        </div>
      </div>
    );
  }

  // Admin desktop: full-screen, no mobile shell constraints.
  if (session?.roleTier != null && ADMIN_DESKTOP_TIERS.has(session.roleTier)) {
    return (
      <AdminDesktopHomepageContainer
        session={session}
        onAuthError={dropToLogin}
      />
    );
  }

  return (
    <div style={shell}>
      {/* Slide-out menu */}
      <SlideOut
        open={menuOpen}
        session={session}
        onClose={() => setMenuOpen(false)}
        onLogout={onLogout}
      />

      {/* First-aid emergency gate — fullscreen overlay, §6.4: no bypass */}
      {gateOpen && (
        <FirstAidGate
          venueAddress={session?.venueAddress || null}
          answer={gateAnswer}
          citations={gateCitations}
          onConfirmed={onGateConfirmed}
          onDismiss={onGateDismiss}
        />
      )}

      {/* RSA triage — fullscreen overlay (MIS-389): 3-phase triage → coaching → report */}
      {rsaOpen && (
        <RSATriage
          session={session}
          onDismiss={() => setRsaOpen(false)}
          onMedicalGate={() => {
            // Medical trigger detected mid-triage: close RSA flow, open first-aid gate.
            setRsaOpen(false);
            setGateQuery('medical emergency');
            setGateAnswer(null);
            setGateCitations([]);
            setGateOpen(true);
          }}
          onAuthError={dropToLogin}
        />
      )}

      <TopBar session={session} onMenuToggle={() => setMenuOpen((v) => !v)} />

      {/* Shared-station mode strip — visible only for Gaming Attendant tier */}
      {isSharedStation && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            height: 28,
            background: 'rgba(0, 200, 232, 0.08)',
            borderBottom: '1px solid rgba(0, 200, 232, 0.25)',
            flexShrink: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <path d="M8 21h8M12 17v4"/>
          </svg>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--cyan)',
            }}
          >
            Shared Station Mode
          </span>
        </div>
      )}

      {/* Compliance alert — pinned above all tabs, blocks until acknowledged */}
      <ComplianceBanner alert={alerts[0]} onAcknowledge={onAcknowledge} />

      {/* Tabbed body */}
      {tab === 'chat' && (
        <>
          <MessageThread
            messages={messages}
            session={session}
            summary={isManager ? summary : null}
            reservations={reservations}
            onAskHandover={() => onSend("Walk me through tonight's handover.")}
          />
          <Composer onSend={onSend} disabled={sending} />
        </>
      )}

      {tab === 'run_sheet' && (
        <main className="mise-thread flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          <Runsheet onAuthError={dropToLogin} roleTier={session?.roleTier} />
        </main>
      )}

      {tab === 'revenue' && (
        <main className="mise-thread flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          <RevenueIntelligence onAuthError={dropToLogin} />
        </main>
      )}

      {tab === 'reports' && (
        <main className="mise-thread flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          {/* DM (tier 5) gets the live reporting screen; tier 7 sees legacy P&L summary */}
          {session?.roleTier === 5 ? (
            <MobileReportingScreen onAuthError={dropToLogin} />
          ) : (
            <ReportsScreen onAuthError={dropToLogin} />
          )}
        </main>
      )}

      {tab === 'incidents' && (
        <main className="mise-thread flex-1 overflow-y-auto overflow-x-hidden">
          <IncidentsScreen onAuthError={dropToLogin} roleTier={session?.roleTier} />
        </main>
      )}

      {/* Progression Tracker — individual development profile (tier 7 Gaming Attendant) */}
      {tab === 'growth' && (
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <MyDevelopmentScreen onAuthError={dropToLogin} />
        </main>
      )}

      {/* Progression Tracker — team development view (tier 5 Duty Manager) */}
      {tab === 'team' && (
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <TeamDevelopmentScreen onAuthError={dropToLogin} />
        </main>
      )}

      {/* Bookings tab — DM (tier 5) restaurant and function bookings (MIS-642) */}
      {tab === 'bookings' && (
        <main className="mise-thread flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          <BookingsScreen onAuthError={dropToLogin} />
        </main>
      )}

      {/* Placeholder screens for tabs not yet built — on-brand, readable */}
      {['compliance', 'shift', 'labour', 'alerts'].includes(tab) && (
        <ComingSoon label={tab} />
      )}

      <BottomNav
        roleTier={session?.roleTier}
        active={tab}
        onChange={setTab}
        alertCount={alerts.length}
      />
    </div>
  );
}

// Placeholder screen for tabs that don't have a full implementation yet.
function ComingSoon({ label }) {
  const title = label
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return (
    <main
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 12,
        overflowY: 'auto',
      }}
    >
      <h1
        style={{
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontSize: 24,
          fontWeight: 700,
          color: 'var(--gold)',
          margin: 0,
          textAlign: 'center',
        }}
      >
        {title}
      </h1>
      <p
        style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: 16,
          color: 'var(--cream-60)',
          margin: 0,
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        This screen is coming soon.
      </p>
    </main>
  );
}
