// Render Cron Job keep-warm ping — runs every 5 minutes to prevent cold starts.
// Calls /health and exits 0 on 200, 1 on any error (so Render marks the run failed
// and alerts if the service is actually down).
import { get } from 'https';

const url = process.env.KEEP_WARM_URL || 'https://mise-demo.onrender.com/health';

const req = get(url, (res) => {
  const ok = res.statusCode === 200;
  console.log(`[keep-warm] ${ok ? 'OK' : 'WARN'} HTTP ${res.statusCode} — ${url}`);
  process.exit(ok ? 0 : 1);
});

req.on('error', (e) => {
  console.error(`[keep-warm] ERROR — ${e.message}`);
  process.exit(1);
});

req.setTimeout(10_000, () => {
  console.error('[keep-warm] TIMEOUT — no response in 10s');
  req.destroy();
  process.exit(1);
});
