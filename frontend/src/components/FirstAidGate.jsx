/**
 * FirstAidGate — mandatory emergency-services gate that appears BEFORE any
 * first-aid guidance content (MIS-391, Legal clearance MIS-379 §6).
 *
 * Three states:
 *   gate            — Screen 1: must confirm 000 before anything else shows.
 *   dispatcher      — "I need to call now" path: venue address + script only.
 *                     No first-aid content. No other path forward.
 *   guidance        — Post-000 confirmation: §6.1 reinforcement, then the AI
 *                     answer with §6.2 content disclaimer + §6.3 footer.
 *
 * Legal requirements enforced (MIS-379 §6):
 *   §6.1 — post-000 confirmation leads with dispatcher-primary reinforcement.
 *   §6.2 — explicit content disclaimer block before any guidance steps.
 *   §6.3 — strengthened persistent footer on every guidance screen.
 *   §6.4 — no skip path, no pre-selection, no auto-advance. Both buttons are
 *           equal-weight; neither is pre-selected or defaulted.
 *
 * Props:
 *   venueAddress  {string|null}  — pre-filled address from session. Falls back
 *                                  to a prompt to call the venue manager.
 *   answer        {string|null}  — AI guidance text (null while pending).
 *   citations     {Array}        — citation objects from the AI response.
 *   onConfirmed   {function}     — called when the user confirms 000 is called
 *                                  and guidance should now be fetched/shown.
 *   onDismiss     {function}     — called when the gate is dismissed entirely
 *                                  (user closes the gate without proceeding).
 */
import React, { useState } from 'react';
import Citations from './Citations.jsx';

// Wording constants — every string here is locked to Legal-cleared text (§6).
// Do not edit without a new Legal review cycle.
const GATE_HEADING = '⚠️ This is a medical emergency.';
const GATE_BODY    =
  'Call 000 now — police, fire, or ambulance.\n\n' +
  'Tell them: your venue address (below), what happened, how many people are affected, ' +
  'and whether the person is conscious and breathing.';
const BTN_CALLED   = 'Yes — emergency services have been called and are on the way';
const BTN_NEED     = 'I need to call them now — show me what to say';

// §6.1 — post-000 confirmation reinforcement (required wording, do not shorten).
const REINFORCE =
  'Good. Stay on the line with 000 and do exactly what the dispatcher tells you — ' +
  'their instructions come first. The guidance below is to help you act while you wait.';

// §6.2 — content disclaimer block (required, must appear before guidance steps).
const DISCLAIMER =
  'This is general information to help you act while you wait for help — not medical advice, ' +
  'and not a substitute for training, a doctor, or paramedics. Mise cannot see the situation ' +
  'and does not diagnose. If a trained first aider, an AED, or the person\'s own medication ' +
  '(e.g. EpiPen) is available, use those and follow the 000 dispatcher\'s instructions over ' +
  'anything on this screen.';

// §6.3 — strengthened persistent footer (required on every guidance screen).
const FOOTER =
  'General information only — not medical advice. This supports trained first aid and the 000 call; ' +
  'it does not replace them. Defer to any trained first aider, AED, or 000 dispatcher. ' +
  'If the situation worsens, call 000 again.';

const DISPATCHER_SCRIPT = (address) => [
  `📍 Venue address: ${address}`,
  '',
  'Tell the dispatcher:',
  '1. Your location: ' + address,
  '2. What happened (e.g. "a person has collapsed and is not breathing")',
  '3. How many people are affected',
  '4. Whether the person is conscious and breathing',
  '5. Your name and the best number to call back',
  '',
  'Stay on the line — do not hang up until the dispatcher tells you to.',
].join('\n');

// Shared colour tokens from the app brand system.
const C = {
  charcoal:  'var(--charcoal, #090F1A)',
  gold:      'var(--gold, #2E6BAE)',
  cream:     'var(--cream, #E0EEFF)',
  cream60:   'var(--cream-60, rgba(224,238,255,0.6))',
  red:       '#E85050',
  redBg:     'rgba(232,80,80,0.08)',
  redBorder: 'rgba(232,80,80,0.35)',
  amber:     '#E8A020',
  amberBg:   'rgba(232,160,32,0.08)',
  amberBorder:'rgba(232,160,32,0.35)',
  surface:   'rgba(255,255,255,0.04)',
  border:    'rgba(46,107,174,0.20)',
};

// MIS-640: Fraunces + Hanken Grotesk (board confirmed 2026-05-29)
const serif  = "'Fraunces', Georgia, serif";
const slab   = "'Hanken Grotesk', system-ui, sans-serif";
const mono   = "'Hanken Grotesk', system-ui, sans-serif";
const sans   = "'Hanken Grotesk', system-ui, sans-serif";

