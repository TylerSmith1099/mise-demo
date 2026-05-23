#!/usr/bin/env python3
"""MISE — legislation ingestion (PDF -> pgvector), content_type = "legislation".

Reads legislation PDFs from `Knowledge Base/Legislation/[State]/`, where the
state directory (QLD, NSW, ... or National) sets the chunk's `venue_state`
(National -> NULL, applies to every state). For each PDF:

    parse (PDF text) -> chunk (300–600 token, section-bounded, self-contained)
        -> embed (canonical AU-resident embedder) -> tag
        (content_type='legislation', venue_state) -> store (pgvector, supersede
        prior live rows) -> log.

Legislation is shared across all clients: client_id and venue_id are NULL. It is
loaded by this maintenance pipeline (table owner role), so tenants can never
inject it (schema.sql RLS WITH CHECK).

EMBEDDING — same divergence from the issue's "embeds via Claude API" as ingest.js,
and for the same reasons (no Anthropic embeddings endpoint; AU residency;
ingest/query must share ONE embedder or cosine search is meaningless). Crucially,
legislation chunks are searched by retrieve.js, so they MUST be embedded with the
EXACT same function the query side uses — the JS embedder in src/rag/embedding.js.
Re-implementing the hashing trick in Python risks byte-level drift, so this
script delegates the embed step to that JS embedder via a `node` subprocess,
guaranteeing identical vectors at ingest and query. No text leaves AU.

DATA RESIDENCY: the canonical embedder is fully offline (no network calls).
Deploy only to AWS ap-southeast-*.

DEPENDENCIES: pip install psycopg2-binary pypdf  (plus `node` on PATH)

USAGE:
    DB_CONNECTION_STRING=postgres://user:pass@host:5432/mise \
        python3 MISE/backend/knowledge/ingest-legislation.py \
            ["Knowledge Base/Legislation"]
"""

import hashlib
import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

MIN_TOKENS = 300
MAX_TOKENS = 600
EMBEDDING_DIM = 384  # contract with src/rag/embedding.js and schema.sql vector(384)
EMBEDDING_MODEL = "mise-local-hashing-v1"  # the canonical embedder's id

VALID_STATES = {"QLD", "NSW", "VIC", "SA", "WA", "TAS", "NT", "ACT"}
PROJECT_ROOT = Path(__file__).resolve().parents[3]
EMBEDDER_JS = PROJECT_ROOT / "src" / "rag" / "embedding.js"


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / 4)


def read_pdf(pdf_path: Path) -> str:
    """Extract clean text from a PDF, stripping page-number-only lines."""
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    pages = [(page.extract_text() or "") for page in reader.pages]
    text = "\n".join(pages)
    lines = [ln for ln in text.splitlines() if not re.fullmatch(r"\s*\d+\s*", ln)]
    return "\n".join(lines)


def chunk_document(text: str):
    """Split on headings / numbered clauses, pack into 300–600 token chunks."""
    heading_re = re.compile(r"^(#{1,6}\s+.*|(Part|Division|Section|s)?\s*\d+(\.\d+)*\s+\S.*)$")
    blocks, heading, body = [], None, []
    for line in text.splitlines():
        t = line.strip()
        if heading_re.match(t):
            if "".join(body).strip():
                blocks.append((heading, "\n".join(body)))
            heading, body = t.lstrip("#").strip(), []
        else:
            body.append(line)
    if "".join(body).strip() or heading:
        blocks.append((heading, "\n".join(body)))

    chunks, buf_heading, buf = [], None, ""
    for bh, btext in blocks:
        block = (f"{bh}\n{btext}" if bh else btext).strip()
        if not block:
            continue
        if buf_heading is None:
            buf_heading = bh
        combined = f"{buf}\n\n{block}" if buf else block
        if estimate_tokens(combined) > MAX_TOKENS and buf:
            chunks.append((buf_heading, buf.strip()))
            buf_heading, buf = bh, block
        else:
            buf = combined
        if estimate_tokens(buf) >= MIN_TOKENS:
            chunks.append((buf_heading, buf.strip()))
            buf_heading, buf = None, ""
    if buf.strip():
        chunks.append((buf_heading, buf.strip()))
    return chunks


# Inline ESM that embeds each line of stdin with the canonical JS embedder and
# prints one pgvector literal per line — guaranteeing ingest/query vectors match.
_EMBED_JS = (
    "import {{embed,toVectorLiteral,EMBEDDING_DIM}} from {mod!r};"
    "let raw='';process.stdin.setEncoding('utf8');"
    "process.stdin.on('data',c=>raw+=c).on('end',()=>{{"
    "const items=JSON.parse(raw);"
    "const out=items.map(t=>{{const v=embed(t);"
    "if(v.length!==EMBEDDING_DIM)throw new Error('dim '+v.length);"
    "return toVectorLiteral(v);}});"
    "process.stdout.write(JSON.stringify(out));}});"
)


