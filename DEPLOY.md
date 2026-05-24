# Mise — Demo Deployment

Single-origin container: the Node/Express backend serves both the API and the
prebuilt React SPA, so the entire demo runs on one HTTPS URL (no CORS, no
hardcoded backend host — the client uses relative `/auth` and `/api` paths).

## Artifacts

- `Dockerfile` — Node 20 image; build context is this `MISE/` directory.
- `backend/docker-entrypoint.sh` — migrate (always) → seed + ingest (if `SEED_ON_BOOT=1`) → demo extras (always, both tenants) → start.
- `render.yaml` — Render Blueprint: provisions Postgres + web service, wires `DB_CONNECTION_STRING`, generates `JWT_SECRET`.
- `railway.json` — Railway Dockerfile deploy config (add a Postgres plugin; set env vars in the dashboard).

## Live Render service — IMPORTANT drift from the blueprint

The live demo at https://mise-demo.onrender.com is configured as a **Node
runtime** with an explicit dashboard **Start Command** — NOT the Docker runtime
declared in `render.yaml`. Because of this, `docker-entrypoint.sh` does NOT run
on the live service; the dashboard Start Command is authoritative. If you ever
recreate the service from the blueprint it will run Docker (and
`docker-entrypoint.sh`, which is kept in sync), but the current live service is
Node. Keep these two paths in lockstep when changing boot behaviour.

Live Start Command (Render dashboard → Settings → Start Command):

```
cd backend && node scripts/migrate.js && node src/demo/seed.js && node scripts/ingest-legislation.js && (DEMO_CLIENT_ID=a4cba394-238e-47f5-a2b4-25e2cfccb85d DEMO_VENUE_ID=a6d8aee2-92de-4400-9ef0-a227d42496c1 node scripts/seed-steward-extras.js || true) && (DEMO_CLIENT_ID=a0000000-0000-4000-8000-000000000001 DEMO_VENUE_ID=a0000000-0000-4000-8000-000000000002 node scripts/seed-steward-extras.js || true) && node src/server.js
```

`scripts/seed-steward-extras.js` populates the data behind the Run Sheet, Revenue
and Reports screens (shifts, runsheet_items, pnl_summary). It is idempotent and
date-aware — it re-anchors shifts to the current Brisbane day on every boot so
there is always an active shift for the demo. It uses **soft deletes**
(`UPDATE ... SET deleted_at = NOW()`), never `DELETE`, because the `mise_app`
role has no DELETE grant (see migration 005).

## Environment variables

| Var | Value | Notes |
|---|---|---|
| `JWT_ALGORITHM` | `HS256` | RS256 is preferred for prod; HS256 is fine for the demo. |
| `JWT_SECRET` | generated | Long random string. Render generates it automatically. |
| `DB_CONNECTION_STRING` | from Postgres | Render injects via `fromDatabase`. |
| `SESSION_EXPIRY_HOURS` | `8` | |
| `SESSION_TIMEOUT_MINUTES` | `30` | |
| `SERVE_FRONTEND` | `1` | Set `0` only if a CDN serves the SPA. |
| `SEED_ON_BOOT` | `1` | Seeds demo accounts + ingests legislation on first boot. |
| `PORT` | platform-injected | App defaults to 3000. |
| `ANTHROPIC_API_KEY` | secret | Optional. Unset → deterministic fallback (demo-viable). |
| `ANTHROPIC_BASE_URL` | AU endpoint | Required if the key is set; must be AU-resident (Bedrock ap-southeast-2). |

## Demo accounts (seeded by `src/demo/seed.js`)

The login screen asks for **Client ID + Venue ID + email + password**. These ids
are FIXED and idempotent across redeploys (overridable via `DEMO_CLIENT_ID` /
`DEMO_VENUE_ID` env):

- **Client ID:** `a0000000-0000-4000-8000-000000000001`
- **Venue ID:** `a0000000-0000-4000-8000-000000000002`

The live demo is driven from a second tenant (The Steward Hotel) which the Start
Command also seeds:

- **Client ID:** `a4cba394-238e-47f5-a2b4-25e2cfccb85d`
- **Venue ID:** `a6d8aee2-92de-4400-9ef0-a227d42496c1`

Password for all accounts: `mise-demo-2026`

- `gaming@steward.demo` — Gaming Attendant (Scene 1)
- `dutymanager@steward.demo` — Duty Manager (Scene 2 + 3)
- `manager@steward.demo` — Venue Manager

## One-shot seed/ingest (persistent DB)

If you don't use `SEED_ON_BOOT`, run once after the first deploy:

```
node scripts/migrate.js
node src/demo/seed.js
node scripts/ingest-legislation.js
```

## Local container smoke test

```
docker build -t mise-demo -f Dockerfile .
docker run --rm -p 3000:3000 \
  -e JWT_ALGORITHM=HS256 -e JWT_SECRET=dev-only-secret \
  -e SESSION_EXPIRY_HOURS=8 -e SESSION_TIMEOUT_MINUTES=30 \
  -e SEED_ON_BOOT=1 \
  -e DB_CONNECTION_STRING=postgres://user:pass@host:5432/mise \
  mise-demo
# then open http://localhost:3000 → login screen
```

## DATA RESIDENCY (non-negotiable for real data)

`config.js` mandates AWS **ap-southeast-2 (Sydney)** for real staff/session data
under the Privacy Act 2024-25 reforms. Render/Railway have **no AU region**
(closest: Singapore). Hosting there is acceptable **only for this demo because
all seeded data is synthetic** (fictional staff). The production path is AWS
ap-southeast-2 (ECS + RDS). If a Claude key is set, `ANTHROPIC_BASE_URL` must
point at an AU-resident endpoint or synthesis stays off.
