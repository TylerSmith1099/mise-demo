# Mise — Demo Deployment

Single-origin container: the Node/Express backend serves both the API and the
prebuilt React SPA, so the entire demo runs on one HTTPS URL (no CORS, no
hardcoded backend host — the client uses relative `/auth` and `/api` paths).

## Artifacts

- `Dockerfile` — Node 20 image; build context is this `MISE/` directory.
- `backend/docker-entrypoint.sh` — migrate (always) → seed + ingest (if `SEED_ON_BOOT=1`) → start.
- `render.yaml` — Render Blueprint: provisions Postgres + web service, wires `DB_CONNECTION_STRING`, generates `JWT_SECRET`.
- `railway.json` — Railway Dockerfile deploy config (add a Postgres plugin; set env vars in the dashboard).

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

Password for all three: `mise-demo-2026`

- `gaming@steward.demo` — Gaming Attendant (Scene 1)
- `dutymanager@steward.demo` — Duty Manager (Scene 2)
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
