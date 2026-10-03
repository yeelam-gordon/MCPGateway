import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import { mkdir, open, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, selectResourceURL, discoverOAuthServerInfo, extractWWWAuthenticateParams } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthTokensSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { secureOwnerOnly } from './token.js';
import { GatewayError } from './errors.js';
import { safeOAuthUrl, validateBackendConfig } from './config-schema.js';
import { EntraOAuth, microsoftAuthority, validateMicrosoftDiscovery, entraServiceAuthority } from './entra-oauth.js';
import { addRegisteredClientAuthentication, acquireServiceTokens, validateClientDiscovery, VERIFIED_DEVICE_AUTH_ENDPOINT, OAUTH_PROTOCOL_HEADERS } from './oauth-client-auth.js';
import { acquireDeviceTokens, DEVICE_GRANT } from './oauth-device.js';
import { AzureCliCredential, resolveAzureCli } from './azure-cli-credential.js';
import { VSCodeCredential } from './vscode-credential.js';
import { selectedMicrosoftHostScope } from './microsoft-resource-scopes.js';
import { boundMicrosoftScopes, trustedMicrosoftResource, canonicalMicrosoftResource } from './microsoft-resource-binding.js';
import { validateAccessToken, validateTokenResponse } from './oauth-access-token.js';

export const HTTP_AUTH_REJECTED_BEFORE_EXECUTION = Symbol('http-auth-rejected-before-execution');
export const MICROSOFT_REQUIRED_SCOPE = Symbol('microsoft-required-scope');

async function resourceScopeHint(response) {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) return undefined;
      chunks.push(Buffer.from(value));
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return undefined; }
    const message = body?.error?.message ?? body?.message;
    return typeof message === 'string' ? message.match(
      /^Access denied: Scope '(McpServers(?:\.[A-Za-z][A-Za-z0-9]{0,63}){2,4})' is not present in the request\.$/
    )?.[1] : undefined;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export function hasStaticAuthorization(config) {
  return Object.keys(config.headers ?? {}).some(key => key.toLowerCase() === 'authorization');
}

export function oauthRequired(name, credentialProvider = false, scopes, resource) {
  const command = fileURLToPath(new URL('../tools/authenticate-backend.mjs', import.meta.url));
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const mode = credentialProvider === true ? 'azure-cli' : credentialProvider;
  const error = new GatewayError('auth_required', `Backend ${name} needs sign-in. Run node ${quote(command)} --server ${quote(name)} --config PATH --state-dir PATH${mode ? ` --${mode}` : ''}${resource ? ` --resource ${quote(resource)}` : ''}${scopes?.map(scope => ` --scope ${quote(scope)}`).join('') ?? ''}; use the gateway's config and state directory. Additional scopes require explicit consent; no tool is executed by this helper.`);
  if (scopes) error.requiredScopes = scopes;
  return error;
}