def embed_literals(texts):
    """Embed a batch of texts to pgvector literals via the canonical JS embedder.

    One `node` subprocess for the whole batch; vectors are byte-identical to what
    retrieve.js produces for queries.
    """
    if not texts:
        return []
    node = __import__("shutil").which("node")
    if node is None:
        raise RuntimeError("node is required on PATH to run the canonical embedder")
    if not EMBEDDER_JS.is_file():
        raise RuntimeError(f"canonical embedder not found: {EMBEDDER_JS}")
    script = _EMBED_JS.format(mod=str(EMBEDDER_JS))
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        input=json.dumps(texts), text=True, capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"embedder failed: {proc.stderr.strip()}")
    literals = json.loads(proc.stdout)
    if len(literals) != len(texts):
        raise RuntimeError("embedder returned wrong count")
    return literals


def slugify(s: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def build_context(source: str, section) -> str:
    """One-sentence contextual-retrieval blurb (MIS-72), mirroring ingest.js
    buildContext for content_type='legislation'. Composed from metadata only —
    no chunk text leaves AU. Prepended to the chunk BEFORE embedding so section
    context is baked into the vector and the lexical index."""
    where = f"{source}, {section}," if section else source
    blurb = f"This excerpt from {where} sets out the statutory requirements in {source}."
    return re.sub(r"\s+", " ", blurb).strip()


def embed_text(context: str, content: str) -> str:
    """Text handed to the embedder: blurb + chunk (mirrors ingest.js embedText)."""
    return f"{context}\n\n{content}" if context else content


def append_manifest(entry: dict):
    path = PROJECT_ROOT / "Knowledge Base" / "manifest.json"
    manifest = {"ingested": []}
    if path.exists():
        manifest = json.loads(path.read_text())
    manifest.setdefault("ingested", [])
    entry["at"] = datetime.now(timezone.utc).isoformat()
    manifest["ingested"].append(entry)
    path.write_text(json.dumps(manifest, indent=2))


def ingest_pdf(cur, pdf_path: Path, venue_state):
    source = pdf_path.stem.replace("-", " ").title()
    text = read_pdf(pdf_path)
    chunks = chunk_document(text)
    slug = slugify(pdf_path.stem)

    # Supersede prior live rows for this source (audit-preserving, never delete).
    cur.execute(
        "UPDATE document_chunks SET superseded_at = now() "
        "WHERE source = %s AND superseded_at IS NULL",
        (source,),
    )
    contexts = [build_context(source, section) for section, _content in chunks]
    # Contextual retrieval: embed blurb + chunk (content_tsv is GENERATED from
    # context too in schema.sql), so the lexical and dense legs both see context.
    literals = embed_literals(
        [embed_text(ctx, content) for ctx, (_section, content) in zip(contexts, chunks)]
    )
    for i, ((section, content), context, embedding_literal) in enumerate(
        zip(chunks, contexts, literals), start=1
    ):
        cur.execute(
            """INSERT INTO document_chunks
                 (chunk_id, source, section, content, context, content_type, client_id,
                  venue_id, venue_state, last_updated, token_count, embedding)
               VALUES (%s,%s,%s,%s,%s,'legislation',NULL,NULL,%s,%s,%s,%s)
               ON CONFLICT (chunk_id) DO UPDATE SET
                 content = EXCLUDED.content, context = EXCLUDED.context,
                 embedding = EXCLUDED.embedding,
                 token_count = EXCLUDED.token_count, superseded_at = NULL""",
            (f"{slug}-{i:03d}", source, section, content, context, venue_state,
             datetime.now(timezone.utc).date(), estimate_tokens(content),
             embedding_literal),
        )
    append_manifest({
        "source": source, "content_type": "legislation", "venue_state": venue_state,
        "chunk_count": len(chunks), "file": pdf_path.name,
        "sha256": hashlib.sha256(text.encode()).hexdigest()[:12],
    })
    return source, len(chunks)


def main() -> int:
    if not os.environ.get("DB_CONNECTION_STRING"):
        print("DB_CONNECTION_STRING is required", file=sys.stderr)
        return 1

    import psycopg2

    base = Path(sys.argv[1]) if len(sys.argv) > 1 else PROJECT_ROOT / "Knowledge Base" / "Legislation"
    if not base.is_dir():
        print(f"legislation directory not found: {base}", file=sys.stderr)
        return 1

    conn = psycopg2.connect(os.environ["DB_CONNECTION_STRING"])
    total = 0
    try:
        with conn:
            with conn.cursor() as cur:
                for state_dir in sorted(p for p in base.iterdir() if p.is_dir()):
                    state = state_dir.name.upper()
                    venue_state = state if state in VALID_STATES else None  # National -> NULL
                    for pdf in sorted(state_dir.glob("*.pdf")):
                        source, n = ingest_pdf(cur, pdf, venue_state)
                        total += n
                        print(f"ingested {n:>3} chunks  [{venue_state or 'NATIONAL'}]  {source}")
    finally:
        conn.close()

    print(f"done — {total} legislation chunks ingested")
    return 0


if __name__ == "__main__":
    sys.exit(main())
