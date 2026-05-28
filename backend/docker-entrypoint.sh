#!/bin/sh
# Mise container boot. Order matters:
#   1. migrate  — always (numbered, idempotent: applied migrations are skipped)
#   2. seed + ingest — only when SEED_ON_BOOT=1 (first boot against a fresh DB)
#   3. start the server
#
# For an ephemeral demo DB, set SEED_ON_BOOT=1 so the demo accounts + QLD
# legislation are present on first boot. Leave it unset on a persistent DB and
# run the seed/ingest once as a release step instead (see DEPLOY.md).
set -e

echo "[entrypoint] applying migrations…"
node scripts/migrate.js

if [ "$SEED_ON_BOOT" = "1" ]; then
  echo "[entrypoint] seeding demo group tenant (v2: siblings + tier 1–3 personas)…"
  node src/demo/seed-demo-v2.js || echo "[entrypoint] seed-demo-v2 gate/seed non-zero — non-fatal, continuing"
  echo "[entrypoint] ingesting legislation…"
  node scripts/ingest-legislation.js
fi

# Demo data freshness — always run, even on a persistent DB with SEED_ON_BOOT
# unset. The runsheet + reports screens depend on shifts/runsheet/pnl that only
# seed-steward-extras creates, and it is safe to run on every boot: it is
# idempotent (skips when today's shifts already exist) and self-heals date drift
# by re-anchoring shifts to the current Brisbane day so there is always an active
# shift for the demo. Run for the documented demo tenant ids; non-fatal so a
# failure can never block server start.
echo "[entrypoint] ensuring demo extras (shifts/runsheet/pnl) for current day…"
DEMO_CLIENT_ID=a4cba394-238e-47f5-a2b4-25e2cfccb85d DEMO_VENUE_ID=a6d8aee2-92de-4400-9ef0-a227d42496c1 \
  node scripts/seed-steward-extras.js || echo "[entrypoint] extras seed (a4cba394) skipped/failed — non-fatal"
DEMO_CLIENT_ID=a0000000-0000-4000-8000-000000000001 DEMO_VENUE_ID=a0000000-0000-4000-8000-000000000002 \
  node scripts/seed-steward-extras.js || echo "[entrypoint] extras seed (a0000000) skipped/failed — non-fatal"

echo "[entrypoint] seeding per-channel revenue and bookings (MIS-642)…"
DEMO_CLIENT_ID=a4cba394-238e-47f5-a2b4-25e2cfccb85d DEMO_VENUE_ID=a6d8aee2-92de-4400-9ef0-a227d42496c1 \
  node scripts/seed-revenue-channels.js || echo "[entrypoint] channel seed (a4cba394) skipped/failed — non-fatal"
DEMO_CLIENT_ID=a0000000-0000-4000-8000-000000000001 DEMO_VENUE_ID=a0000000-0000-4000-8000-000000000002 \
  node scripts/seed-revenue-channels.js || echo "[entrypoint] channel seed (a0000000) skipped/failed — non-fatal"

echo "[entrypoint] seeding demo incidents for current day…"
DEMO_CLIENT_ID=a4cba394-238e-47f5-a2b4-25e2cfccb85d DEMO_VENUE_ID=a6d8aee2-92de-4400-9ef0-a227d42496c1 \
  node scripts/seed-demo-incidents.js || echo "[entrypoint] incident seed (a4cba394) skipped/failed — non-fatal"
DEMO_CLIENT_ID=a0000000-0000-4000-8000-000000000001 DEMO_VENUE_ID=a0000000-0000-4000-8000-000000000002 \
  node scripts/seed-demo-incidents.js || echo "[entrypoint] incident seed (a0000000) skipped/failed — non-fatal"

echo "[entrypoint] starting Mise server…"
exec node src/server.js
