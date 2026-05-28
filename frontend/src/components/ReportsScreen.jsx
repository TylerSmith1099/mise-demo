// Reports screen — channel revenue breakdown with multi-select filter,
// date range, and actual vs target / variance / trend (MIS-642).
// Tier 4 (Venue Manager) path. Tier 5 (DM) routes to MobileReportingScreen.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchChannelReports } from '../api.js';

const ALL_CHANNELS = ['gaming', 'bar', 'food', 'bottle_shop'];
const CHANNEL_LABELS  = { gaming: 'Gaming', bar: 'Bar', food: 'Food', bottle_shop: 'Bottle Shop' };
const CHANNEL_COLOURS = { gaming: '#00E87A', bar: '#00C8E8', food: '#E8A020', bottle_shop: '#B87A3C' };
const GRAIN_OPTIONS   = [{ id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' }];
const RANGE_OPTIONS   = [{ id: '7d', label: '7d', days: 6 }, { id: '30d', label: '30d', days: 29 }, { id: '90d', label: '90d', days: 89 }];

function brisToday() { return new Date(Date.now() + 36e6).toISOString().slice(0, 10); }
function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function fmtD(c) { if (c == null) return '—'; const n = Math.round(c / 100); return n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(0)}k` : `$${n}`; }
function fmtV(c) { if (c == null) return '—'; const n = Math.round(c / 100); const s = n >= 0 ? '+' : ''; return Math.abs(n) >= 1e3 ? `${s}$${(n/1e3).toFixed(0)}k` : `${s}$${n}`; }
function fmtP(s, g) {
  if (!s) return '—';
  const d = new Date(s + 'T12:00:00Z');
  if (g === 'monthly') return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (g === 'weekly')  return `w/c ${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function spark(periods, W=80, H=28) {
  const v = periods.slice(-12).map(p => p.actual);
  if (v.length < 2) return null;
  const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1;
  const pts = v.map((val, i) => `${((i/(v.length-1))*W).toFixed(1)},${(H-((val-mn)/r)*H).toFixed(1)}`);
  return `M${pts.join('L')}`;
}

function Chip({ label, active, colour, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ display:'inline-flex', alignItems:'center', gap:5, paddingInline:10, paddingBlock:5, borderRadius:20, border:`1px solid ${active ? colour||'var(--gold)' : 'rgba(234,200,138,0.2)'}`, background: active ? (colour ? colour+'22' : 'rgba(234,200,138,0.12)') : 'transparent', cursor:'pointer', fontFamily:"'DM Sans', sans-serif", fontSize:13, fontWeight: active?600:400, color: active ? (colour||'var(--gold)') : 'var(--cream-60)', whiteSpace:'nowrap', minHeight:32 }}>
      {colour && <span style={{ width:8, height:8, borderRadius:'50%', background:colour, flexShrink:0 }} aria-hidden="true" />}
      {label}
    </button>
  );
}

function VPill({ value }) {
  if (value == null) return <span style={{ color:'var(--cream-40)', fontSize:12 }}>—</span>;
  const pos = value >= 0;
  return <span style={{ display:'inline-flex', alignItems:'center', paddingInline:7, paddingBlock:2, borderRadius:10, background: pos ? 'rgba(0,232,122,0.12)' : 'rgba(232,80,80,0.12)', color: pos ? '#00E87A' : '#E85050', fontFamily:"'IBM Plex Mono', monospace", fontSize:11, fontWeight:600 }}>{fmtV(value)}</span>;
}

function Trend({ t }) {
  if (t == null) return null;
  const up = t >= 0;
  return <span style={{ color: up ? '#00E87A' : '#E85050', fontFamily:"'IBM Plex Mono', monospace", fontSize:12, fontWeight:600 }}>{up?'↑':'↓'} {Math.abs(t).toFixed(1)}%</span>;
}

function ChannelCard({ ch, grain, expanded, onToggle }) {
  const latest = ch.periods[ch.periods.length - 1];
  const sp = spark(ch.periods);
  const col = ch.colour;
  return (
    <div style={{ borderRadius:16, border:`1px solid ${col}33`, background:'var(--surface)', overflow:'hidden' }}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'12px 14px', background:'none', border:'none', cursor:'pointer', textAlign:'left', minHeight:44 }}>
        <span style={{ width:10, height:10, borderRadius:'50%', background:col, flexShrink:0 }} aria-hidden="true" />
        <span style={{ flex:1, fontFamily:"'Space Grotesk', sans-serif", fontSize:15, fontWeight:600, color:'var(--cream)' }}>{ch.label}</span>
        {sp && <svg width="80" height="28" viewBox="0 0 80 28" aria-hidden="true" style={{ flexShrink:0 }}><path d={sp} fill="none" stroke={col} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        {latest && <span style={{ fontFamily:"'IBM Plex Mono', monospace", fontSize:13, fontWeight:700, color:'var(--cream)', minWidth:52, textAlign:'right' }}>{fmtD(latest.actual)}</span>}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cream-40)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink:0, transform: expanded ? 'rotate(180deg)' : 'none', transition:'transform 0.2s' }} aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {latest && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', borderTop:`1px solid ${col}22`, borderBottom: expanded ? `1px solid ${col}22` : 'none' }}>
          {[['Actual', <span style={{ fontFamily:"'IBM Plex Mono', monospace", fontSize:13, fontWeight:700, color:'var(--cream)' }}>{fmtD(latest.actual)}</span>], ['Target', <span style={{ fontFamily:"'IBM Plex Mono', monospace", fontSize:13, color:'var(--cream-60)' }}>{fmtD(latest.target)}</span>], ['Variance', <VPill value={latest.variance} />], ['Trend', <Trend t={latest.trend} />]].map(([lbl, node], i) => (
            <div key={lbl} style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'8px 4px', borderLeft: i > 0 ? `1px solid ${col}22` : 'none' }}>
              <span style={{ fontFamily:"'IBM Plex Mono', monospace", fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--cream-40)' }}>{lbl}</span>
              <span style={{ marginTop:3 }}>{node}</span>
            </div>
          ))}
        </div>
      )}

      {expanded && ch.periods.length > 0 && (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }} aria-label={`${ch.label} history`}>
            <thead><tr>{['Period','Actual','Target','Variance','Trend'].map((h,i) => <th key={h} style={{ padding:'6px 10px', fontFamily:"'IBM Plex Mono', monospace", fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--cream-40)', fontWeight:600, textAlign: i===0?'left':'right', background:'rgba(0,0,0,0.15)', whiteSpace:'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>
              {[...ch.periods].reverse().slice(0, 30).map(p => (
                <tr key={p.period} style={{ borderTop:`1px solid ${col}14` }}>
                  <td style={{ padding:'7px 10px', fontFamily:"'DM Sans', sans-serif", fontSize:13, color:'var(--cream-80)', whiteSpace:'nowrap' }}>{fmtP(p.period, grain)}</td>
                  <td style={{ padding:'7px 10px', fontFamily:"'IBM Plex Mono', monospace", fontSize:12, color:'var(--cream)', textAlign:'right', fontWeight:600 }}>{fmtD(p.actual)}</td>
                  <td style={{ padding:'7px 10px', fontFamily:"'IBM Plex Mono', monospace", fontSize:12, color:'var(--cream-60)', textAlign:'right' }}>{fmtD(p.target)}</td>
                  <td style={{ padding:'7px 10px', textAlign:'right' }}><VPill value={p.variance} /></td>
                  <td style={{ padding:'7px 10px', textAlign:'right' }}><Trend t={p.trend} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ReportsScreen({ onAuthError }) {
  const [selCh, setSelCh]  = useState(new Set(ALL_CHANNELS));
  const [range, setRange]  = useState('30d');
  const [grain, setGrain]  = useState('weekly');
  const [st, setSt]        = useState({ status:'loading', data:null });
  const [exp, setExp]      = useState(new Set(['gaming']));
  const abort = useRef(null);

  const load = useCallback(() => {
    abort.current?.abort();
    const ac = new AbortController(); abort.current = ac;
    setSt(s => ({ ...s, status:'loading' }));
    const today = brisToday();
    const days  = RANGE_OPTIONS.find(r => r.id === range)?.days ?? 29;
    fetchChannelReports({ from: addDays(today, -days), to: today, grain, channels: [...selCh] })
      .then(data => { if (!ac.signal.aborted) setSt({ status:'ready', data }); })
      .catch(err => { if (ac.signal.aborted) return; if (err.status === 401) { onAuthError?.(); return; } setSt({ status:'error', data:null }); });
  }, [selCh, range, grain, onAuthError]);

  useEffect(() => { load(); }, [load]);

  const toggleCh  = ch  => setSelCh(p  => { const n = new Set(p); n.has(ch) && n.size > 1 ? n.delete(ch) : n.add(ch); return n; });
  const toggleExp = ch  => setExp(p => { const n = new Set(p); n.has(ch) ? n.delete(ch) : n.add(ch); return n; });

  return (
    <section data-testid="reports-screen" style={{ display:'flex', flexDirection:'column', gap:14, width:'100%', maxWidth:420, margin:'0 auto' }} aria-label="Channel revenue reports">
      <header style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', paddingInline:2 }}>
        <div>
          <p style={{ fontFamily:"'IBM Plex Mono', monospace", fontSize:11, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--cream-40)', margin:0 }}>Reports</p>
          <h2 style={{ fontFamily:"'Space Grotesk', sans-serif", fontSize:16, fontWeight:700, color:'var(--gold)', margin:0 }}>Revenue by Channel</h2>
        </div>
        {st.status === 'loading' && <div style={{ width:16, height:16, border:'2px solid rgba(234,200,138,0.3)', borderTopColor:'var(--gold)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />}
      </header>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {ALL_CHANNELS.map(ch => <Chip key={ch} label={CHANNEL_LABELS[ch]} colour={CHANNEL_COLOURS[ch]} active={selCh.has(ch)} onClick={() => toggleCh(ch)} />)}
      </div>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
        {GRAIN_OPTIONS.map(g => <Chip key={g.id} label={g.label} active={grain===g.id} onClick={() => setGrain(g.id)} />)}
        <div style={{ width:1, height:20, background:'rgba(234,200,138,0.2)', flexShrink:0 }} />
        {RANGE_OPTIONS.map(r => <Chip key={r.id} label={r.label} active={range===r.id} onClick={() => setRange(r.id)} />)}
      </div>

      {st.status === 'error' && (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'32px 20px', gap:8 }}>
          <p style={{ fontFamily:"'Space Grotesk', sans-serif", fontSize:15, fontWeight:600, color:'var(--cream)', margin:0 }}>Couldn't load reports</p>
          <button type="button" onClick={load} style={{ marginTop:8, paddingInline:16, paddingBlock:8, borderRadius:20, border:'1px solid var(--gold-25)', background:'transparent', color:'var(--gold)', fontFamily:"'DM Sans', sans-serif", fontSize:13, cursor:'pointer', minHeight:44 }}>Retry</button>
        </div>
      )}

      {st.status !== 'error' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {st.status === 'loading'
            ? ALL_CHANNELS.filter(c => selCh.has(c)).map(ch => <div key={ch} style={{ height:88, borderRadius:16, background:'var(--surface)', border:`1px solid ${CHANNEL_COLOURS[ch]}22`, opacity:0.6 }} />)
            : (st.data?.channels || []).map(ch => <ChannelCard key={ch.channel} ch={ch} grain={grain} expanded={exp.has(ch.channel)} onToggle={() => toggleExp(ch.channel)} />)
          }
          {st.status === 'ready' && (st.data?.channels||[]).length === 0 && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'32px 20px', gap:6 }}>
              <p style={{ fontFamily:"'Space Grotesk', sans-serif", fontSize:15, fontWeight:600, color:'var(--cream)', margin:0 }}>No data for this range</p>
              <p style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13, color:'var(--cream-55)', margin:0 }}>Try a wider date range or different channels.</p>
            </div>
          )}
        </div>
      )}

      {st.data?.scopeClamped && <p style={{ fontFamily:"'IBM Plex Mono', monospace", fontSize:11, color:'var(--cream-40)', textAlign:'center', margin:0 }}>Range limited to 7 days for your role.</p>}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </section>
  );
}
