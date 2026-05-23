# Mise — Knowledge Base Manifest

Human-readable record of what is ingested into the pgvector knowledge base
(`document_chunks`). The machine-readable source of truth is
[`manifest.json`](./manifest.json), written by the ingestion pipeline
(`src/rag/ingest.js → appendManifest`); this file is the reviewable summary.

- **Vector store:** pgvector `document_chunks` in the shared Mise PostgreSQL
  instance (AU residency — no separate service, no data leaves AWS ap-southeast-*).
- **Embedding model:** `mise-local-hashing-v1` — deterministic, fully offline
  (no external/embedding-service calls). **Deploy flag:** swap in an AU-hosted
  semantic model (e.g. MiniLM/BGE on ap-southeast-2 or Bedrock Titan in an AU
  region); `vector(384)` needs no schema change.
- **Isolation:** shared legislation is `client_id = NULL` (visible to all
  clients); client SOPs carry the client UUID and are visible only to that
  client. Enforced by RLS at query time, every query.
- **Superseding:** re-ingesting a source archives prior chunks with
  `superseded_at` (retained for audit) — never deleted.

## Layer 1 — Shared legislation (`client_id = null`)

| Source | State | Last updated | Chunks |
|---|---|---|---|
| Gaming Machine Act 1991 (QLD) | QLD | 2024-01-01 | 7 |
| Queensland Responsible Gambling Code of Practice | QLD | 2024-01-01 | 7 |
| Liquor Act 1992 (QLD) | QLD | 2024-01-01 | 6 |
| Work Health and Safety Act 2011 (QLD) | QLD | 2024-01-01 | 6 |
| Fair Work Act 2009 (Cth) | national (all states) | 2024-01-01 | 5 |
| Hospitality Industry (General) Award 2020 | national (all states) | 2024-07-01 | 5 |
| Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) | national (all states) | 2026-03-31 | 8 |

**Subtotal:** 7 documents, **44 chunks**.

> Legislation chunks are representative sectioned summaries for the MVP demo.
> **Deploy flag:** load full statute/award text and re-embed with the AU-hosted
> production model.

> **AML/CTF (MIS-92, Tranche-1, commenced 31 Mar 2026):** Legal-authored summary
> covering reporting-entity capture, the **$5,000** gaming-payout CDD trigger
> (down from $10,000), the single consolidated AML/CTF program (Part A/Part B
> abolished), the AML/CTF compliance officer + AUSTRAC notification, and ongoing
> TTR/SMR reporting. **DEPLOY-FLAGGED** — solicitor sign-off pending
> (`Ops/Questions.md`); not execution-ready until Legal clears it (MIS-89).
> The doc carries an explicit *boundary note* separating the federal $5,000 CDD
> trigger from the QLD *Gaming Machine Act 1991* / RG Code "pay winnings by
> cheque" prescribed threshold — the two must not be conflated.

## Layer 2 — Client SOPs (per-client, isolated)

Authored for the demo client *The Criterion Hotel* and ingested under each demo
client id (QLD). Each set is visible only to its own `client_id`.

| Source | State | Last updated | Chunks |
|---|---|---|---|
| Criterion SOP — Cash Management | QLD | 2026-05-01 | 3 |
| Criterion SOP — Opening and Closing | QLD | 2026-05-01 | 2 |
| Criterion SOP — Gaming Floor Procedures | QLD | 2026-05-01 | 3 |
| Criterion SOP — Responsible Service of Alcohol | QLD | 2026-05-01 | 2 |
| Criterion SOP — Responsible Gambling Patron Interaction | QLD | 2026-05-01 | 2 |
| Criterion SOP — Incident Reporting | QLD | 2026-05-01 | 2 |

**Per client:** 6 documents, 14 chunks. Ingested for 2 demo client ids
(`ced250c1-…` and `54acbf36-…`) → **28 chunks**.

## Ingestion log — Demo SOPs (MIS-70)

Three finalised, **DEMO-ACTIVE** SOPs (Content Integrity CLEAR ×3, MIS-59),
authored as local markdown under `Knowledge Base/SOPs/` and ingested as
**client-isolated `sop` rows** via the four-layer pipeline
(`MISE/backend/knowledge/ingest.js`), scoped to **Pinnacle Hotel Group / The
Criterion Hotel (QLD)**. As `content_type = 'sop'` rows they are visible only
inside the owning client's partition (RLS on `app.current_client_id` + the
explicit four-layer `WHERE` in `retrieve.js`) and are cleanly removable as a
demo set for the Demo→Live swap (MIS-62) by `source`/`client_id`.

| Source | File | Content type | Scope | Last updated | Chunks |
|---|---|---|---|---|---|
| Criterion SOP — Responsible Service of Alcohol | `SOPs/RSA/rsa-procedures.md` | sop | client_id = Pinnacle (QLD) | 2026-05-01 | 1 |
| Criterion SOP — Gaming Floor Procedures | `SOPs/Gaming/gaming-floor-procedures.md` | sop | client_id = Pinnacle (QLD) | 2026-05-01 | 1 |
| Criterion SOP — Responsible Gambling Patron Interaction | `SOPs/Risk-Management/responsible-gambling-patron-interaction-procedures.md` | sop | client_id = Pinnacle (QLD) | 2026-05-01 | 1 |

**Subtotal:** 3 documents, **3 chunks** (one chunk per SOP — the four-layer
chunker packs short demo SOPs to a single self-contained 300-token chunk; the
machine-readable record with per-file `sha256` is in `manifest.json` →
`ingested[]`). Verified queryable end-to-end via `retrieve.js` against the
canonical four-layer schema: EGM-malfunction → *Gaming Floor Procedures*,
patron-interaction → *Responsible Gambling Patron Interaction*, RSA-refusal →
*Responsible Service of Alcohol* (top match each, above the 0.60 floor); the
identical query under a different `client_id` returns **0** rows (isolation).

> **Note (two ingestion paths):** the Layer 2 table above lists the earlier
> inline-text SOP set ingested via `scripts/ingest-sops.js` into the two-layer
> `src/rag` table (migration 008). This MIS-70 set is the file-sourced ingestion
> into the four-layer `document_chunks` (`MISE/backend/knowledge/schema.sql`),
> the schema the `content_type`/`sop`-layer retrieval contract requires.

## Totals

- **19 manifest entries**, **72 chunks** live in `document_chunks`.
- Layer 1 (shared legislation): 44 chunks · Layer 2 (client SOPs): 28 chunks.

## Re-ingest

```bash
# Shared legislation (canonical entrypoint, delegates to the Node pipeline):
DB_CONNECTION_STRING=… python3 MISE/backend/knowledge/ingest-legislation.py
# equivalently:           node scripts/ingest-legislation.js
# Client SOPs (inline, two-layer):  node scripts/ingest-sops.js <clientId>
# Demo SOPs  (file, four-layer):     node scripts/ingest-demo-sops.js <pinnacleClientId>
```
