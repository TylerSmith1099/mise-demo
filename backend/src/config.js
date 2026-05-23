// Centralised, validated configuration. Every secret comes from the environment
// and is NEVER logged or returned in a response. This module fails fast at boot
// if anything required is missing or nonsensical, so a misconfigured deployment
// cannot silently fall back to an insecure default.
//
// SELF-HOSTED AUTH — AU DATA RESIDENCY (MIS-75, non-negotiable):
// Mise's authentication/identity layer (JWT issuance, session management, the
// role permission map — all of backend/auth + this module) is fully self-hosted
// in our own code and Postgres. It has NO dependency on any third-party auth
// SaaS (Auth0, Clerk, Firebase Auth, Cognito, etc.), all of which default to
// US/global hosting and would breach the Privacy Act 2024-25 reforms and our
// AU-data-residency requirement. Do NOT introduce one.
// This layer — and the staff/session data it reads and writes — MUST be deployed
// only on AWS ap-southeast-2 (Sydney). No staff or session data leaves Australia.

const MVP_ROLE_TIERS = Object.freeze([4, 5, 7]); // tiers 1–3 and 6 are post-demo

function required(name) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function intInRange(name, { min, max }) {
  const raw = required(name);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

// PEM material may be supplied directly or base64-encoded (handy for single-line
// env vars / secret managers). Detect base64 by the absence of a PEM header.
function decodePem(raw) {
  if (raw.includes('-----BEGIN')) return raw;
  return Buffer.from(raw, 'base64').toString('utf8');
}

export function loadConfig(env = process.env) {
  const prev = process.env;
  process.env = env; // allow callers (tests) to pass an isolated env object
  try {
    const algorithm = required('JWT_ALGORITHM');
    if (!['HS256', 'RS256'].includes(algorithm)) {
      throw new Error('JWT_ALGORITHM must be HS256 or RS256');
    }

    // Key material depends on the algorithm. RS256 is preferred (asymmetric:
    // the validator never holds a signing key); HS256 is the permitted minimum.
    let signingKey;
    let verifyingKey;
    if (algorithm === 'RS256') {
      signingKey = decodePem(required('JWT_PRIVATE_KEY'));
      verifyingKey = decodePem(required('JWT_PUBLIC_KEY'));
    } else {
      signingKey = required('JWT_SECRET');
      verifyingKey = signingKey;
    }

    return Object.freeze({
      jwt: Object.freeze({
        algorithm,
        signingKey,
        verifyingKey,
        issuer: process.env.JWT_ISSUER || 'mise',
        audience: process.env.JWT_AUDIENCE || 'mise-app',
        expirySeconds: intInRange('SESSION_EXPIRY_HOURS', { min: 1, max: 24 }) * 3600,
      }),
      session: Object.freeze({
        inactivityTimeoutSeconds:
          intInRange('SESSION_TIMEOUT_MINUTES', { min: 1, max: 720 }) * 60,
      }),
      db: Object.freeze({
        connectionString: required('DB_CONNECTION_STRING'),
        // The least-privilege, FORCE-RLS-subject role the app assumes per txn.
        appRole: process.env.DB_APP_ROLE || 'mise_app',
      }),
      // Claude answer-synthesis (MIS-42). All fields are OPTIONAL: the synthesis
      // layer is feature-flagged on config so a deployment without a key still
      // boots and serves answers via the deterministic fallback. The key is an
      // operator/board-provisioned secret — never hardcoded, never logged.
      //
      // AU DATA RESIDENCY (non-negotiable): synthesis is enabled only when an
      // explicit AU-resident endpoint (ANTHROPIC_BASE_URL — e.g. AWS Bedrock in
      // ap-southeast-2 or an AU-region gateway) is configured. We do NOT fall
      // back to the default global endpoint, so a missing base URL fails closed
      // to the local deterministic compose rather than sending venue questions
      // offshore.
      anthropic: Object.freeze({
        apiKey: process.env.ANTHROPIC_API_KEY || null,
        baseUrl: process.env.ANTHROPIC_BASE_URL || null,
        model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-7',
        maxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 1024),
        // Live only with BOTH a key and an explicit AU endpoint.
        enabled: Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_BASE_URL),
      }),
      mvpRoleTiers: MVP_ROLE_TIERS,
      port: Number(process.env.PORT || 3000),
    });
  } finally {
    process.env = prev;
  }
}

export { MVP_ROLE_TIERS };
