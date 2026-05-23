// App — top-level state machine for the Mise mobile client.
//   1. No token            -> <Login>.
//   2. Token, loading      -> brand splash while GET /api/session resolves.
//   3. Authenticated        -> chat: <TopBar> + <MessageThread> + <Composer>.
// A 401 anywhere (expired/invalid session) drops back to login. Layout is a
// fixed-height column (100dvh): only the thread scrolls, so the bar and composer
// never move and the page never scrolls horizontally.
import React, { useCallback, useEffect, useState } from 'react';
import {
  getToken, fetchSession, sendChat, logout, clearToken,
  fetchShiftSummary, fetchHandover,
  activateComplianceMonitor, fetchComplianceAlerts, acknowledgeAlert,
} from './api.js';
import Login from './components/Login.jsx';
import TopBar from './components/TopBar.jsx';
import MessageThread from './components/MessageThread.jsx';
import Composer from './components/Composer.jsx';
import ComplianceBanner from './components/ComplianceBanner.jsx';

// "Walk me through tonight's handover." and similar -> render the structured
// handover note (MIS-43) instead of running RAG chat. Manager sessions only.
const HANDOVER_INTENT = /handover/i;

// The Compliance Monitor banner is delivered to management sessions (Duty
// Manager tier 5, Venue Manager tier 4) — the roles accountable for the floor.
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

  const dropToLogin = useCallback(() => {
    clearToken();
    setAuthed(false);
    setSession(null);
    setMessages([]);
    setConversationId(null);
    setAlerts([]);
    setSummary(null);
  }, []);

  const isManager = session?.roleTier != null && session.roleTier <= MANAGER_MAX_TIER;

  // Compliance Monitor: once a manager session resolves, arm the monitor and
  // poll for active Critical alerts. The backend writes the understaffing alert
  // ~10s after activation; polling surfaces it into the banner when it lands.
  useEffect(() => {
    if (!authed || !isManager) return;
    let live = true;
    activateComplianceMonitor().catch(() => {});
    const poll = () => {
      fetchComplianceAlerts()
        .then((res) => live && setAlerts(res.alerts || []))
        .catch((err) => {
          if (err.status === 401) dropToLogin();
        });
    };
    poll();
    const id = setInterval(poll, ALERT_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [authed, isManager, dropToLogin]);

  const onAcknowledge = useCallback(async (eventId, note) => {
    await acknowledgeAlert({ eventId, note });
    // Drop it locally now; the next poll confirms it's cleared server-side.
    setAlerts((a) => a.filter((x) => x.eventId !== eventId));
  }, []);

  // Resolve the session identity for the top bar once authenticated.
  useEffect(() => {
    if (!authed) return;
    let live = true;
    setLoading(true);
    fetchSession()
      .then((s) => live && setSession(s))
      .catch((err) => {
        if (err.status === 401) dropToLogin();
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [authed, dropToLogin]);

  // Duty Manager opening surface (MIS-43): once a manager session resolves,
  // load the live shift summary so it can render in place of the empty state.
  useEffect(() => {
    if (!authed || !isManager) return;
    let live = true;
    fetchShiftSummary()
      .then((s) => live && setSummary(s))
      .catch((err) => {
        if (err.status === 401) dropToLogin();
      });
    return () => {
      live = false;
    };
  }, [authed, isManager, dropToLogin]);

  const onSend = useCallback(
    async (text) => {
      const userMsg = { id: nextId(), role: 'user', content: text, time: clock() };
      const pendingId = nextId();
      setMessages((m) => [...m, userMsg, { id: pendingId, role: 'mise', pending: true }]);
      setSending(true);

      // Handover intent (manager only): render the structured note, not RAG chat.
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
          if (err.status === 401) {
            dropToLogin();
            return;
          }
          setMessages((m) =>
            m.map((msg) =>
              msg.id === pendingId
                ? {
                    id: pendingId,
                    role: 'mise',
                    error: true,
                    content: 'Couldn’t load the handover just now. Try again.',
                    time: clock(),
                  }
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
                  id: pendingId,
                  role: 'mise',
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
        if (err.status === 401) {
          dropToLogin();
          return;
        }
        setMessages((m) =>
          m.map((msg) =>
            msg.id === pendingId
              ? {
                  id: pendingId,
                  role: 'mise',
                  error: true,
                  content: 'Couldn’t reach Mise just now. Check your connection and try again.',
                  time: clock(),
                }
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

  // The whole app lives in one viewport-height column — no page scroll.
  const shell = { height: '100dvh', display: 'flex', flexDirection: 'column' };

  if (!authed) {
    return (
      <div style={shell}>
        <Login onAuthenticated={() => setAuthed(true)} />
      </div>
    );
  }

  if (loading) {
    return (
      <div style={shell} className="items-center justify-center">
        <div className="grid h-14 w-14 animate-pulse place-items-center rounded-2xl border border-gold/50 font-data text-2xl font-bold text-gold">
          M
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      {/* Compliance alert — pinned above everything; blocks until acknowledged. */}
      <ComplianceBanner alert={alerts[0]} onAcknowledge={onAcknowledge} />
      <TopBar session={session} onLogout={onLogout} />
      <MessageThread
        messages={messages}
        session={session}
        summary={isManager ? summary : null}
        onAskHandover={() => onSend("Walk me through tonight's handover.")}
      />
      <Composer onSend={onSend} disabled={sending} />
    </div>
  );
}
