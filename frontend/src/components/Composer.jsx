// Composer — the message input + send button. Auto-grows up to a few lines,
// sends on Enter (Shift+Enter for a newline), and respects the iOS safe area.
// Send button is a 44×44 minimum tap target. Disabled while a reply is in
// flight so we don't double-fire on a laggy 4G connection.
//
// Props: { onSend(text), disabled }
import React, { useRef, useState } from 'react';

export default function Composer({ onSend, disabled }) {
  const [value, setValue] = useState('');
  const taRef = useRef(null);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
    if (taRef.current) taRef.current.style.height = 'auto';
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onInput = (e) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <footer
      className="shrink-0 border-t border-hairline bg-charcoal px-3 pt-2.5"
      style={{ paddingBottom: 'calc(var(--safe-bottom) + 0.625rem)' }}
    >
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          value={value}
          onChange={onInput}
          onKeyDown={onKeyDown}
          rows={1}
          inputMode="text"
          enterKeyHint="send"
          placeholder="Ask Mise…"
          aria-label="Message Mise"
          className="max-h-[120px] flex-1 resize-none rounded-2xl border border-hairline bg-surface px-3.5 py-2.5 text-[15px] text-cream placeholder:text-cream/35 focus:border-gold/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label="Send message"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold text-cream transition-opacity disabled:opacity-30"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 12l16-8-6 16-2.5-6.5L4 12Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    </footer>
  );
}
