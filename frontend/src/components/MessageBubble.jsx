// MessageBubble — one turn in the thread. User and Mise turns are visually
// distinct: user bubbles are gold and right-aligned; Mise bubbles sit left on a
// raised surface with the Mise mark. Mise answers carry their confidence
// indicator (when flagged) and source citations beneath the text.
//
// Props (msg):
//   { id, role: 'user'|'mise', content, citations?, confidence?, lowConfidence?,
//     confidenceFloor?, time?, pending?, error?, kind?, handover? }
// A msg with kind:'handover' renders the structured handover note (MIS-43)
// inside the Mise bubble instead of plain answer prose.
import React from 'react';
import Citations from './Citations.jsx';
import ConfidenceIndicator from './ConfidenceIndicator.jsx';
import Handover from './Handover.jsx';

function Time({ time }) {
  if (!time) return null;
  return <span className="mt-1 block font-data text-[12px] text-cream/35">{time}</span>;
}

export default function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div className="mise-rise flex justify-end">
        <div className="max-w-[82%] rounded-2xl rounded-br-sm bg-gold px-3.5 py-2.5">
          <p className="whitespace-pre-wrap break-words text-[15px] leading-snug text-cream">
            {msg.content}
          </p>
          <Time time={msg.time} />
        </div>
      </div>
    );
  }

  return (
    <div className="mise-rise flex justify-start">
      <div className="flex max-w-[88%] gap-2">
        {/* Mise mark */}
        <div
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-gold/50 font-data text-[12px] font-semibold text-gold"
          aria-hidden="true"
        >
          M
        </div>
        <div className="min-w-0 rounded-2xl rounded-bl-sm border border-hairline bg-surface px-3.5 py-2.5">
          {msg.pending ? (
            <span className="flex items-center gap-1.5 py-1" aria-label="Mise is typing">
              <Dot delay="0ms" />
              <Dot delay="120ms" />
              <Dot delay="240ms" />
            </span>
          ) : msg.kind === 'handover' ? (
            <>
              <Handover handover={msg.handover} />
              <Time time={msg.time} />
            </>
          ) : (
            <>
              <p
                className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${
                  msg.error ? 'text-red' : 'text-cream'
                }`}
              >
                {msg.content}
              </p>
              {!msg.error && (
                <ConfidenceIndicator
                  confidence={msg.confidence}
                  floor={msg.confidenceFloor}
                  lowConfidence={msg.lowConfidence}
                />
              )}
              {!msg.error && <Citations citations={msg.citations} />}
              <Time time={msg.time} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Dot({ delay }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full bg-cream/50"
      style={{ animation: 'mise-rise 700ms ease-in-out infinite alternate', animationDelay: delay }}
    />
  );
}
