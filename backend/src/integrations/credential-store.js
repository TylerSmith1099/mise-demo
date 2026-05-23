/**
 * Per-client encrypted credential store.
 *
 * Encryption model: AES-256-GCM.
 *   Key source: MISE_CREDENTIAL_ENCRYPTION_KEY env var (hex-encoded 32 bytes).
 *   The key NEVER enters the database. Only IV + auth_tag + ciphertext are stored.
 *   A database dump without the env key is useless.
 *
 * Rules:
 *   - No plaintext secret ever passed to console.log, process.env, or Postgres
 *     outside of the encrypted envelope columns.
 *   - Access tokens are short-lived; refresh tokens are encrypted separately.
 *   - Old tokens are superseded (superseded_at set), never deleted.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { withClientContext } from '../db.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

let _encryptionKey = null; // cached Buffer — loaded once

function getEncryptionKey() {
  if (_encryptionKey) return _encryptionKey;
  const hex = process.env.MISE_CREDENTIAL_ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    throw new Error(
      'MISE_CREDENTIAL_ENCRYPTION_KEY must be set to a hex-encoded 32-byte key. ' +
      'Generate with: openssl rand -hex 32'
    );
  }
  _encryptionKey = Buffer.from(hex, 'hex');
  if (_encryptionKey.length !== 32) {
    throw new Error('MISE_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return _encryptionKey;
}

/**
 * Encrypt a plaintext secret string.
 * Returns an envelope object suitable for storing in integration_credentials.
 * @param {string} plaintext
 * @returns {{ encAlgorithm: string, encIv: string, encAuthTag: string, encCiphertext: string }}
 */
export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptSecret: plaintext must be a non-empty string');
  }
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encAlgorithm: ALGORITHM,
    encIv:        iv.toString('hex'),
    encAuthTag:   authTag.toString('hex'),
    encCiphertext: ciphertext.toString('hex'),
  };
}

/**
 * Decrypt an envelope previously produced by encryptSecret.
 * @param {{ encAlgorithm: string, encIv: string, encAuthTag: string, encCiphertext: string }} envelope
 * @returns {string} plaintext
 */
export function decryptSecret(envelope) {
  const { encAlgorithm, encIv, encAuthTag, encCiphertext } = envelope;
  if (!encAlgorithm || !encIv || !encAuthTag || !encCiphertext) {
    throw new Error('decryptSecret: incomplete envelope — all enc_* fields required');
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(encIv, 'hex');
  const authTag = Buffer.from(encAuthTag, 'hex');
  const ciphertext = Buffer.from(encCiphertext, 'hex');
  const decipher = createDecipheriv(encAlgorithm, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

/**
 * Store a credential for a connection.
 * The plaintext secret is encrypted before any DB call.
 * @param {{ connectionId, clientId, credentialType, plaintext, expiresAt? }} opts
 * @returns {Promise<string>} new credential id
 */
export async function storeCredential({ connectionId, clientId, credentialType, plaintext, expiresAt = null }) {
  const envelope = encryptSecret(plaintext);
  return withClientContext(clientId, async (q) => {
    const result = await q(
      `INSERT INTO integration_credentials
         (connection_id, client_id, credential_type,
          enc_algorithm, enc_iv, enc_auth_tag, enc_ciphertext, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        connectionId, clientId, credentialType,
        envelope.encAlgorithm, envelope.encIv, envelope.encAuthTag, envelope.encCiphertext,
        expiresAt,
      ]
    );
    return result.rows[0].id;
  });
}

/**
 * Fetch and decrypt the current (non-superseded, non-expired) credential of a
 * given type for a connection.
 * Returns null if none found.
 * @param {{ connectionId, clientId, credentialType }} opts
 * @returns {Promise<string|null>} plaintext secret or null
 */
export async function getCredential({ connectionId, clientId, credentialType }) {
  return withClientContext(clientId, async (q) => {
    const result = await q(
      `SELECT enc_algorithm, enc_iv, enc_auth_tag, enc_ciphertext
         FROM integration_credentials
        WHERE connection_id = $1
          AND client_id = $2
          AND credential_type = $3
          AND superseded_at IS NULL
          AND is_expired = false
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at DESC
        LIMIT 1`,
      [connectionId, clientId, credentialType]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return decryptSecret({
      encAlgorithm:  row.enc_algorithm,
      encIv:         row.enc_iv,
      encAuthTag:    row.enc_auth_tag,
      encCiphertext: row.enc_ciphertext,
    });
  });
}

/**
 * Rotate: supersede all current credentials of a type, then store the new one.
 * @param {{ connectionId, clientId, credentialType, plaintext, expiresAt? }} opts
 * @returns {Promise<string>} new credential id
 */
export async function rotateCredential({ connectionId, clientId, credentialType, plaintext, expiresAt = null }) {
  const envelope = encryptSecret(plaintext);
  return withClientContext(clientId, async (q) => {
    // Supersede current credentials
    await q(
      `UPDATE integration_credentials
          SET superseded_at = NOW()
        WHERE connection_id = $1
          AND client_id = $2
          AND credential_type = $3
          AND superseded_at IS NULL`,
      [connectionId, clientId, credentialType]
    );
    // Insert new
    const result = await q(
      `INSERT INTO integration_credentials
         (connection_id, client_id, credential_type,
          enc_algorithm, enc_iv, enc_auth_tag, enc_ciphertext, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        connectionId, clientId, credentialType,
        envelope.encAlgorithm, envelope.encIv, envelope.encAuthTag, envelope.encCiphertext,
        expiresAt,
      ]
    );
    return result.rows[0].id;
  });
}
