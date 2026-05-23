// Credential hashing for the staff PIN/password. Uses Node's built-in scrypt
// (no native dependency) with a per-credential random salt. The stored value is
// self-describing so parameters can evolve without a migration:
//
//   scrypt$<N>$<r>$<p>$<salt_b64>$<hash_b64>
//
// Verification is constant-time (timingSafeEqual) to avoid leaking match length.

import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt);

const N = 16384; // CPU/memory cost
const r = 8;
const p = 1;
const KEYLEN = 64;

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const derived = await scrypt(plain, salt, KEYLEN, { N, r, p });
  return [
    'scrypt',
    N,
    r,
    p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scrypt(plain, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  // Lengths always match here, but guard anyway: timingSafeEqual throws on mismatch.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