export function boundedOAuthFetch(signal, timeoutMs = 10_000, config) {
  return async (input, init = {}) => {
    const target = safeOAuthUrl(input instanceof Request ? input.url : String(input));
    const phase = config && target.href === new URL(config.url).href ? 'backend' :
      /\/(?:token|devicecode)$/.test(target.pathname) ? 'token' : 'discover';
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const notification = config && target.href === new URL(config.url).href &&
      method === 'GET' && headers.get('accept')?.trim().toLowerCase() === 'text/event-stream';
    if (config && target.href !== new URL(config.url).href) {
      const protocolHeaders = new Headers(init[OAUTH_PROTOCOL_HEADERS]);
      for (const key of Object.keys(config.headers ?? {})) {
        if (protocolHeaders.has(key)) headers.set(key, protocolHeaders.get(key));
        else headers.delete(key);
      }
      const params = init.body instanceof URLSearchParams ? init.body : undefined;
      const clientBasic = config.oauth?.tokenEndpointAuthMethod === 'client_secret_basic' &&
        method === 'POST' && params?.get('client_id') === config.oauth.clientId &&
        (['authorization_code', 'refresh_token', 'client_credentials', DEVICE_GRANT].includes(params?.get('grant_type')) ||
          init[VERIFIED_DEVICE_AUTH_ENDPOINT] === target.href) &&
        /^Basic /i.test(headers.get('authorization') ?? '');
      if (!clientBasic) headers.delete('authorization');
      headers.delete('mcp-session-id');
    }
    const connection = notification ? new AbortController() : undefined;
    const timer = connection ? setTimeout(() => connection.abort(new DOMException('Notification connection timed out', 'TimeoutError')), timeoutMs) : undefined;
    timer?.unref?.();
    const signals = [connection?.signal ?? AbortSignal.timeout(timeoutMs),
      init.signal ?? (input instanceof Request ? input.signal : undefined), signal].filter(Boolean);
    let response;
    try {
      response = await fetch(input, { ...init, headers, redirect: 'error', signal: AbortSignal.any(signals) });
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
    if (notification && response.ok && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/event-stream') {
      clearTimeout(timer);
    }
    // SDK error parsers include raw response bodies; never expose those bodies.
    if (!response.ok && ![400, 401, 403, 404, 405].includes(response.status)) {
      await response.body?.cancel();
      throw new GatewayError('oauth_http_error', `OAuth HTTP request failed (${response.status}; phase: ${phase})`);
    }

    if (!response.ok) {
      let errorBody = '{}';
      const requiredScope = response.status === 403 && phase === 'backend' && target.protocol === 'https:' &&
        !response.headers.has('www-authenticate') ? await resourceScopeHint(response) : undefined;
      if (response.status === 400) {
        const text = await response.text();
        let parsed;
        try { parsed = JSON.parse(text); }
        catch { throw new GatewayError('oauth_http_error', `OAuth HTTP request failed (400; invalid error response; phase: ${phase})`); }
        const allowed = ['invalid_grant', 'invalid_client', 'unauthorized_client', 'invalid_scope', 'access_denied', 'invalid_request', 'unsupported_grant_type', 'authorization_pending', 'slow_down', 'expired_token'];
        if (allowed.includes(parsed?.error)) errorBody = JSON.stringify({ error: parsed.error });
      }
      if (!response.bodyUsed) await response.body?.cancel();
      const errorHeaders = new Headers(response.headers);
      errorHeaders.delete('content-length');
      errorHeaders.delete('content-encoding');
      const sanitized = new Response(errorBody, { status: response.status, headers: errorHeaders });
      if (requiredScope) Object.defineProperty(sanitized, MICROSOFT_REQUIRED_SCOPE, { value: requiredScope });
      return sanitized;
    }
    return response;
  };
}

function requirePublicClient(client) {
  if (client && (Object.hasOwn(client, 'client_secret') ||
      (Object.hasOwn(client, 'token_endpoint_auth_method') && client.token_endpoint_auth_method !== 'none'))) {
    throw new GatewayError('oauth_confidential_client', 'Native OAuth supports public clients only; registration must omit client_secret and use token_endpoint_auth_method none or omit it');
  }
  return client;
}

export class BackendOAuthProvider {
  static async load(config, stateDir, options = {}) {
    const { name, ...settings } = config;
    validateBackendConfig(settings);
    safeOAuthUrl(config.url);
    const provider = new BackendOAuthProvider(config, stateDir, options);
    try {
      provider.saved = JSON.parse(await readFile(provider.path, 'utf8'));
      await secureOwnerOnly([{ path: provider.directory, directory: true }, { path: provider.path, directory: false }], options);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new GatewayError('oauth_storage_error', 'Cannot load private OAuth state');
    }
    provider.revision = provider.saved.revision;
    if (provider.saved.discovery) {
      try { await selectResourceURL(config.url, provider, provider.saved.discovery.resourceMetadata); }
      catch {
        await provider.invalidateCredentials('all');
        console.warn('Discarded OAuth discovery with invalid protected-resource binding; rediscovering.');
      }
    }
    if (provider.saved.discovery && microsoftAuthority(provider.saved.discovery.authorizationServerUrl)) {
      const entra = await provider.microsoftCredential(provider.saved.discovery, provider.serviceAccount ? provider.saved.entra?.scope : undefined, boundedOAuthFetch(options.signal, 10_000, config));
      if ((provider.vscode ? provider.saved.vscode : provider.azureCli ? provider.saved.azureCli : provider.saved.entra)?.binding !== entra.binding) delete provider.saved.tokens;
    }
    return provider;
  }

  constructor(config, stateDir, options) {
    this.config = structuredClone(config);
    this.options = options;
    this.directory = join(stateDir, 'oauth');
    const identity = JSON.stringify([config.name, new URL(config.url).href, config.oauth ?? {}]);
    this.path = join(this.directory, `${createHash('sha256').update(identity).digest('hex')}.json`);
    this.saved = {};
    this.context = new AsyncLocalStorage();
    this.lockContext = new AsyncLocalStorage();
    this.refresh = undefined;
    this.releaseLock = undefined;
    this.pendingTokens = undefined;
    this.pendingService = undefined;
    this.pendingExpiresAt = undefined;
    this.verifier = undefined;
    this.nonce = randomBytes(32).toString('base64url');
    this.clientMetadataUrl = config.oauth?.clientMetadataUrl;
    this.metadataExtensions = new Map();
    this.pendingOperations = new Set();
    this.confidential = config.oauth?.tokenEndpointAuthMethod && config.oauth.tokenEndpointAuthMethod !== 'none';
    if (this.confidential) this.addClientAuthentication = (...args) => addRegisteredClientAuthentication(this, ...args);
  }

  get serviceAccount() { return this.config.oauth?.grantType === 'client_credentials'; }
  get hostCredential() { return this.vscode ? 'vscode' : this.azureCli ? 'azure-cli' : false; }
  get vscode() {
    return !hasStaticAuthorization(this.config) && !this.config.oauth?.clientId &&
      !process.env.SHARED_MCP_ENTRA_CLIENT_ID?.trim() && !this.confidential && !this.serviceAccount &&
      (this.options.vscode || !this.options.azureCli && (this.config.oauth?.credentialProvider === 'vscode' ||
        !this.config.oauth?.credentialProvider && this.saved.vscode?.credentialProvider === 'vscode'));
  }
  get azureCli() {
    return !this.vscode && !hasStaticAuthorization(this.config) && !this.config.oauth?.clientId && !process.env.SHARED_MCP_ENTRA_CLIENT_ID?.trim() && !this.confidential &&
      !this.serviceAccount && (this.options.azureCli || this.config.oauth?.credentialProvider === 'azure-cli' ||
        this.saved.azureCli?.credentialProvider === 'azure-cli');
  }
  async microsoftCredential(discovery, scope, fetchFn) {
    boundMicrosoftScopes(this, discovery, scope);
    if (!this.hostCredential) return new EntraOAuth(this, discovery, scope, fetchFn);
    try { await selectResourceURL(this.config.url, this, discovery.resourceMetadata); }
    catch { throw new GatewayError('oauth_invalid_resource', 'Host protected-resource metadata does not match this backend'); }
    if (this.vscode) return new VSCodeCredential(this, discovery,
      selectedMicrosoftHostScope(discovery, scope, (this.pendingVSCode ?? this.saved.vscode)?.scopes, this));
    const launch = await (this.options.azureCliResolver ?? resolveAzureCli)();
    if (!launch) throw new GatewayError('azure_cli_unavailable', 'Install Microsoft Azure CLI and run the authenticate-backend helper with --azure-cli');
    return new AzureCliCredential(this, discovery,
      selectedMicrosoftHostScope(discovery, scope, (this.pendingAzureCli ?? this.saved.azureCli)?.scopes, this), launch);
  }
  get redirectUrl() { return this.serviceAccount ? undefined : `http://127.0.0.1:${this.config.oauth?.redirectPort ?? 7340}/oauth/callback`; }
  get clientMetadata() {
    return { client_name: 'Shared MCP Gateway', redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: this.config.oauth?.tokenEndpointAuthMethod ?? 'none', ...(this.config.oauth?.scopes ? { scope: this.config.oauth.scopes.join(' ') } : {}) };
  }
  state() { return this.nonce; }
  get generation() {
    const tokens = this.pendingTokens ?? this.saved.tokens;
    const service = this.pendingService ?? this.saved.service;
    return service ? JSON.stringify([tokens, service.binding]) : JSON.stringify(tokens);
  }
  get expiresAt() { return this.pendingTokens ? this.pendingExpiresAt : this.saved.expiresAt; }
  async acquireLock() {
    this.options.signal?.throwIfAborted();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await secureOwnerOnly([{ path: this.directory, directory: true }], this.options);
    const path = `${this.path}.lock`;
    const owner = randomBytes(32).toString('hex');
    const record = JSON.stringify({ pid: process.pid, owner });
    let file;
    try { file = await open(path, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new GatewayError('oauth_busy', 'OAuth credentials are in use by another sign-in or refresh; retry after it finishes. An interrupted owner lock requires explicit recovery.');
      throw new GatewayError('oauth_storage_error', 'Cannot acquire private OAuth credential lock');
    }
    try { await file.writeFile(record); }
    catch (error) { await file.close(); await unlink(path); throw error; }
    await file.close();
    return async () => {
      if (await readFile(path, 'utf8') !== record) throw new GatewayError('oauth_lock_changed', 'OAuth credential lock ownership changed');
      await unlink(path);
    };
  }
  async withLock(operation) {
    this.options.signal?.throwIfAborted();
    const pending = this.runLocked(operation);
    this.pendingOperations.add(pending);
    try { return await pending; }
    finally { this.pendingOperations.delete(pending); }
  }
  async settleOperations(timeoutMs = 5000) {
    if (this.cleanupUncertain) throw this.cleanupError;
    if (!this.pendingOperations.size) return;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new TypeError('OAuth cleanup budget must be 1..5000ms');
    const remaining = (this.options.deadline ?? Date.now() + timeoutMs) - Date.now();
    const budget = remaining > 0 ? Math.min(timeoutMs, remaining) : timeoutMs;
    let timer;
    try {
      await Promise.race([
        (async () => { while (this.pendingOperations.size) await Promise.allSettled([...this.pendingOperations]); })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            this.cleanupUncertain = true;
            const error = new GatewayError('oauth_cleanup_uncertain', 'OAuth credential cleanup did not settle within its bounded budget; the credential lock is retained until its recorded owner and pending writes are verified');
            error.credentialLockPath = `${this.path}.lock`;
            this.cleanupError = error;
            reject(error);
          }, budget);
        })
      ]);
    } finally { clearTimeout(timer); }
  }
  async runLocked(operation) {
    if (this.releaseLock) {
      if (this.options.interactive || this.lockContext.getStore() === this.releaseLock) return operation();
      throw new GatewayError('oauth_busy', 'OAuth credentials are in use by another operation; retry after it finishes');
    }
    const release = await this.acquireLock();
    this.releaseLock = release;
    try { return await this.lockContext.run(release, operation); }
    finally { this.releaseLock = undefined; await release(); }
  }
  async readState() {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new GatewayError('oauth_storage_error', 'Cannot reload private OAuth state');
    }
  }
  runRequest(operation, message) {
    if (this.context.getStore()) return operation();
    const context = { generation: this.generation,
      toolBody: message?.method === 'tools/call' ? JSON.stringify(message) : undefined };
    return this.context.run(context, async () => {
      try { return await operation(); }
      catch (error) {
        if (context.toolAuthRejected && context.lastBackendRequestIsTool && !context.toolAccepted && !context.toolAmbiguous &&
            ((error instanceof GatewayError && error.code === 'auth_required') || error instanceof UnauthorizedError)) {
          error[HTTP_AUTH_REJECTED_BEFORE_EXECUTION] = true;
        }
        throw error;
      }
    });
  }
  fetch(fetchFn) {
    const originalFetch = fetchFn;
    const underlying = async (input, init) => {
      const response = await originalFetch(input, { ...init,
        [OAUTH_PROTOCOL_HEADERS]: init?.[OAUTH_PROTOCOL_HEADERS] ?? init?.headers });
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (response.ok && /\/\.well-known\/(?:oauth-authorization-server|openid-configuration)(?:\/|$)/.test(url.pathname)) {
        const raw = await response.clone().json();
        if (typeof raw.issuer === 'string') this.metadataExtensions.set(raw.issuer, raw);
      }
      if (url.href === new URL(this.config.url).href && this.saved.discovery &&
          microsoftAuthority(this.saved.discovery.authorizationServerUrl) &&
          response[MICROSOFT_REQUIRED_SCOPE] && !response.headers.has('www-authenticate')) {
        const name = response[MICROSOFT_REQUIRED_SCOPE];
        const credential = await this.microsoftCredential(this.saved.discovery, undefined, underlying);
        const scopes = credential.requiredScopes(name);
        const context = this.context.getStore();
        const toolPost = context?.toolBody && init?.method?.toUpperCase() === 'POST' && init.body === context.toolBody;
        if (toolPost) context.toolAuthRejected = true;
        await response.body?.cancel();
        if (toolPost || !this.options.interactive || !this.hostCredential || this.hostScopeStepup) {
          throw oauthRequired(this.config.name, this.hostCredential, scopes, trustedMicrosoftResource(this));
        }
        this.hostScopeStepup = true;
        this.entra = await this.microsoftCredential(this.saved.discovery, scopes.join(' '), underlying);
        await this.entra.silent(this.tokens()?.access_token, { requireLogin: true });
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${this.tokens().access_token}`);
        if (toolPost) context.toolAmbiguous = true;
        const retried = await underlying(input, { ...init, headers });
        if (toolPost && [401, 403].includes(retried.status)) context.toolAmbiguous = false;
        return retried;
      }
      return response;
    };
    fetchFn = async (input, init = {}) => {
      const backendRequest = String(input instanceof Request ? input.url : input) === new URL(this.config.url).href;
      if (backendRequest && this.hostCredential && this.saved.discovery) {
        this.entra = await this.microsoftCredential(this.saved.discovery, undefined, underlying);
        try { await this.entra.silent(); }
        catch (error) { if (error.code === 'auth_required') throw oauthRequired(this.config.name, this.hostCredential); throw error; }
        const headers = new Headers(init.headers);
        headers.set('authorization', `Bearer ${this.tokens().access_token}`);
        init = { ...init, headers };
      }
      if (backendRequest && this.serviceAccount && this.saved.discovery) {
        if (microsoftAuthority(this.saved.discovery.authorizationServerUrl) || this.config.oauth?.provider === 'entra') {
          this.entra = new EntraOAuth(this, this.saved.discovery, this.saved.entra?.scope, underlying);
          await this.entra.service();
        } else await acquireServiceTokens(this, this.saved.discovery, (this.pendingService ?? this.saved.service)?.scope, underlying);
        const headers = new Headers(init.headers);
        headers.set('authorization', `Bearer ${this.tokens().access_token}`);
        init = { ...init, headers };
      }
      const rejectedToken = this.tokens()?.access_token;
      const response = await underlying(input, init);
      if (String(input instanceof Request ? input.url : input) !== new URL(this.config.url).href ||
          ![401, 403].includes(response.status) ||
          !/^Bearer(?:\s|$)/i.test(response.headers.get('www-authenticate') ?? '')) return response;
      const challenge = extractWWWAuthenticateParams(response);
      if (response.status === 403 && challenge.error !== 'insufficient_scope') return response;
      const context = this.context.getStore();
      const toolPost = context?.toolBody && init.method?.toUpperCase() === 'POST' && init.body === context.toolBody;
      if (toolPost) context.toolAuthRejected = true;
      const discovery = this.saved.discovery ?? await discoverOAuthServerInfo(new URL(this.config.url), {
        resourceMetadataUrl: challenge.resourceMetadataUrl, fetchFn: underlying
      });
      if (!microsoftAuthority(discovery.authorizationServerUrl) && this.config.oauth?.provider !== 'entra') {
        if (this.hostCredential) {
          await response.body?.cancel();
          throw new GatewayError('oauth_invalid_issuer', 'Host credentials require verified Microsoft discovery');
        }
        if (!this.saved.discovery && discovery.resourceMetadata && discovery.authorizationServerMetadata) await this.saveDiscoveryState({ ...discovery,
          resourceMetadataUrl: challenge.resourceMetadataUrl?.toString() });
        if (this.options.deviceCode) {
          await response.body?.cancel();
          if (this.serviceAccount) throw new GatewayError('oauth_unsupported_flow', 'Device authorization cannot be combined with client_credentials');
          if (!this.options.interactive || this.pendingTokens) throw oauthRequired(this.config.name);
          await acquireDeviceTokens(this, this.saved.discovery, challenge.scope, underlying);
          const headers = new Headers(init.headers);
          headers.set('authorization', `Bearer ${this.tokens().access_token}`);
          const retried = await underlying(input, { ...init, headers });
          if ([401, 403].includes(retried.status)) {
            await retried.body?.cancel();
            throw new GatewayError('oauth_device_failed', 'MCP resource rejected the device authorization token');
          }
          return retried;
        }
        if (this.serviceAccount) {
          await response.body?.cancel();
          await acquireServiceTokens(this, discovery, challenge.scope, underlying, rejectedToken);
          const headers = new Headers(init.headers);
          headers.set('authorization', `Bearer ${this.tokens().access_token}`);
          if (toolPost) context.toolAmbiguous = true;
          const retried = await underlying(input, { ...init, headers });
          if ([401, 403].includes(retried.status)) {
            if (toolPost) context.toolAmbiguous = false;
            await retried.body?.cancel();
            throw new GatewayError('oauth_service_auth_failed', 'MCP resource rejected the service-account token; verify app-only support and consent');
          }
          return retried;
        }
        return response;
      }
      boundMicrosoftScopes(this, discovery, challenge.scope);
      if (challenge.error === 'insufficient_scope' && (toolPost || !this.serviceAccount &&
          (!this.options.interactive || !this.hostCredential && this.pendingTokens))) {
        await response.body?.cancel();
        const scopes = boundMicrosoftScopes(this, discovery, challenge.scope).scopes;
        throw oauthRequired(this.config.name, this.hostCredential, scopes, trustedMicrosoftResource(this));
      }
      if (JSON.stringify(discovery) !== JSON.stringify(this.saved.discovery)) await this.saveDiscoveryState(discovery);
      this.entra = await this.microsoftCredential(discovery, challenge.scope, underlying);
      await response.body?.cancel();
      if (this.hostCredential) {
        if (challenge.error === 'insufficient_scope' && !this.options.interactive) {
          const error = oauthRequired(this.config.name, this.hostCredential);
          error.message += ' Additional Microsoft scopes require explicit consent.';
          error.requiredScopes = this.entra.scopes;
          throw error;
        }
        try { await this.entra.silent(rejectedToken, { requireLogin: challenge.error === 'insufficient_scope' }); }
        catch (error) { if (error.code === 'auth_required') throw oauthRequired(this.config.name, this.hostCredential); throw error; }
      } else if (this.serviceAccount) await this.entra.service(rejectedToken);
      else if (this.options.interactive && !this.pendingTokens) {
        if (this.options.deviceCode) await this.entra.deviceCode();
        else {
          await this.entra.authorize();
          throw new UnauthorizedError();
        }
      }
      if (!this.hostCredential && !this.serviceAccount && this.entraRefresh) await this.entraRefresh;
      else if (!this.hostCredential && !this.serviceAccount && this.tokens()?.access_token === rejectedToken) {
        this.entraRefresh = this.entra.silent(rejectedToken);
        try { await this.entraRefresh; }
        finally { this.entraRefresh = undefined; }
      }
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${this.tokens().access_token}`);
      if (toolPost) context.toolAmbiguous = true;
      const retried = await underlying(input, { ...init, headers });
      if (toolPost && [401, 403].includes(retried.status) &&
          /^Bearer(?:\s|$)/i.test(retried.headers.get('www-authenticate') ?? '')) context.toolAmbiguous = false;
      if ([401, 403].includes(retried.status)) {
        await retried.body?.cancel();
        throw oauthRequired(this.config.name, this.hostCredential);
      }
      return retried;
    };
    return async (input, init = {}) => {
      const context = this.context.getStore();
      if (context?.toolBody && String(input instanceof Request ? input.url : input) === new URL(this.config.url).href) {
        const toolPost = init.method?.toUpperCase() === 'POST' && init.body === context.toolBody;
        context.lastBackendRequestIsTool = toolPost;
        if (toolPost) {
          try {
            const response = await fetchFn(input, init);
            context.toolAuthRejected = [401, 403].includes(response.status) &&
              /^Bearer(?:\s|$)/i.test(response.headers.get('www-authenticate') ?? '');
            if (response.ok) context.toolAccepted = true;
            else if (!context.toolAuthRejected) context.toolAmbiguous = true;
            return response;
          } catch (error) {
            if (!context.toolAuthRejected) context.toolAmbiguous = true;
            throw error;
          }
        }
      }
      const params = typeof init.body === 'string' || init.body instanceof URLSearchParams ? new URLSearchParams(init.body) : undefined;
      if (params?.get('grant_type') !== 'refresh_token') {
        const response = await fetchFn(input, init);
        if (params?.has('grant_type') && String(input instanceof Request ? input.url : input) ===
            this.saved.discovery?.authorizationServerMetadata?.token_endpoint) await validateTokenResponse(response);
        return response;
      }
      const generation = this.context.getStore()?.generation ?? this.generation;
      const tokenResponse = tokens => new Response(JSON.stringify(tokens), { headers: { 'Content-Type': 'application/json' } });
      if (generation !== this.generation && this.saved.tokens) return tokenResponse(this.saved.tokens);
      if (this.refresh?.generation === generation) return (await this.refresh.promise).clone();
      const promise = this.withLock(async () => {
        const current = await this.readState();
        if (current.revision !== this.revision) {
          this.saved = current;
          this.revision = current.revision;
          if (this.context.getStore()) this.context.getStore().generation = this.generation;
          if (current.tokens) return tokenResponse(current.tokens);
          throw oauthRequired(this.config.name);
        }
        const response = await fetchFn(input, init);
        if (response.ok) {
          await validateTokenResponse(response);
          let tokens;
          try { tokens = OAuthTokensSchema.parse(await response.clone().json()); }
          catch { throw new GatewayError('oauth_invalid_token', 'OAuth returned an invalid token response'); }
          await this.saveTokens(tokens);
        }
        return response;
      });
      this.refresh = { generation, promise };
      try { return (await promise).clone(); }
      finally {
        if (this.refresh?.promise === promise) this.refresh = undefined;
      }
    };
  }
  clientInformation() {
    if (this.config.oauth?.clientId) return { client_id: this.config.oauth.clientId };
    if (this.hostCredential) throw oauthRequired(this.config.name, this.hostCredential);
    if (!this.saved.client && !this.options.interactive) throw oauthRequired(this.config.name);
    return requirePublicClient(this.saved.client);
  }
  async persist() {
    return this.withLock(() => this.persistLocked());
  }
  async persistLocked() {
    this.options.signal?.throwIfAborted();
    const current = await this.readState();
    if (current.revision !== this.revision) throw new GatewayError('oauth_state_changed', 'OAuth credentials changed in another process; retry using the latest state');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await secureOwnerOnly([{ path: this.directory, directory: true }], this.options);
    const temporary = `${this.path}.${randomBytes(8).toString('hex')}.tmp`;
    const revision = randomBytes(16).toString('hex');
    try {
      const saved = { ...this.saved, revision };
      if (this.azureCli) { delete saved.tokens; delete saved.expiresAt; delete saved.entra; delete saved.client; }
      this.options.signal?.throwIfAborted();
      await writeFile(temporary, JSON.stringify(saved), { flag: 'wx', mode: 0o600 });
      await secureOwnerOnly([{ path: temporary, directory: false }], this.options);
      this.options.signal?.throwIfAborted();
      await rename(temporary, this.path);
      this.saved.revision = revision;
      this.revision = revision;
    } finally {
      try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  async saveClientInformation(client) {
    if (this.hostCredential) throw new GatewayError('oauth_invalid_flow', 'Host credentials do not register a gateway OAuth client');
    requirePublicClient(client);
    this.saved.client = client;
    await this.persist();
  }
  tokens() {
    const tokens = this.pendingTokens ?? this.saved.tokens;
    if (!tokens) return undefined;
    return tokens;
  }
  async saveTokens(tokens, replace = false, expiresAt = tokens?.expires_in === undefined ? undefined : Date.now() + tokens.expires_in * 1000, serviceState) {
    validateAccessToken(tokens?.access_token);
    this.options.signal?.throwIfAborted();
    const previous = this.pendingTokens ?? this.saved.tokens;
    const merged = { ...tokens, ...(replace || tokens.refresh_token ? {} : previous?.refresh_token ? { refresh_token: previous.refresh_token } : {}) };
    const context = this.context.getStore();
    if (context && context.generation !== this.generation) return false;
    const serviceChanged = serviceState && JSON.stringify(serviceState) !== JSON.stringify(this.saved.service);
    if (!replace && !this.options.interactive && !serviceChanged && JSON.stringify(merged) === JSON.stringify(previous)) return false;
    if (this.options.interactive) {
      this.pendingTokens = merged;
      if (serviceState) this.pendingService = serviceState;
      this.pendingExpiresAt = expiresAt;
      if (context) context.generation = this.generation;
      return true;
    }
    this.saved.tokens = merged;
    if (serviceState) this.saved.service = serviceState;
    if (context) context.generation = this.generation;
    this.saved.expiresAt = expiresAt;
    await this.persist();
    return true;
  }
  async commitTokens() {
    if (!this.pendingTokens) return;
    validateAccessToken(this.pendingTokens.access_token);
    if (this.pendingService) this.saved.service = this.pendingService;
    if (this.saved.discovery && microsoftAuthority(this.saved.discovery.authorizationServerUrl)) {
      this.saved.trustedMicrosoftResource = trustedMicrosoftResource(this);
    }
    if (this.pendingEntra) this.saved.entra = this.pendingEntra;
    if (this.pendingDevice) this.saved.device = this.pendingDevice;
    if (this.pendingAzureCli) {
      this.saved.azureCli = this.pendingAzureCli;
      delete this.saved.vscode;
      delete this.saved.entra;
      delete this.saved.client;
    }
    if (this.pendingVSCode) {
      this.saved.vscode = this.pendingVSCode;
      delete this.saved.azureCli;
      delete this.saved.entra;
      delete this.saved.client;
    }
    this.saved.tokens = this.pendingTokens;
    this.saved.expiresAt = this.pendingExpiresAt;
    await this.persist();
    this.pendingTokens = undefined;
    this.pendingService = undefined;
    this.pendingExpiresAt = undefined;
    this.pendingEntra = undefined;
    this.pendingDevice = undefined;
    this.pendingAzureCli = undefined;
    this.pendingVSCode = undefined;
  }
  async redirectToAuthorization(url) {
    safeOAuthUrl(url);
    if (!this.options.interactive) throw oauthRequired(this.config.name);
    await this.options.onAuthorization(url);
  }
  saveCodeVerifier(verifier) { this.verifier = verifier; }
  codeVerifier() {
    if (!this.verifier) throw new GatewayError('oauth_invalid_flow', 'OAuth verifier is unavailable; start sign-in again');
    return this.verifier;
  }
  discoveryState() { return this.saved.discovery; }
  async saveDiscoveryState(discovery) {
    try { await selectResourceURL(this.config.url, this, discovery.resourceMetadata); }
    catch { throw new GatewayError('oauth_invalid_resource', 'OAuth protected-resource metadata does not match this backend'); }
    safeOAuthUrl(discovery.authorizationServerUrl);
    let metadata = discovery.authorizationServerMetadata;
    if (microsoftAuthority(discovery.authorizationServerUrl) || this.config.oauth?.provider === 'entra') {
      boundMicrosoftScopes(this, discovery);
      if (this.confidential) {
        if (!this.serviceAccount) throw new GatewayError('oauth_unsupported_flow', 'Entra confidential clients require client_credentials');
        entraServiceAuthority(this.config, discovery);
      }
      else validateMicrosoftDiscovery(discovery);
      this.saved.discovery = discovery;
      await this.persist();
      return;
    }
    const raw = this.metadataExtensions.get(metadata?.issuer);
    if (raw && raw.authorization_endpoint === metadata.authorization_endpoint && raw.token_endpoint === metadata.token_endpoint) {
      metadata = { ...metadata };
      for (const field of ['authorization_response_iss_parameter_supported', 'device_authorization_endpoint']) {
        if (Object.hasOwn(raw, field)) metadata[field] = raw[field];
      }
      discovery = { ...discovery, authorizationServerMetadata: metadata };
    }
    if (metadata?.authorization_response_iss_parameter_supported !== undefined &&
        typeof metadata.authorization_response_iss_parameter_supported !== 'boolean') {
      throw new GatewayError('oauth_invalid_issuer', 'Invalid authorization response issuer capability');
    }
    if (metadata?.issuer && new URL(metadata.issuer).href !== new URL(discovery.authorizationServerUrl).href) {
      throw new GatewayError('oauth_invalid_issuer', 'OAuth discovery issuer does not match the authorization server');
    }
    for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'device_authorization_endpoint']) {
      if (metadata?.[key]) safeOAuthUrl(metadata[key]);
    }
    if (this.confidential) validateClientDiscovery(this.config, discovery);
    if (!this.config.oauth?.clientId && !metadata?.registration_endpoint &&
        !(this.clientMetadataUrl && metadata?.client_id_metadata_document_supported)) {
      throw new GatewayError('oauth_registration_required', 'Authorization server requires a pre-registered public client. Configure oauth.clientId and register the exact loopback redirect URI (including port); Entra tenant/admin consent may be required.');
    }
    if (this.saved.discovery?.authorizationServerUrl && this.saved.discovery.authorizationServerUrl !== discovery.authorizationServerUrl) {
      delete this.saved.tokens;
      delete this.saved.client;
    }
    this.saved.discovery = discovery;
    await this.persist();
  }
  async invalidateCredentials(scope) {
    const context = this.context.getStore();
    if (context && context.generation !== this.generation) return;
    if (scope === 'all' || scope === 'tokens') { delete this.saved.tokens; delete this.saved.entra; delete this.saved.azureCli; delete this.saved.vscode; delete this.saved.expiresAt; this.pendingTokens = undefined; this.pendingService = undefined; this.pendingExpiresAt = undefined; this.pendingEntra = undefined; this.pendingAzureCli = undefined; this.pendingVSCode = undefined; }
    if (scope === 'all' || scope === 'client') delete this.saved.client;
    if (scope === 'all' || scope === 'discovery') delete this.saved.discovery;
    if (scope === 'all' || scope === 'verifier') this.verifier = undefined;
    if (context) context.generation = this.generation;
    await this.persist();
  }

}

