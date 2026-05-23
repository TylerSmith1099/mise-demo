// App — top-level state machine for the Mise mobile client (Option A nav, MIS-230).
//   1. No token            -> <Login>.
//   2. Token, loading      -> brand splash while GET /api/session resolves.
//   3. Authenticated       -> <TopBar> + tabbed body + <BottomNav> + <SlideOut>.
// Navigation is role-specific from roleTier in the verified JWT (immutable).
// A 401 anywhere drops back to login. Layout is 100dvh column — only the active
// body scrolls; top bar and bottom nav are sticky.
import React, { useCallback, useEffect, useState } from 'react';
import {
  getToken, fetchSession, sendChat, logout, clearToken,
  fetchShiftSummary, fetchHandover,
  activateComplianceMonitor, fetchComplianceAlerts, acknowledgeAlert,
} from './api.js';
import Login from './components/Login.jsx';
import TopBar from './components/TopBar.jsx';
import SlideOut from './components/SlideOut.jsx';
import MessageThread from './components/MessageThread.jsx';
import Composer from './components/Composer.jsx';
import ComplianceBanner from './components/ComplianceBanner.jsx';
import BottomNav from './components/BottomNav.jsx';
import Runsheet from './components/Runsheet.jsx';

const HANDOVER_INTENT = /handover/i;
const MANAGER_MAX_TIER = 5;
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
  const [tab, setTab] = useState('chat');
  const [menuOpen, setMenuOpen] = useState(false);

  const dropToLogin = useCallback(() => {
    clearToken();
    setAuthed(false);
    setSession(null);
    setMessages([]);
    setConversationId(null);
    setAlerts([]);
    setSummary(null);
    setTab('chat');
    setMenuOpen(false);
  }, []);

  const isManager = session?.roleTier != null && session.roleTier <= MANAGER_MAX_TIER;

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
    setAlerts((a) => a.filter((x) => x.eventId !== eventId));
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

  const onSend = useCallback(
    async (text) => {
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
    [conversationId, dropToLogin, isManager],
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
          border: '1px solid rgba(184, 134, 58, 0.5)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: 24, fontWeight: 700,
          color: 'var(--gold)',
        }}>
          M
        </div>
      </div>
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

      {/* Compliance alert — pinned above all tabs, blocks until acknowledged */}
      <ComplianceBanner alert={alerts[0]} onAcknowledge={onAcknowledge} />

      <TopBar session={session} onMenuToggle={() => setMenuOpen((v) => !v)} />

      {/* Tabbed body */}
      {tab === 'chat' && (
        <>
          <MessageThread
            messages={messages}
            session={session}
            summary={isManager ? summary : null}
            onAskHandover={() => onSend("Walk me through tonight's handover.")}
          />
          <Composer onSend={onSend} disabled={sending} />
        </>
      )}

      {tab === 'run_sheet' && (
        <main className="mise-thread flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          <Runsheet onAuthError={dropToLogin} />
        </main>
      )}

      {/* Placeholder screens for tabs not yet built — on-brand, readable */}
      {['compliance', 'incidents', 'shift', 'bookings', 'labour', 'alerts', 'revenue', 'reports'].includes(tab) && (
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
          fontFamily: "'Playfair Display', Georgia, serif",
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
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: 17,
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
