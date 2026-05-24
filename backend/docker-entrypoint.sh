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
  echo "[entrypoint] seeding Steward demo accounts…"
  node src/demo/seed.js
  echo "[entrypoint] seeding Steward extras (shifts, runsheet, pnl)…"
  node scripts/seed-steward-extras.js
  echo "[entrypoint] ingesting legislation…"
  node scripts/ingest-legislation.js
fi

echo "[entrypoint] starting Mise server…"
exec node src/server.js
