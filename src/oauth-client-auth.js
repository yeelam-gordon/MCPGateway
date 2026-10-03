import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { constants, createPrivateKey, sign } from 'node:crypto';
import { ClientCredentialsProvider, createPrivateKeyJwtAuth } from '@modelcontextprotocol/sdk/client/auth-extensions.js';
import { fetchToken, selectResourceURL } from '@modelcontextprotocol/sdk/client/auth.js';
import { GatewayError } from './errors.js';
import { safeOAuthUrl } from './config-schema.js';
import { validateAccessToken } from './oauth-access-token.js';

const failure = () => new GatewayError('oauth_client_credentials_invalid',
  'Registered OAuth credentials are unavailable or invalid; check the selected secretEnv or absolute PKCS#8 privateKeyPath and registration');

export const VERIFIED_DEVICE_AUTH_ENDPOINT = Symbol('verified-device-auth-endpoint');
export const OAUTH_PROTOCOL_HEADERS = Symbol('oauth-protocol-headers');

export function validateClientDiscovery(config, discovery) {
  const oauth = config.oauth;
  const metadata = discovery.authorizationServerMetadata;
  if (new URL(oauth.issuer).href !== new URL(discovery.authorizationServerUrl).href ||
      !metadata?.issuer || new URL(metadata.issuer).href !== new URL(oauth.issuer).href) {
    throw new GatewayError('oauth_invalid_issuer', 'Confidential OAuth discovery must match the explicitly configured issuer');
  }
  if (!metadata.token_endpoint) throw new GatewayError('oauth_invalid_issuer', 'Confidential OAuth requires a discovered token endpoint');
  safeOAuthUrl(metadata.token_endpoint);
  if (!metadata.token_endpoint_auth_methods_supported?.includes(oauth.tokenEndpointAuthMethod)) {
    throw new GatewayError('oauth_client_auth_method', 'Authorization server does not advertise the configured client authentication method; no downgrade is permitted');
  }
  if (oauth.tokenEndpointAuthMethod === 'private_key_jwt' &&
      metadata.token_endpoint_auth_signing_alg_values_supported &&
      !metadata.token_endpoint_auth_signing_alg_values_supported.includes(oauth.alg)) {
    throw new GatewayError('oauth_client_auth_method', 'Authorization server does not advertise the configured assertion algorithm; no downgrade is permitted');
  }
}

export async function addRegisteredClientAuthentication(provider, headers, params, url, metadata, device = false) {
  const oauth = provider.config.oauth;
  validateClientDiscovery(provider.config, provider.saved.discovery);
  const endpoint = device ? 'device_authorization_endpoint' : 'token_endpoint';
  if (url.href !== metadata?.[endpoint] || url.href !== provider.saved.discovery.authorizationServerMetadata[endpoint]) {
    throw new GatewayError('oauth_invalid_issuer', 'Client credentials may only be sent to the verified token endpoint');
  }
  params.set('client_id', oauth.clientId);
  if (oauth.tokenEndpointAuthMethod !== 'private_key_jwt') {
    const secret = process.env[oauth.secretEnv];
    if (!secret) throw failure();
    if (oauth.tokenEndpointAuthMethod === 'client_secret_post') params.set('client_secret', secret);
    else {
      const encode = value => new URLSearchParams({ v: value }).toString().slice(2);
      headers.set('Authorization', `Basic ${Buffer.from(`${encode(oauth.clientId)}:${encode(secret)}`).toString('base64')}`);
    }
    return;
  }
  try {
    if (!isAbsolute(oauth.privateKeyPath)) throw failure();
    const pem = await readFile(oauth.privateKeyPath, 'utf8');
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048 ||
        !pem.includes('-----BEGIN PRIVATE KEY-----')) throw failure();
    await createPrivateKeyJwtAuth({ issuer: oauth.clientId, subject: oauth.clientId,
      privateKey: pem, alg: oauth.alg, audience: url.href, lifetimeSeconds: 60 })(headers, params, url, metadata);
    // SDK 1.30 omits kid. Retain its claims and explicitly sign the registered
    // header with Node crypto rather than sending an assertion without key identity.
    const payload = params.get('client_assertion').split('.')[1];
    const header = Buffer.from(JSON.stringify({ alg: oauth.alg, typ: 'JWT', kid: oauth.kid })).toString('base64url');
    const input = `${header}.${payload}`;
    const signature = sign('sha256', Buffer.from(input), { key,
      padding: oauth.alg === 'PS256' ? constants.RSA_PKCS1_PSS_PADDING : constants.RSA_PKCS1_PADDING,
      ...(oauth.alg === 'PS256' ? { saltLength: 32 } : {}) });
    params.set('client_assertion', `${input}.${signature.toString('base64url')}`);
  } catch {
    throw failure();
  }
}

export async function acquireServiceTokens(provider, discovery, scope, fetchFn, rejectedToken) {
  validateClientDiscovery(provider.config, discovery);
  const resource = await selectResourceURL(provider.config.url, provider, discovery.resourceMetadata);
  const resolvedScope = scope || discovery.resourceMetadata?.scopes_supported?.join(' ') || provider.config.oauth.scopes?.join(' ');
  if (!resolvedScope) throw new GatewayError('oauth_invalid_scope', 'Service accounts require explicit resource/challenge or configured API scopes');
  const binding = JSON.stringify([provider.config.oauth.clientId, discovery.authorizationServerUrl,
    discovery.authorizationServerMetadata.token_endpoint, resource.href, resolvedScope]);
  if (provider.serviceFlight) {
    await provider.serviceFlight;
    return acquireServiceTokens(provider, discovery, scope, fetchFn, rejectedToken);
  }
  const operation = provider.withLock(async () => {
    if (!provider.options.interactive) {
      provider.saved = await provider.readState();
      provider.revision = provider.saved.revision;
    }
    if ((provider.pendingService ?? provider.saved.service)?.binding === binding && provider.tokens()?.access_token &&
        Number.isSafeInteger(provider.expiresAt) && provider.expiresAt > Date.now() + 30_000 &&
        provider.tokens().access_token !== rejectedToken) return;
    const sdk = new ClientCredentialsProvider({ clientId: provider.config.oauth.clientId,
      clientSecret: '', scope: resolvedScope });
    sdk.addClientAuthentication = provider.addClientAuthentication;
    try {
      let acquiredExpiry;
      const tokens = await fetchToken(sdk, discovery.authorizationServerUrl, {
        metadata: discovery.authorizationServerMetadata, resource, fetchFn: async (url, init) => {
          const response = await fetchFn(url, init);
          const acquisition = await provider.captureTokenResponse(response);
          if (acquisition) acquiredExpiry = acquisition.expiresAt;
          return response;
        } });
      validateAccessToken(tokens.access_token);
      if (!tokens.access_token || tokens.token_type.toLowerCase() !== 'bearer' ||
          !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 30 ||
          !Number.isSafeInteger(Math.ceil(Date.now() + tokens.expires_in * 1000))) {
        throw new GatewayError('oauth_invalid_token', 'Service token requires a non-empty Bearer credential and a safe lifetime longer than 30 seconds');
      }
      const { refresh_token, ...access } = tokens;
      await provider.saveTokens(access, false, acquiredExpiry, { binding, scope: resolvedScope });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError('oauth_service_auth_failed', 'Service-account token acquisition failed; check registered credentials, API scope and app-only consent');
    }
  });
  provider.serviceFlight = operation;
  try { await operation; }
  finally { if (provider.serviceFlight === operation) provider.serviceFlight = undefined; }
}
