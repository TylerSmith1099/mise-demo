// Persona layer — maps a caller's verified role tier to the product-agent system
// prompt that drives answer synthesis.
//
// The persona prompts are AUTHORED by the Product stack (canonical source:
// mise.ai/Agents/Product/*.md) and VENDORED into this repo at Agents/Product/ so
// the running service is self-contained and the exact prompt text is pinned and
// reviewable. We do not write or mutate the persona content here — we only select
// and load the right one for the caller.
//
// ISOLATION / TRUST: the tier is taken from req.auth.roleTier, which comes from
// the VERIFIED token only (see middleware.js). A role supplied in the request
// body is never honoured, so there is no path for a Tier 7 attendant to load the
// Duty Manager persona by asking for it.
//
// MVP scope (MIS-42 / MIS-26 Scenes 1–2): Tier 7 -> Gaming Attendant,
// Tier 5 -> Duty Manager. Other MVP tiers (e.g. 4) have no product persona yet;
// loadPersona returns null and the caller falls back to deterministic compose.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Repo-root/Agents/Product — the vendored persona prompts.
export const DEFAULT_PERSONA_DIR = join(__dirname, '..', 'Agents', 'Product');

// roleTier -> { file, label }. Keep this the single source of truth for the
// tier↔persona mapping so chat-api and tests agree.
export const PERSONA_BY_TIER = Object.freeze({
  7: { file: 'gaming-attendant-agent.md', label: 'Gaming Attendant' },
  5: { file: 'duty-manager-agent.md', label: 'Duty Manager' },
});

const cache = new Map(); // `${dir}:${tier}` -> { tier, label, systemPrompt }

/**
 * Load the persona system prompt for a verified role tier.
 * @param {number} roleTier  the caller's token role tier.
 * @param {object} [opts]
 * @param {string} [opts.personaDir]  override the persona directory (tests).
 * @returns {{tier:number,label:string,systemPrompt:string}|null} null when no
 *          persona is defined for the tier (caller should fall back).
 */
export function loadPersona(roleTier, { personaDir = DEFAULT_PERSONA_DIR } = {}) {
  const entry = PERSONA_BY_TIER[roleTier];
  if (!entry) return null;

  const key = `${personaDir}:${roleTier}`;
  if (cache.has(key)) return cache.get(key);

  const systemPrompt = readFileSync(join(personaDir, entry.file), 'utf8');
  const persona = Object.freeze({ tier: roleTier, label: entry.label, systemPrompt });
  cache.set(key, persona);
  return persona;
}