export class OAuthHTTPClientTransport extends StreamableHTTPClientTransport {
  constructor(url, options) {
    super(url, { ...options, fetch: options.authProvider.fetch(options.fetch) });
    const fetchWithInit = this._fetchWithInit;
    // Capture SDK-owned headers before its requestInit merge adds backend headers.
    this._fetchWithInit = (input, init = {}) => fetchWithInit(input, {
      ...init, [OAUTH_PROTOCOL_HEADERS]: new Headers(init.headers)
    });
    this.provider = options.authProvider;
  }
  send(message, options) {
    return this.provider.runRequest(() => super.send(message, options), message);
  }
  async close() {
    await super.close();
    try { await this.provider.settleOperations(); }
    catch (error) {
      if (error.code !== 'oauth_cleanup_uncertain') throw error;
      this.onerror?.(error);
    }
  }
  async finishAuth(code) {
    if (this.provider.entra) await this.provider.entra.finish(code);
    else await super.finishAuth(code);
  }
}

async function openBrowser(url) {
  const run = promisify(execFile);
  if (process.platform === 'win32') {
    const encoded = Buffer.from(`Start-Process '${url.href.replaceAll("'", "''")}'`, 'utf16le').toString('base64');
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeout: 5000, windowsHide: true });
  } else {
    await run(process.platform === 'darwin' ? 'open' : 'xdg-open', [url.href], { timeout: 5000 });
  }
}

