// Login — minimal token-issuance screen. The chat UI needs a verified token
// before it can show anything (no hardcoded session), so this posts to
// /auth/login and stores the returned token. Venue/client are entered here for
// the MVP; in production these resolve from the device/venue binding rather
// than being typed. Role is NOT chosen here — it comes from the token.
//
// Props: { onAuthenticated(loginResult) }
import React, { useState } from 'react';
import { login } from '../api.js';

export default function Login({ onAuthenticated }) {
  const [form, setForm] = useState({ clientId: '', venueId: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(form);
      onAuthenticated(result);
    } catch (err) {
      setError(err.status === 401 ? 'Invalid credentials' : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex min-h-full flex-col justify-center px-6"
      style={{
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'var(--safe-bottom)',
        background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(46,107,174,0.25) 0%, transparent 60%), var(--charcoal)',
      }}
    >
      <div className="mx-auto w-full max-w-[340px]">
        <div className="mb-7 text-center">
          <div
            className="mx-auto grid h-14 w-14 place-items-center rounded-2xl font-data text-2xl font-bold text-gold"
            style={{
              border: '1px solid rgba(46,107,174,0.5)',
              background: 'linear-gradient(135deg, rgba(14,42,69,0.8) 0%, rgba(28,22,18,0.6) 100%)',
              boxShadow: '0 0 24px rgba(46,107,174,0.15)',
            }}
          >
            M
          </div>
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-gold">Mise</h1>
          <p className="mt-1 text-sm text-cream/60">Sign in to start your shift.</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Client ID" value={form.clientId} onChange={set('clientId')} mono />
          <Field label="Venue ID" value={form.venueId} onChange={set('venueId')} mono optional />
          <Field label="Email" type="email" value={form.email} onChange={set('email')} autoComplete="username" />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete="current-password"
          />

          {error && (
            <p className="rounded-md border border-red/40 bg-red/10 px-3 py-2 text-sm text-red" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 grid min-h-[48px] place-items-center rounded-2xl bg-gold text-base font-semibold text-charcoal transition-opacity disabled:opacity-40"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, mono, optional, ...props }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold uppercase tracking-wider text-cream/45">
        {label}
        {optional && <span className="ml-1 normal-case tracking-normal opacity-50">(optional)</span>}
      </span>
      <input
        {...props}
        required={!optional}
        className={`rounded-xl border border-hairline bg-surface px-3.5 py-3 text-[15px] text-cream placeholder:text-cream/30 focus:border-gold/60 focus:outline-none ${
          mono ? 'font-data' : ''
        }`}
      />
    </label>
  );
}
