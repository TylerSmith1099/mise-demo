# Mise — PostgreSQL data layer (MVP)

Numbered, reversible migrations for the Mise relational data layer. Owned by the
Database Agent. Auth session logic and the pgvector store are out of scope here.

## Files
| File | Purpose |
|------|---------|
| `001_initial_schema.sql` | clients, venues, staff, sessions (core + identity) |
| `002_conversations_messages.sql` | conversations, messages |
| `003_compliance.sql` | compliance_events, certifications |
| `004_shifts.sql` | shifts, runsheet_items |
| `005_rls_policies.sql` | `mise_app` role + RLS (ENABLE + FORCE) and isolation policies on all 10 tables |
| `006_role_at_login_immutable.sql` | trigger making `sessions.role_at_login` INSERT-only |
| `007_auth_credentials.sql` | `staff.password_hash` + system `failed_logins` (Auth stage) |
| `008_pgvector_document_chunks.sql` | pgvector + `document_chunks` knowledge base, RLS with NULL=shared legislation (Knowledge stage) |
| `009_demo_dataset.sql` | seeded demo dataset (clients/venues/staff/etc.) for the MVP demo |
| `010_rls_cached_predicates.sql` | wrap RLS `current_setting()` in `(SELECT ...)` so the tenant id evaluates once per statement (InitPlan), not per row |
| `011_knowledge_four_layer_isolation.sql` | knowledge four-layer isolation (MIS-71/MIS-76): `content_type` discriminator + `venue_id` + per-layer CHECK so a venue never sees another venue's licence conditions (lockstep with `knowledge/schema.sql`) |
| `012_rag_hybrid_search.sql` | hybrid retrieval (MIS-72): `context` column + GENERATED `content_tsv` tsvector + GIN index for the BM25-style lexical leg (lockstep with `knowledge/schema.sql`) |
| `013_document_chunks_composite_venue_fk.sql` | venue_id FK hardening (MIS-101, QA rec): replace the migration-011 single-column `venue_id` FK with the composite `(client_id, venue_id) REFERENCES venues` used by every other client-scoped table — a `licence_condition` chunk can no longer pin another client's venue at write time (defense-in-depth behind RLS + the four-layer predicate) |
| `../tests/isolation_test.sql` | client-isolation proof (run as superuser) |

Apply in numeric order. Each file has an `UP` section and a commented `DOWN`
(rollback) section; a migration runner un-comments and runs `DOWN` to reverse.

### Numbering (unique, no collisions)
Every `NNN_` prefix MUST be unique. A duplicate number is silently dangerous: a
number-keyed runner records one as applied and **skips** the other, half-migrating
the data layer with no error. This is enforced in two places so it cannot recur:
- `scripts/migrate.js` (`assertUniqueMigrationNumbers`) **throws before applying**
  if any number repeats — the runner is the single allocator/ledger of record.
- `test/migrations.test.js` gates it at PR time (`npm test`, no DB needed):
  unique prefixes + contiguous, gap-free order.

When opening a migration, take the next free number from `ls migrations/` (don't
reuse one from a stale branch). If two branches grab the same number, the loser
renumbers — the test will flag it before merge.

## Apply
```bash
# Glob matches every NNN_*.sql (001 … 012 …); `sort -V` guarantees numeric order.
for f in $(ls migrations/[0-9][0-9][0-9]_*.sql | sort -V); do
  psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f "$f"
done
```

## Run the isolation test
```bash
psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f tests/isolation_test.sql
# expect: "ALL ISOLATION TESTS PASSED"
```

## Isolation contract (how the app MUST use this)
RLS keys off a per-connection setting. Set it **per transaction** with
`SET LOCAL` so it cannot bleed across a pooled connection:

```sql
BEGIN;
  SET LOCAL ROLE mise_app;                              -- least-privilege, FORCE-RLS subject
  SET LOCAL app.current_client_id = '<uuid from verified session>';
  -- ... queries ...
COMMIT;  -- setting auto-clears
```

The `client_id` is set by the Auth Agent from a server-verified session — never
from user input. An unset/empty value sees **zero rows** (fail-closed).

## Invariants enforced
- `client_id` (NOT NULL) on every client-data table; RLS ENABLED + FORCED on all 10.
- No FKs cross a client boundary — child rows reference parents by composite
  `(client_id, <id>)`, so a row can never point at another client's parent.
- Soft deletes only: `deleted_at` on every table + domain `status` columns. The
  `mise_app` role has no `DELETE` grant.
- All timestamps `TIMESTAMPTZ` (UTC); DB timezone forced to UTC.
- `sessions.role_at_login` is INSERT-only (BEFORE UPDATE trigger + revoked column UPDATE).
- Data residency: deploy only to AWS `ap-southeast-2` (Sydney). No data leaves Australia.
- Auth/identity is self-hosted (JWT + sessions in this DB and `backend/auth`); no
  third-party auth SaaS (Auth0/Clerk/Firebase/Cognito). Staff & session data stay AU-resident.
