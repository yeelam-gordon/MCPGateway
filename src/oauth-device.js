import { setTimeout as sleep } from 'node:timers/promises';
import { fetchToken, registerClient, selectResourceURL } from '@modelcontextprotocol/sdk/client/auth.js';
import { GatewayError } from './errors.js';
import { safeOAuthUrl } from './config-schema.js';
import { addRegisteredClientAuthentication, VERIFIED_DEVICE_AUTH_ENDPOINT } from './oauth-client-auth.js';

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export async function acquireDeviceTokens(provider, discovery, challengeScope, fetchFn) {
  const metadata = discovery.authorizationServerMetadata;
  if (!metadata?.device_authorization_endpoint || !metadata.token_endpoint ||
      (metadata.grant_types_supported && !metadata.grant_types_supported.includes(DEVICE_GRANT))) {
    throw new GatewayError('oauth_unsupported_flow', 'Authorization server does not advertise a supported device authorization flow');
  }
  const endpoint = safeOAuthUrl(metadata.device_authorization_endpoint);
  const resource = await selectResourceURL(provider.config.url, provider, discovery.resourceMetadata);
  const scope = challengeScope || discovery.resourceMetadata?.scopes_supported?.join(' ') || provider.clientMetadata.scope;
  let client = provider.clientInformation();
  if (!client) {
    if (provider.clientMetadataUrl && metadata.client_id_metadata_document_supported === true) {
      client = { client_id: provider.clientMetadataUrl };
    } else {
      client = await registerClient(discovery.authorizationServerUrl, { metadata,
        clientMetadata: { ...provider.clientMetadata, redirect_uris: [], grant_types: [DEVICE_GRANT, 'refresh_token'], response_types: [] },
        scope, fetchFn });
    }
    await provider.saveClientInformation(client);
  }
  const signal = provider.options.signal;
  const now = provider.options.deviceClock?.now ?? Date.now;
  const wait = provider.options.deviceClock?.sleep ?? ((ms, abortSignal) => sleep(ms, undefined, { signal: abortSignal }));
  const check = () => {
    signal?.throwIfAborted();
    if (now() >= provider.options.deadline) throw new GatewayError('oauth_cancelled', 'OAuth sign-in cancelled or timed out');
  };
  check();
  const params = new URLSearchParams({ client_id: client.client_id, resource: resource.href });
  if (scope) params.set('scope', scope);
  const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' });
  if (provider.confidential) await addRegisteredClientAuthentication(provider, headers, params, endpoint, metadata, true);
  const started = now();
  const response = await fetchFn(endpoint, { method: 'POST', headers, body: params, signal,
    [VERIFIED_DEVICE_AUTH_ENDPOINT]: endpoint.href });
  check();
  if (!response.ok) throw new GatewayError('oauth_device_failed', 'Device authorization initiation failed');
  let device;
  try {
    device = await response.json();
    if (!device || !['device_code', 'user_code', 'verification_uri'].every(key => typeof device[key] === 'string' && device[key].trim()) ||
        typeof device.expires_in !== 'number' || !Number.isSafeInteger(device.expires_in * 1000) || device.expires_in <= 0 ||
        (device.interval !== undefined && (typeof device.interval !== 'number' || !Number.isSafeInteger(device.interval * 1000) || device.interval <= 0))) throw new Error();
    safeOAuthUrl(device.verification_uri);
    if (device.verification_uri_complete !== undefined) safeOAuthUrl(device.verification_uri_complete);
  } catch {
    throw new GatewayError('oauth_device_invalid_response', 'Invalid device authorization response');
  }
  let interval = (device.interval ?? 5) * 1000;
  const expiry = Math.min(started + device.expires_in * 1000, provider.options.deadline);
  check();
  if (now() >= expiry) throw new GatewayError('oauth_device_expired', 'Device authorization expired before completion');
  const prompt = provider.options.onDeviceCode ?? (value => console.log(`Open this sign-in URL locally:\n${value.verification_uri}\nUser code: ${value.user_code}`));
  await prompt({ verification_uri: device.verification_uri, user_code: device.user_code });
  const sdkProvider = {
    clientMetadata: { scope },
    clientInformation: () => provider.clientInformation(),
    addClientAuthentication: provider.addClientAuthentication,
    prepareTokenRequest: () => new URLSearchParams({ grant_type: DEVICE_GRANT, device_code: device.device_code })
  };
  const flow = new AbortController();
  const combined = signal ? AbortSignal.any([signal, flow.signal]) : flow.signal;
  const timer = setTimeout(() => flow.abort(), Math.max(0, expiry - now()));
  try {
    for (;;) {
      check();
      if (now() + interval >= expiry) {
        await wait(Math.max(0, expiry - now()), combined);
        throw new GatewayError('oauth_device_expired', 'Device authorization expired before completion');
      }
      await wait(interval, combined);
      check();
      try {
        const tokens = await fetchToken(sdkProvider, discovery.authorizationServerUrl, { metadata, resource,
          fetchFn: async (url, init) => {
            const response = await fetchFn(url, { ...init, signal: combined });
            if (response.status === 400) {
              const body = await response.clone().json();
              if (['authorization_pending', 'slow_down'].includes(body?.error)) {
                await response.body?.cancel();
                throw new GatewayError(body.error, 'Device authorization is pending');
              }
            }
            return response;
          } });
        check();
        combined.throwIfAborted();
        if (now() >= expiry) throw new GatewayError('oauth_device_expired', 'Device authorization expired before completion');
        if (!tokens.access_token || tokens.token_type.toLowerCase() !== 'bearer') throw new GatewayError('oauth_invalid_token', 'Invalid device authorization token');
        provider.pendingDevice = { binding: JSON.stringify([metadata.issuer, client.client_id, resource.href, DEVICE_GRANT, scope]) };
        await provider.saveTokens(tokens, true);
        return;
      } catch (error) {
        check();
        combined.throwIfAborted();
        if (error.code === 'authorization_pending') continue;
        if (error.code === 'slow_down') { interval += 5000; continue; }
        if (error instanceof GatewayError) throw error;
        throw new GatewayError('oauth_device_failed', 'Device authorization denied, expired, or failed');
      }
    }
  } finally {
    clearTimeout(timer);
    flow.abort();
  }
}