// ---------------------------------------------------------------------------
// Sub-screen: dispatcher script only (BTN_NEED path).
// No first-aid content. Nothing else. §6.4.
// ---------------------------------------------------------------------------
function DispatcherScreen({ venueAddress, onBack }) {
  const address = venueAddress || '⚠️ Contact your venue manager for the site address.';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 16,
      padding: '20px 16px',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        background: C.redBg,
        border: `1px solid ${C.redBorder}`,
        borderRadius: 10,
      }}>
        <p style={{ margin: 0, fontFamily: serif, fontSize: 18, fontWeight: 700, color: C.red, lineHeight: 1.3 }}>
          ⚠️ Call 000 now
        </p>
      </div>

      {/* Address block — prominent */}
      <div style={{
        padding: '14px 16px',
        background: C.amberBg,
        border: `1px solid ${C.amberBorder}`,
        borderRadius: 10,
      }}>
        <p style={{ margin: '0 0 4px', fontFamily: mono, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.amber }}>
          Venue address
        </p>
        <p style={{ margin: 0, fontFamily: mono, fontSize: 14, color: C.cream, lineHeight: 1.5 }}>
          {venueAddress || '⚠️ Contact your venue manager for the site address now.'}
        </p>
      </div>

      {/* Dispatcher script */}
      <div style={{ padding: '14px 16px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 }}>
        <p style={{ margin: '0 0 10px', fontFamily: mono, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.cream60 }}>
          Tell the dispatcher:
        </p>
        {[
          `1. Your location: ${venueAddress || '[get address from venue manager]'}`,
          '2. What happened (e.g. "a person has collapsed and is not breathing")',
          '3. How many people are affected',
          '4. Whether the person is conscious and breathing',
          '5. Your name and best callback number',
        ].map((line, i) => (
          <p key={i} style={{ margin: '0 0 8px', fontFamily: sans, fontSize: 14, color: C.cream, lineHeight: 1.5 }}>
            {line}
          </p>
        ))}
        <p style={{ margin: '8px 0 0', fontFamily: sans, fontSize: 13, fontWeight: 600, color: C.amber }}>
          Stay on the line — do not hang up until the dispatcher tells you to.
        </p>
      </div>

      {/* Back — no first aid content accessible from this screen */}
      <button
        onClick={onBack}
        style={{
          width: '100%', padding: '14px 16px', marginTop: 4,
          background: 'transparent',
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          fontFamily: sans, fontSize: 14, color: C.cream60,
          cursor: 'pointer',
          minHeight: 48,
        }}
      >
        ← Back
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-screen: guidance (post-000 confirmed path).
// §6.1 reinforcement → §6.2 disclaimer → AI answer → §6.3 persistent footer.
// ---------------------------------------------------------------------------
function GuidanceScreen({ answer, citations, onDone }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 14,
      padding: '20px 16px 80px',
    }}>
      {/* §6.1 — post-confirmation reinforcement (required, must lead the screen) */}
      <div style={{
        padding: '12px 14px',
        background: C.amberBg,
        border: `1px solid ${C.amberBorder}`,
        borderRadius: 10,
      }}>
        <p style={{ margin: 0, fontFamily: sans, fontSize: 14, fontWeight: 600, color: C.amber, lineHeight: 1.5 }}>
          {REINFORCE}
        </p>
      </div>

      {/* §6.2 — content disclaimer block (required, unmissable, before guidance steps) */}
      <div style={{
        padding: '12px 14px',
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
      }}>
        <p style={{ margin: '0 0 4px', fontFamily: mono, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.cream60 }}>
          Important — read before acting
        </p>
        <p style={{ margin: 0, fontFamily: sans, fontSize: 13, color: C.cream60, lineHeight: 1.55 }}>
          {DISCLAIMER}
        </p>
      </div>

      {/* AI guidance answer */}
      {answer ? (
        <div style={{
          padding: '14px 16px',
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
        }}>
          <p style={{ margin: '0 0 10px', fontFamily: mono, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.cream60 }}>
            Guidance — while you wait
          </p>
          <div style={{ fontFamily: sans, fontSize: 14, color: C.cream, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {answer}
          </div>
          {citations && citations.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Citations citations={citations} />
            </div>
          )}
        </div>
      ) : (
        <div style={{
          padding: '14px 16px',
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 80,
        }}>
          <p style={{ margin: 0, fontFamily: mono, fontSize: 12, color: C.cream60, letterSpacing: '0.06em' }}>
            Loading guidance…
          </p>
        </div>
      )}

      {/* §6.3 — strengthened persistent footer (required, every guidance screen) */}
      <div style={{
        padding: '10px 14px',
        background: C.redBg,
        border: `1px solid ${C.redBorder}`,
        borderRadius: 10,
      }}>
        <p style={{ margin: 0, fontFamily: sans, fontSize: 12, fontStyle: 'italic', color: C.cream60, lineHeight: 1.5 }}>
          {FOOTER}
        </p>
      </div>

      <button
        onClick={onDone}
        style={{
          width: '100%', padding: '14px 16px',
          background: 'transparent',
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          fontFamily: sans, fontSize: 14, color: C.cream60,
          cursor: 'pointer',
          minHeight: 48,
        }}
      >
        Close
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export — gate component.
// ---------------------------------------------------------------------------
export default function FirstAidGate({ venueAddress, answer, citations, onConfirmed, onDismiss }) {
  // §6.4: no default, no pre-selection, no auto-advance.
  const [screen, setScreen] = useState('gate');

  const handleCalled = () => {
    // Trigger the AI fetch in the parent; we show guidance state while it loads.
    onConfirmed();
    setScreen('guidance');
  };

  const handleNeedToCall = () => {
    setScreen('dispatcher');
  };

  const handleBack = () => {
    setScreen('gate');
  };

  const handleDone = () => {
    onDismiss();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: C.charcoal,
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* Sticky top header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        padding: '16px 16px 12px',
        background: C.charcoal,
        borderBottom: `1px solid ${C.redBorder}`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          flex: 1,
          fontFamily: mono, fontSize: 12, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: C.red, fontWeight: 700,
        }}>
          Medical Emergency
        </div>
        {screen === 'gate' && (
          <button
            onClick={onDismiss}
            aria-label="Close emergency gate"
            style={{
              background: 'none', border: 'none', padding: 8,
              color: C.cream60, cursor: 'pointer', fontSize: 20,
              lineHeight: 1, minWidth: 44, minHeight: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Dispatcher script screen — no first aid content, nothing else */}
      {screen === 'dispatcher' && (
        <DispatcherScreen venueAddress={venueAddress} onBack={handleBack} />
      )}

      {/* Guidance screen — only after 000 confirmed */}
      {screen === 'guidance' && (
        <GuidanceScreen answer={answer} citations={citations} onDone={handleDone} />
      )}

      {/* Gate — Screen 1 (§6.4: no defaults, no skips, no auto-advance) */}
      {screen === 'gate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 16px' }}>
          {/* Emergency banner */}
          <div style={{
            padding: '18px 16px',
            background: C.redBg,
            border: `1px solid ${C.redBorder}`,
            borderRadius: 12,
          }}>
            <h1 style={{
              margin: '0 0 12px',
              fontFamily: serif,
              fontSize: 20, fontWeight: 700,
              color: C.red, lineHeight: 1.3,
            }}>
              {GATE_HEADING}
            </h1>
            <p style={{ margin: '0 0 14px', fontFamily: sans, fontSize: 14, color: C.cream, lineHeight: 1.6 }}>
              Call 000 now — police, fire, or ambulance.
            </p>
            <p style={{ margin: 0, fontFamily: sans, fontSize: 14, color: C.cream60, lineHeight: 1.6 }}>
              Tell them: your venue address (below), what happened, how many people are affected,
              and whether the person is conscious and breathing.
            </p>
          </div>

          {/* Venue address — prominent pre-fill */}
          {venueAddress && (
            <div style={{
              padding: '12px 16px',
              background: C.amberBg,
              border: `1px solid ${C.amberBorder}`,
              borderRadius: 10,
            }}>
              <p style={{ margin: '0 0 4px', fontFamily: mono, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.amber }}>
                This venue's address
              </p>
              <p style={{ margin: 0, fontFamily: mono, fontSize: 15, fontWeight: 600, color: C.cream, lineHeight: 1.4 }}>
                {venueAddress}
              </p>
            </div>
          )}

          {/* Two buttons — equal weight, no pre-selection (§6.4) */}
          <button
            onClick={handleCalled}
            style={{
              width: '100%', padding: '16px 16px',
              background: 'rgba(232,80,80,0.15)',
              border: `1px solid ${C.redBorder}`,
              borderRadius: 12,
              fontFamily: sans, fontSize: 15, fontWeight: 600,
              color: C.cream, cursor: 'pointer',
              lineHeight: 1.4, textAlign: 'left',
              minHeight: 60,
            }}
          >
            {BTN_CALLED}
          </button>

          <button
            onClick={handleNeedToCall}
            style={{
              width: '100%', padding: '16px 16px',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              fontFamily: sans, fontSize: 15, fontWeight: 600,
              color: C.cream, cursor: 'pointer',
              lineHeight: 1.4, textAlign: 'left',
              minHeight: 60,
            }}
          >
            {BTN_NEED}
          </button>
        </div>
      )}
    </div>
  );
}
