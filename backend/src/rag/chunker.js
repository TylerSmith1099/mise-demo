// Chunking: turn a document into self-contained, single-concept chunks split on
// logical/section boundaries, targeting 300–600 tokens.
//
// Two requirements from the brief pull against each other for short text:
// "one concept/clause per chunk" and "300–600 tokens". We resolve it in favour
// of CONCEPT BOUNDARIES, which is what matters for compliance retrieval — a
// malfunction question must not pull a chunk that also covers minors, hours and
// cash. So:
//   1. Split on section boundaries — Markdown headings (#..######). Each section
//      becomes one chunk carrying its heading as `section` metadata, so a chunk
//      is meaningful without its neighbours.
//   2. Split any section above the 600-token CEILING at sentence boundaries.
//   3. Only absorb a tiny stray fragment (a lone heading line, < MERGE_FLOOR
//      tokens) into the following section, rather than emit a contentless chunk.
//
// On full statute/award text (the deploy-stage input) sections naturally land in
// the 300–600 band; on the representative summaries shipped here a single
// legislative concept is often shorter, and that is intentional — better a tight
// 120-token "machine malfunction" chunk than a diluted 400-token grab-bag.
//
// Tokens are estimated (no model tokenizer offline): ~0.75 tokens per
// whitespace word is the usual English ratio, so tokens ≈ words / 0.75.

const MIN_TOKENS = 300;       // target floor (advisory on short summaries — see above)
const MAX_TOKENS = 600;       // hard ceiling — sections above this are split
const MERGE_FLOOR = 40;       // a fragment this small is folded into its neighbour

export function estimateTokens(text) {
  const words = (text.trim().match(/\S+/g) || []).length;
  return Math.ceil(words / 0.75);
}

// A heading is a Markdown ATX heading line. We keep the heading text (minus the
// leading #s) as the section label.
const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;

/**
 * Parse raw markdown/text into [{ section, text }] sections, splitting on
 * headings. Lines before the first heading attach to a "Preamble" section.
 */
function splitSections(raw) {
  const lines = raw.split(/\r?\n/);
  const sections = [];
  let current = { section: null, lines: [] };
  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      if (current.lines.join('').trim()) sections.push(current);
      current = { section: m[2].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('').trim()) sections.push(current);
  return sections.map((s) => ({ section: s.section, text: s.lines.join('\n').trim() }));
}

function splitSentences(text) {
  // Split after sentence-ending punctuation followed by whitespace.
  return text.split(/(?<=[.;:])\s+(?=[A-Z0-9(])/).filter((s) => s.trim());
}

// Break an over-long section into <= MAX_TOKENS pieces at sentence boundaries.
function splitLargeSection(section, text) {
  const sentences = splitSentences(text);
  const out = [];
  let buf = [];
  let bufTokens = 0;
  for (const sentence of sentences) {
    const t = estimateTokens(sentence);
    if (bufTokens + t > MAX_TOKENS && buf.length) {
      out.push({ section, text: buf.join(' ').trim() });
      buf = [];
      bufTokens = 0;
    }
    buf.push(sentence);
    bufTokens += t;
  }
  if (buf.length) out.push({ section, text: buf.join(' ').trim() });
  return out;
}

/**
 * Chunk a document.
 * @param {string} raw   document text (markdown or plain).
 * @returns {{section: string|null, content: string, tokenCount: number}[]}
 */
export function chunkDocument(raw) {
  const sections = splitSections(raw);
  const pieces = [];

  // First pass: enforce the ceiling (split large sections).
  for (const s of sections) {
    if (estimateTokens(s.text) > MAX_TOKENS) {
      pieces.push(...splitLargeSection(s.section, s.text));
    } else {
      pieces.push({ section: s.section, text: s.text });
    }
  }

  // Second pass: keep one chunk per concept (section). Only fold a tiny stray
  // fragment (< MERGE_FLOOR tokens, e.g. a lone heading with no body) forward
  // into the next section so we never emit a near-empty chunk.
  const chunks = [];
  let carry = null; // a small fragment waiting to attach to the next piece
  for (const p of pieces) {
    let section = p.section;
    let text = p.text;
    if (carry) {
      section = carry.section ? `${carry.section} / ${section ?? ''}`.replace(/ \/ $/, '') : section;
      text = `${carry.text}\n\n${text}`.trim();
      carry = null;
    }
    if (estimateTokens(text) < MERGE_FLOOR) {
      carry = { section, text }; // too small alone — defer to next piece
      continue;
    }
    chunks.push({ section, content: text.trim(), tokenCount: estimateTokens(text) });
  }
  if (carry) {
    // Trailing fragment: attach to the last chunk, or stand alone if none.
    if (chunks.length) {
      const last = chunks[chunks.length - 1];
      last.content = `${last.content}\n\n${carry.text}`.trim();
      last.tokenCount = estimateTokens(last.content);
    } else {
      chunks.push({ section: carry.section, content: carry.text.trim(), tokenCount: estimateTokens(carry.text) });
    }
  }

  return chunks.filter((c) => c.content.length > 0);
}

export { MIN_TOKENS, MAX_TOKENS };
