/**
 * Deputy OAuth 2.0 helpers.
 *
 * Deputy issues short-lived access tokens (1 hour) and long-lived refresh
 * tokens. Both are stored encrypted via the credential store.
 *
 * Australian venues use the *.au.deputy.com subdomain. The installName is the
 * per-venue Deputy subdomain slug (e.g. "myvenue" → myvenue.au.deputy.com).
 *
 * No token value is ever logged or returned as part of an error message.
 */

import { storeCredential, getCredential, rotateCredential } from './credential-store.js';

const DEPUTY_REGION = 'au';

/**
 * Base URL for a Deputy installation.
 * @param {string} installName
 * @returns {string}
 */
export function deputyBaseUrl(installName) {
  return `https://${installName}.${DEPUTY_REGION}.deputy.com`;
}

/**
 * Exchange the stored refresh token for a new access token.
 * Rotates the access token (and refresh token if Deputy issues a new one).
 *
 * Throws if no refresh_token is stored — caller must re-authorize via the
 * Deputy OAuth authorization code flow before syncing.
 *
 * @param {{ connectionId, clientId, installName, oauthClientId, oauthClientSecret, _fetchFn? }} opts
 * @returns {Promise<string>} new access token plaintext
 */
export async function refreshDeputyAccessToken({
  connectionId, clientId, installName, oauthClientId, oauthClientSecret, _fetchFn,
}) {
  const fetchFn = _fetchFn || fetch;

  const refreshToken = await getCredential({
    connectionId, clientId, credentialType: 'refresh_token',
  });
  if (!refreshToken) {
    throw new Error(
      'DeputyOAuth: no refresh_token stored — connection must be re-authorized via the Deputy OAuth flow',
    );
  }

  const tokenUrl = `${deputyBaseUrl(installName)}/oauth/access_token`;
  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     oauthClientId,
    client_secret: oauthClientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetchFn(tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });

  if (!res.ok) {
    // Do not include token values in the error
    throw new Error(`DeputyOAuth: token refresh failed with HTTP ${res.status}`);
  }

  const json = await res.json();
  const { access_token, refresh_token: newRefreshToken, expires_in } = json;

  if (!access_token) {
    throw new Error('DeputyOAuth: token endpoint response missing access_token field');
  }

  // expires_in is seconds — subtract 60s buffer so we refresh before actual expiry
  const expiresAt = typeof expires_in === 'number'
    ? new Date(Date.now() + (expires_in - 60) * 1000).toISOString()
    : null;

  await rotateCredential({
    connectionId, clientId,
    credentialType: 'access_token',
    plaintext:      access_token,
    expiresAt,
  });

  // Deputy may issue a new refresh token on each refresh — rotate if changed
  if (newRefreshToken && newRefreshToken !== refreshToken) {
    await rotateCredential({
      connectionId, clientId,
      credentialType: 'refresh_token',
      plaintext:      newRefreshToken,
    });
  }

  return access_token;
}

/**
 * Store the initial OAuth token pair after the authorization code exchange.
 * Called during connection setup, not during a regular sync.
 *
 * @param {{ connectionId, clientId, accessToken, expiresIn?, refreshToken? }} opts
 */
export async function storeDeputyTokens({
  connectionId, clientId, accessToken, expiresIn, refreshToken,
}) {
  const expiresAt = typeof expiresIn === 'number'
    ? new Date(Date.now() + (expiresIn - 60) * 1000).toISOString()
    : null;

  await storeCredential({
    connectionId, clientId,
    credentialType: 'access_token',
    plaintext:      accessToken,
    expiresAt,
  });

  if (refreshToken) {
    await storeCredential({
      connectionId, clientId,
      credentialType: 'refresh_token',
      plaintext:      refreshToken,
    });
  }
}
