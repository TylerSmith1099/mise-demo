// MessageThread — the scrollable conversation. Auto-scrolls to the newest turn.
// Empty state gives role-appropriate prompts so a first-time user on the floor
// knows what to ask. The thread is the only vertically-scrolling region; the
// top bar and composer stay fixed.
//
// Props: { messages: [msg], session, summary?, reservations?, onAskHandover? }
import React, { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble.jsx';
import ShiftSummary from './ShiftSummary.jsx';

export default function MessageThread({ messages, session, summary, reservations, onAskHandover }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  return (
    <main className="mise-thread flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
      {messages.length === 0 ? (
        // A Duty/Venue Manager opening with no message gets the live shift
        // summary (MIS-43); everyone else gets the role-appropriate prompts.
        summary ? (
          <ShiftSummary
            summary={summary}
            reservations={reservations}
            staffName={session?.staffName}
            onAskHandover={onAskHandover}
          />
        ) : (
          <EmptyState session={session} />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
        </div>
      )}
      <div ref={endRef} />
    </main>
  );
}

function EmptyState({ session }) {
  const role = session?.role || 'staff';
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full border border-gold/50 font-data text-lg font-semibold text-gold">
        M
      </div>
      <p className="mt-3 text-base font-semibold text-cream">
        {session?.staffName ? `G'day, ${session.staffName.split(' ')[0]}.` : "G'day."}
      </p>
      <p className="mt-1 text-sm text-cream/60">
        Ask me anything about your shift, RG obligations, or venue procedure.
      </p>
      <p className="mt-4 font-data text-[12px] uppercase tracking-wider text-cream/35">
        {role}
      </p>
    </div>
  );
}
