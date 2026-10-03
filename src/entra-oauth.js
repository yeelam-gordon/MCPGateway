import { PublicClientApplication, ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import { readFile } from 'node:fs/promises';
import { createPrivateKey } from 'node:crypto';
import { GatewayError } from './errors.js';
import { safeOAuthUrl } from './config-schema.js';
import { OAUTH_PROTOCOL_HEADERS } from './oauth-client-auth.js';
import { boundMicrosoftScopes } from './microsoft-resource-binding.js';
import { requiredMicrosoftScopes } from './microsoft-resource-scopes.js';

const host = 'login.microsoftonline.com';
const tenantPattern = /^(organizations|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;

export function microsoftAuthority(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== host) return undefined;
  safeOAuthUrl(value, true);
  const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (url.hostname !== host || url.port || url.search || parts.length !== 2 ||
      parts[1] !== 'v2.0' || !tenantPattern.test(parts[0])) return undefined;
  return `https://${host}/${parts[0]}`;
}

export function validateMicrosoftDiscovery(discovery) {
  const authority = microsoftAuthority(discovery.authorizationServerUrl);
  if (!authority) throw new GatewayError('oauth_invalid_issuer', 'Entra requires a verified Microsoft organizations or tenant v2.0 authority');
  const metadata = discovery.authorizationServerMetadata;
  const tenant = new URL(authority).pathname.slice(1);
  const issuer = metadata?.issuer;
  const expectedIssuer = `${authority}/v2.0`;
  if (issuer !== expectedIssuer &&
      !(tenant === 'organizations' && issuer === `https://${host}/{tenantid}/v2.0`)) {
    throw new GatewayError('oauth_invalid_issuer', 'Entra discovery issuer does not match the advertised Microsoft authority');
  }
  for (const [key, suffix] of [['authorization_endpoint', 'authorize'], ['token_endpoint', 'token']]) {
    if (metadata?.[key] !== `${authority}/oauth2/v2.0/${suffix}`) {
      throw new GatewayError('oauth_invalid_issuer', 'Entra discovery endpoints do not match the advertised Microsoft authority');
    }
  }
  return authority;
}

export function entraClientId(config) {
  const id = config.oauth?.clientId ?? process.env.SHARED_MCP_ENTRA_CLIENT_ID;
  if (!id?.trim()) throw new GatewayError('entra_publisher_registration_required',
    'Gateway publisher application registration is missing. The publisher/deployment must provision a public Entra application and consent, then supply SHARED_MCP_ENTRA_CLIENT_ID once for the gateway or oauth.clientId. Users do not need to enter a tenant or register their own application.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new GatewayError('entra_invalid_client_id', 'Entra requires a publisher/deployment public application client ID (UUID)');
  }
  return id;
}

export function entraServiceAuthority(config, discovery) {
  const advertised = validateMicrosoftDiscovery(discovery);
  const configured = config.oauth?.authority;
  const authority = configured ? microsoftAuthority(`${configured.replace(/\/$/, '')}/v2.0`) : advertised;
  if (!authority || new URL(authority).pathname === '/organizations') {
    throw new GatewayError('entra_tenant_authority_required',
      'Entra app-only requires oauth.authority with an explicit tenant-specific Microsoft authority (without /v2.0); organizations cannot issue service tokens');
  }
  if (advertised !== authority && new URL(advertised).pathname !== '/organizations') {
    throw new GatewayError('oauth_invalid_issuer', 'Configured app-only tenant authority must match the resource-advertised tenant authority');
  }
  if (!discovery.resourceMetadata?.authorization_servers?.includes(discovery.authorizationServerUrl)) {
    throw new GatewayError('oauth_invalid_issuer', 'App-only authority must be advertised by verified protected-resource metadata');
  }
  if (config.oauth.issuer && config.oauth.issuer !== discovery.authorizationServerUrl) {
    throw new GatewayError('oauth_invalid_issuer', 'Configured issuer must match the resource-advertised authority');
  }
  return authority;
}

export class EntraOAuth {
  constructor(provider, discovery, scope, fetchFn) {
    this.provider = provider;
    this.serviceAccount = provider.serviceAccount;
    if (provider.confidential && !this.serviceAccount) {
      throw new GatewayError('oauth_unsupported_flow', 'Entra confidential clients support client_credentials only; use a public registration for delegated sign-in');
    }
    this.authority = this.serviceAccount ? entraServiceAuthority(provider.config, discovery) : validateMicrosoftDiscovery(discovery);
    if (this.serviceAccount && discovery.authorizationServerMetadata?.grant_types_supported &&
        !discovery.authorizationServerMetadata.grant_types_supported.includes('client_credentials')) {
      throw new GatewayError('oauth_unsupported_flow', 'Microsoft discovery does not advertise client_credentials');
    }
    if (this.serviceAccount && discovery.authorizationServerMetadata?.token_endpoint_auth_methods_supported &&
        !discovery.authorizationServerMetadata.token_endpoint_auth_methods_supported.includes(provider.config.oauth.tokenEndpointAuthMethod)) {
      throw new GatewayError('oauth_client_auth_method', 'Microsoft discovery does not advertise the configured client authentication method');
    }
    Object.assign(this, boundMicrosoftScopes(provider, discovery, scope));
    this.clientId = entraClientId(provider.config);
    this.advertisedScopes = discovery.resourceMetadata?.scopes_supported ?? [];
    if (this.serviceAccount && (this.scopes.length !== 1 || !this.scopes[0].endsWith('/.default'))) {
      throw new GatewayError('entra_invalid_scope', 'Entra app-only requires one explicit API /.default scope and application permissions/admin consent; delegated scopes are not converted');
    }
    this.binding = JSON.stringify([provider.path, this.clientId, this.authority, discovery.resourceMetadata?.resource, this.trustedResource, this.scopes,
      ...(this.serviceAccount ? ['client_credentials'] : [])]);
    const send = async (url, options, method) => {
      const target = safeOAuthUrl(url, true);
      if (target.hostname !== host || target.port) throw new GatewayError('oauth_invalid_issuer', 'MSAL network target is not the supported Microsoft cloud');
      const endpoint = `${target.origin}${target.pathname}`;
      if (method === 'POST' && endpoint !== `${this.authority}/oauth2/v2.0/token` &&
          !(!this.serviceAccount && endpoint === `${this.authority}/oauth2/v2.0/devicecode`)) {
        throw new GatewayError('oauth_invalid_issuer', 'MSAL credentials may only be sent to the verified authority endpoint');
      }
      provider.options.signal?.throwIfAborted();
      const response = await fetchFn(target, { method, headers: options?.headers, body: options?.body,
        [OAUTH_PROTOCOL_HEADERS]: options?.headers });
      // Never propagate Microsoft's error body into CLI errors or logs.
      const body = await response.json();
      return { status: response.status, headers: Object.fromEntries(response.headers), body };
    };
    this.msalConfig = {
      auth: { clientId: this.clientId, authority: this.authority },
      system: { networkClient: {
        sendGetRequestAsync: (url, options) => send(url, options, 'GET'),
        sendPostRequestAsync: (url, options) => send(url, options, 'POST')
      }, loggerOptions: { loggerCallback: () => {}, piiLoggingEnabled: false } }
    };
    if (!this.serviceAccount) this.pca = new PublicClientApplication(this.msalConfig);
  }

  requiredScopes(name) { return requiredMicrosoftScopes(this.advertisedScopes, this.scopes, name); }

  async service(rejectedToken) {
    const provider = this.provider;
    if (provider.options.deviceCode) throw new GatewayError('oauth_unsupported_flow', 'Device authorization cannot be combined with client_credentials');
    if (provider.entraServiceFlight) {
      await provider.entraServiceFlight;
      return this.service(rejectedToken);
    }
    const operation = (async () => {
      const oauth = provider.config.oauth;
      let credential;
      if (oauth.tokenEndpointAuthMethod === 'client_secret_post') {
        const clientSecret = process.env[oauth.secretEnv];
        if (!clientSecret) throw new GatewayError('oauth_client_credentials_invalid', 'Entra secretEnv credential reference is unavailable');
        credential = { clientSecret };
      } else if (oauth.tokenEndpointAuthMethod === 'private_key_jwt') {
        try {
          const privateKey = await readFile(oauth.privateKeyPath, 'utf8');
          const key = createPrivateKey(privateKey);
          if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || key.asymmetricKeyType !== 'rsa' ||
              key.asymmetricKeyDetails.modulusLength < 2048) throw new Error('Invalid key');
          credential = { clientCertificate: { privateKey, thumbprintSha256: oauth.certificateThumbprintSha256 } };
        } catch {
          throw new GatewayError('oauth_client_credentials_invalid', 'Entra certificate requires an accessible RSA PKCS#8 private key of at least 2048 bits and registered SHA-256 certificate thumbprint');
        }
      } else {
        throw new GatewayError('oauth_client_auth_method', 'MSAL app-only requires client_secret_post or private_key_jwt certificate authentication; no method downgrade is permitted');
      }
      this.pca = new ConfidentialClientApplication({ ...this.msalConfig,
        auth: { ...this.msalConfig.auth, ...credential } });
      return this.operation(async saved => {
        const tokens = provider.tokens();
        if (saved && tokens?.access_token && tokens.access_token !== rejectedToken &&
            provider.expiresAt > Date.now() + 30_000) {
          return { accessToken: tokens.access_token, expiresOn: new Date(provider.expiresAt) };
        }
        return this.pca.acquireTokenByClientCredential({ scopes: this.scopes,
          skipCache: !saved || tokens?.access_token === rejectedToken || !(provider.expiresAt > Date.now() + 30_000) });
      });
    })();
    provider.entraServiceFlight = operation;
    try { return await operation; }
    finally { if (provider.entraServiceFlight === operation) provider.entraServiceFlight = undefined; }
  }

  async operation(action) {
    const provider = this.provider;
    return provider.withLock(async () => {
      if (!provider.options.interactive) {
        provider.saved = await provider.readState();
        provider.revision = provider.saved.revision;
      }
      const saved = provider.pendingEntra ?? provider.saved.entra;
      try {
        if (saved?.binding === this.binding) this.pca.getTokenCache().deserialize(saved.cache);
        const result = await action(saved?.binding === this.binding ? saved : undefined);
        provider.options.signal?.throwIfAborted();
        if (!result?.accessToken || (!this.serviceAccount && !result.account)) throw new GatewayError('auth_required', 'Entra sign-in did not return the required access token/account');
        if (!this.serviceAccount && saved?.authority === this.authority && saved?.trustedResource === this.trustedResource &&
            (saved.homeAccountId !== result.account.homeAccountId || saved.tenantId !== result.account.tenantId)) {
          throw new GatewayError('oauth_invalid_token', 'Microsoft scope consent must preserve the previously selected account and tenant');
        }
        if (this.serviceAccount && (!Number.isFinite(result.expiresOn?.getTime()) ||
            result.expiresOn.getTime() <= Date.now() + 30_000)) {
          throw new GatewayError('oauth_invalid_token', 'Entra service token requires a safe lifetime longer than 30 seconds');
        }
        const state = { binding: this.binding, authority: this.authority, trustedResource: this.trustedResource,
          scopes: this.scopes, cache: this.pca.getTokenCache().serialize(),
          ...(this.serviceAccount ? { scope: this.scopes.join(' ') } : { homeAccountId: result.account.homeAccountId, tenantId: result.account.tenantId }) };
        const tokens = { access_token: result.accessToken, token_type: 'Bearer',
          expires_in: Math.max(0, ((result.expiresOn?.getTime() ?? Date.now()) - Date.now()) / 1000) };
        if (provider.options.interactive) {
          await provider.saveTokens(tokens, false, result.expiresOn?.getTime());
          provider.pendingEntra = state;
        } else {
          provider.saved.entra = state;
          provider.saved.tokens = tokens;
          provider.saved.expiresAt = result.expiresOn?.getTime();
          await provider.persist();
        }
        return result;
      } catch (error) {
        if (provider.options.signal?.aborted) throw new GatewayError('oauth_cancelled', 'Entra acquisition cancelled or timed out');
        if (error instanceof GatewayError) throw error;
        if (this.serviceAccount) throw new GatewayError('oauth_service_auth_failed', 'Entra app-only acquisition failed; check tenant registration, credential reference, API application permissions and admin consent');
        throw new GatewayError('auth_required', 'Entra sign-in or refresh failed; run the explicit authenticate-backend helper and check publisher registration and consent');
      }
    });
  }

  async silent(rejectedToken) {
    return this.operation(async saved => {
      const account = (await this.pca.getTokenCache().getAllAccounts()).find(account =>
        account.homeAccountId === saved?.homeAccountId && account.tenantId === saved?.tenantId);
      if (!account) throw new GatewayError('auth_required', 'Entra requires explicit sign-in with the authenticate-backend helper');
      return this.pca.acquireTokenSilent({ account, scopes: this.scopes,
        forceRefresh: this.provider.saved.tokens?.access_token === rejectedToken });
    });
  }

  async authorize() {
    const pkce = await new CryptoProvider().generatePkceCodes();
    this.provider.saveCodeVerifier(pkce.verifier);
    let url;
    try {
      url = await this.pca.getAuthCodeUrl({ scopes: this.scopes, redirectUri: this.provider.redirectUrl,
        state: this.provider.state(), codeChallenge: pkce.challenge, codeChallengeMethod: 'S256' });
    } catch {
      throw new GatewayError('entra_discovery_failed', 'MSAL authority discovery failed; verify the advertised Microsoft authority and network access');
    }
    await this.provider.redirectToAuthorization(new URL(url));
  }

  async finish(code) {
    return this.operation(() => this.pca.acquireTokenByCode({ code, scopes: this.scopes,
      redirectUri: this.provider.redirectUrl, codeVerifier: this.provider.codeVerifier() }));
  }

  async deviceCode() {
    const provider = this.provider;
    if (!provider.options.interactive) throw new GatewayError('auth_required', 'Device-code sign-in requires the explicit authenticate-backend helper');
    return this.operation(async () => {
      const signal = provider.options.signal;
      signal?.throwIfAborted();
      let rejectCancelled;
      const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
      const request = {
        scopes: this.scopes,
        timeout: Math.max(1, Math.ceil(((provider.options.deadline ?? Date.now() + 180_000) - Date.now()) / 1000)),
        cancel: false,
        deviceCodeCallback: response => {
          const url = safeOAuthUrl(response.verificationUri, true);
          if (!['microsoft.com', 'login.microsoftonline.com'].includes(url.hostname) || url.port ||
              !/^[a-z0-9-]{4,32}$/i.test(response.userCode) ||
              !Number.isInteger(response.interval) || response.interval < 1 || response.interval > 30 ||
              !Number.isFinite(response.expiresIn) || response.expiresIn <= 0) {
            throw new GatewayError('entra_invalid_device_code', 'Microsoft device-code response contains an unsupported verification URL, user code or polling interval');
          }
          const prompt = { verificationUri: url.href, userCode: response.userCode };
          if (provider.options.onDeviceCode) provider.options.onDeviceCode(prompt);
          else console.log(`Open ${prompt.verificationUri} and enter code ${prompt.userCode}.`);
        }
      };
      const cancel = () => {
        request.cancel = true;
        rejectCancelled(new GatewayError('oauth_cancelled', 'Entra device-code sign-in cancelled or timed out'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        // MSAL observes cancel between polls. A cancelled attempt only mutates its
        // isolated in-memory PCA; racing it prevents any private-cache publication.
        return await Promise.race([this.pca.acquireTokenByDeviceCode(request), cancelled]);
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
    });
  }
}