export async function authenticateBackend(config, stateDir, options = {}) {
  if (!config.url || hasStaticAuthorization(config)) throw new GatewayError('oauth_not_applicable', 'Native OAuth requires an HTTP backend without an explicit Authorization header');
  if (options.vscode && options.azureCli) throw new GatewayError('oauth_invalid_flow', 'Select only one host credential provider');
  if (options.resource !== undefined) canonicalMicrosoftResource(options.resource);
  const timeoutMs = options.timeoutMs ?? 180_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180_000) throw new Error('OAuth timeout must be 1..180000ms');
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let rejectCode;
  let resolveCode;
  let awaitingCode = false;
  const code = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  code.catch(() => {});
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => rejectCode(new GatewayError('oauth_cancelled', 'OAuth sign-in cancelled or timed out'));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let provider;
  const callback = createServer((request, response) => {
    const redirect = new URL(provider.redirectUrl);
    if (request.method !== 'GET' || request.headers.host !== redirect.host || request.headers.origin ||
        request.url?.split('?')[0] !== redirect.pathname || !awaitingCode) {
      response.writeHead(400).end('Invalid OAuth callback'); return;
    }
    const received = new URL(request.url, redirect);
    const state = received.searchParams.getAll('state');
    if (state.length !== 1 || state[0] !== provider.nonce) {
      response.writeHead(400).end('Invalid OAuth state');
      rejectCode(new GatewayError('oauth_invalid_state', 'OAuth state mismatch')); return;
    }
    awaitingCode = false;
    if (!provider.entra) {
      const issuers = received.searchParams.getAll('iss');
      const metadata = provider.saved.discovery?.authorizationServerMetadata;
      if (issuers.length > 1 || (issuers.length === 1 && issuers[0] !== metadata?.issuer) ||
          (metadata?.authorization_response_iss_parameter_supported === true && issuers.length !== 1)) {
        response.writeHead(400).end('Invalid OAuth issuer');
        rejectCode(new GatewayError('oauth_invalid_issuer', 'OAuth callback issuer is missing, duplicated, or mismatched')); return;
      }
    }
    if (received.searchParams.has('error')) {
      response.writeHead(400).end('Authorization denied');
      rejectCode(new GatewayError('oauth_denied', 'Authorization denied')); return;
    }
    const codes = received.searchParams.getAll('code');
    if (codes.length !== 1 || !codes[0]) {
      response.writeHead(400).end('Missing authorization code');
      rejectCode(new GatewayError('oauth_invalid_flow', 'Missing authorization code')); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Authorization received. You may close this window.');
    resolveCode(codes[0]);
  });
  callback.requestTimeout = 5000;
  callback.headersTimeout = 5000;
  const client = new Client({ name: 'shared-mcp-gateway-auth', version: '1' });
  let transport;
  try {
    provider = await BackendOAuthProvider.load(config, stateDir, { interactive: true, deadline, signal: controller.signal,
      resource: options.resource, scopes: options.scopes,
      azureCli: options.azureCli, vscode: options.vscode, vscodeAcquire: options.vscodeAcquire,
      vscodeResolver: options.vscodeResolver, vscodeSpawn: options.vscodeSpawn, vscodeStop: options.vscodeStop,
      forceLogin: options.forceLogin, azureCliRunner: options.azureCliRunner, azureCliResolver: options.azureCliResolver, noBrowser: options.noBrowser,
      deviceCode: options.deviceCode, onDeviceCode: options.onDeviceCode, deviceClock: options.deviceClock,
      onAuthorization: async url => {
        awaitingCode = true;
        if (options.onAuthorization) await options.onAuthorization(url);
        else if (options.noBrowser) console.log(`Open this sign-in URL locally:\n${url.href}`);
        else await openBrowser(url);
      } });
    if (options.forceLogin && !provider.hostCredential) throw new GatewayError('oauth_unsupported_flow', '--force-login requires a selected host credential provider; registered credentials still take precedence');
    provider.releaseLock = await provider.acquireLock();
    if (options.scopes?.length && provider.saved.discovery && microsoftAuthority(provider.saved.discovery.authorizationServerUrl)) {
      provider.entra = await provider.microsoftCredential(provider.saved.discovery, undefined,
        boundedOAuthFetch(controller.signal, 10_000, config));
      if (provider.hostCredential) await provider.entra.silent(undefined, { requireLogin: true });
      else if (provider.serviceAccount) await provider.entra.service();
      else if (options.deviceCode) await provider.entra.deviceCode();
      else {
        await new Promise((resolve, reject) => {
          callback.once('error', reject);
          callback.listen(new URL(provider.redirectUrl).port, '127.0.0.1', resolve);
        });
        await provider.entra.authorize();
        await provider.entra.finish(await code);
      }
    }
    if (!callback.listening && !options.deviceCode && !provider.serviceAccount && !provider.hostCredential) {
      await new Promise((resolve, reject) => {
        callback.once('error', reject);
        callback.listen(new URL(provider.redirectUrl).port, '127.0.0.1', resolve);
      });
    }
    const newTransport = () => new OAuthHTTPClientTransport(new URL(config.url), {
      authProvider: provider, fetch: boundedOAuthFetch(controller.signal, 10_000, config), requestInit: { headers: config.headers ?? {} }
    });
    transport = newTransport();
    try { await client.connect(transport, { timeout: options.deviceCode || provider.hostCredential ? timeoutMs : Math.min(timeoutMs, 15_000), signal: controller.signal }); }
    catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      const authorizationCode = await code;
      controller.signal.throwIfAborted();
      await transport.finishAuth(authorizationCode);
      await client.close();
      transport = newTransport();
      await client.connect(transport, { timeout: Math.min(timeoutMs, 15_000), signal: controller.signal });
    }
    const tools = await client.listTools(undefined, { timeout: Math.min(timeoutMs, 15_000), signal: controller.signal });
    controller.signal.throwIfAborted();
    await provider.commitTokens();
    return { authenticated: true, server: config.name, discoveredTools: tools.tools.length,
      ...(provider.vscode ? { credentialProvider: 'vscode', interaction: 'host-permission',
        vscodeProfilePaths: [...(provider.vscodeProfilePaths ?? [])] } : {}),
      ...(provider.azureCli ? { credentialProvider: 'azure-cli',
        interaction: provider.azureCliLoginPerformed ? options.deviceCode ? 'device-code' : 'browser' : 'cached' } : {}) };
  } catch (error) {
    const failure = error instanceof GatewayError ? error :
      new GatewayError(controller.signal.aborted ? 'oauth_cancelled' : 'oauth_failed', controller.signal.aborted ? 'OAuth sign-in cancelled or timed out' : 'OAuth sign-in failed; check discovery, public client registration, consent, and callback port');
    if (provider?.vscodeProfilePaths?.size) failure.vscodeProfilePaths = [...provider.vscodeProfilePaths];
    throw failure;
  } finally {
    clearTimeout(timer);
    controller.abort();
    options.signal?.removeEventListener('abort', cancel);
    try { await client.close(); }
    finally {
      try {
        if (provider) await provider.settleOperations();
      } finally {
        try {
          callback.closeAllConnections();
          if (callback.listening) await new Promise((resolve, reject) => callback.close(error => error ? reject(error) : resolve()));
        } finally {
          if (provider) provider.verifier = undefined;
          if (provider?.releaseLock && !provider.cleanupUncertain) await provider.releaseLock();
        }
      }
    }
  }
}
