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
import { UnauthorizedError, selectResourceURL } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthTokensSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { secureOwnerOnly } from './token.js';
import { GatewayError } from './errors.js';
import { safeOAuthUrl } from './config-schema.js';

export const HTTP_AUTH_REJECTED_BEFORE_EXECUTION = Symbol('http-auth-rejected-before-execution');

export function hasStaticAuthorization(config) {
  return Object.keys(config.headers ?? {}).some(key => key.toLowerCase() === 'authorization');
}

export function oauthRequired(name) {
  const command = fileURLToPath(new URL('../tools/authenticate-backend.mjs', import.meta.url));
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  return new GatewayError('auth_required', `Backend ${name} needs sign-in. Run node ${quote(command)} --server ${quote(name)} --config PATH --state-dir PATH; use the gateway's config and state directory.`);
}

export function boundedOAuthFetch(signal, timeoutMs = 10_000, config) {
  return async (input, init = {}) => {
    const target = safeOAuthUrl(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const notification = config && target.href === new URL(config.url).href &&
      method === 'GET' && headers.get('accept')?.trim().toLowerCase() === 'text/event-stream';
    if (config && target.href !== new URL(config.url).href) {
      for (const key of Object.keys(config.headers ?? {})) headers.delete(key);
      headers.delete('authorization');
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
      throw new GatewayError('oauth_http_error', `OAuth HTTP request failed (${response.status})`);
    }

    if (!response.ok) {
      let errorBody = '{}';
      if (response.status === 400) {
        const text = await response.text();
        let parsed;
        try { parsed = JSON.parse(text); }
        catch { throw new GatewayError('oauth_http_error', 'OAuth HTTP request failed (400; invalid error response)'); }
        const allowed = ['invalid_grant', 'invalid_client', 'unauthorized_client', 'invalid_scope', 'access_denied', 'invalid_request', 'unsupported_grant_type'];
        if (allowed.includes(parsed?.error)) errorBody = JSON.stringify({ error: parsed.error });
      }
      if (!response.bodyUsed) await response.body?.cancel();
      const errorHeaders = new Headers(response.headers);
      errorHeaders.delete('content-length');
      errorHeaders.delete('content-encoding');
      return new Response(errorBody, { status: response.status, headers: errorHeaders });
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
    return provider;
  }

  constructor(config, stateDir, options) {
    this.config = config;
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
    this.verifier = undefined;
    this.nonce = randomBytes(32).toString('base64url');
    this.clientMetadataUrl = config.oauth?.clientMetadataUrl;
  }

  get redirectUrl() { return `http://127.0.0.1:${this.config.oauth?.redirectPort ?? 7340}/oauth/callback`; }
  get clientMetadata() {
    return { client_name: 'Shared MCP Gateway', redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', ...(this.config.oauth?.scopes ? { scope: this.config.oauth.scopes.join(' ') } : {}) };
  }
  state() { return this.nonce; }
  get generation() { return JSON.stringify(this.pendingTokens ?? this.saved.tokens); }
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
            context.toolAmbiguous = true;
            throw error;
          }
        }
      }
      const params = typeof init.body === 'string' || init.body instanceof URLSearchParams ? new URLSearchParams(init.body) : undefined;
      if (params?.get('grant_type') !== 'refresh_token') return fetchFn(input, init);
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
          const tokens = OAuthTokensSchema.parse(await response.clone().json());
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
    if (!this.saved.client && !this.options.interactive) throw oauthRequired(this.config.name);
    return requirePublicClient(this.saved.client);
  }
  async persist() {
    return this.withLock(() => this.persistLocked());
  }
  async persistLocked() {
    const current = await this.readState();
    if (current.revision !== this.revision) throw new GatewayError('oauth_state_changed', 'OAuth credentials changed in another process; retry using the latest state');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await secureOwnerOnly([{ path: this.directory, directory: true }], this.options);
    const temporary = `${this.path}.${randomBytes(8).toString('hex')}.tmp`;
    const revision = randomBytes(16).toString('hex');
    try {
      await writeFile(temporary, JSON.stringify({ ...this.saved, revision }), { flag: 'wx', mode: 0o600 });
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
    requirePublicClient(client);
    this.saved.client = client;
    await this.persist();
  }
  tokens() {
    const tokens = this.pendingTokens ?? this.saved.tokens;
    if (!tokens) return undefined;
    return tokens;
  }
  async saveTokens(tokens) {
    const previous = this.pendingTokens ?? this.saved.tokens;
    const merged = { ...tokens, ...(tokens.refresh_token ? {} : previous?.refresh_token ? { refresh_token: previous.refresh_token } : {}) };
    if (JSON.stringify(merged) === JSON.stringify(previous)) return;
    const context = this.context.getStore();
    if (context && context.generation !== this.generation) return;
    if (this.options.interactive) {
      this.pendingTokens = merged;
      if (context) context.generation = this.generation;
      return;
    }
    this.saved.tokens = merged;
    if (context) context.generation = this.generation;
    this.saved.expiresAt = tokens.expires_in === undefined ? undefined : Date.now() + tokens.expires_in * 1000;
    await this.persist();
  }
  async commitTokens() {
    if (!this.pendingTokens) return;
    this.saved.tokens = this.pendingTokens;
    this.saved.expiresAt = this.pendingTokens.expires_in === undefined ? undefined : Date.now() + this.pendingTokens.expires_in * 1000;
    await this.persist();
    this.pendingTokens = undefined;
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
    const metadata = discovery.authorizationServerMetadata;
    if (metadata?.issuer && new URL(metadata.issuer).href !== new URL(discovery.authorizationServerUrl).href) {
      throw new GatewayError('oauth_invalid_issuer', 'OAuth discovery issuer does not match the authorization server');
    }
    for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
      if (metadata?.[key]) safeOAuthUrl(metadata[key]);
    }
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
    if (scope === 'all' || scope === 'tokens') { delete this.saved.tokens; delete this.saved.expiresAt; this.pendingTokens = undefined; }
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
    this.provider = options.authProvider;
  }
  send(message, options) {
    return this.provider.runRequest(() => super.send(message, options), message);
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
      onAuthorization: async url => {
        awaitingCode = true;
        if (options.onAuthorization) await options.onAuthorization(url);
        else if (options.noBrowser) console.log(`Open this sign-in URL locally:\n${url.href}`);
        else await openBrowser(url);
      } });
    provider.releaseLock = await provider.acquireLock();
    await new Promise((resolve, reject) => {
      callback.once('error', reject);
      callback.listen(new URL(provider.redirectUrl).port, '127.0.0.1', resolve);
    });
    const newTransport = () => new OAuthHTTPClientTransport(new URL(config.url), {
      authProvider: provider, fetch: boundedOAuthFetch(controller.signal, 10_000, config), requestInit: { headers: config.headers ?? {} }
    });
    transport = newTransport();
    try { await client.connect(transport, { timeout: Math.min(timeoutMs, 15_000), signal: controller.signal }); }
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
    return { authenticated: true, server: config.name, discoveredTools: tools.tools.length };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError('oauth_failed', controller.signal.aborted ? 'OAuth sign-in cancelled or timed out' : 'OAuth sign-in failed; check discovery, public client registration, consent, and callback port');
  } finally {
    clearTimeout(timer);
    controller.abort();
    options.signal?.removeEventListener('abort', cancel);
    try { await client.close(); }
    finally {
      try {
        callback.closeAllConnections();
        if (callback.listening) await new Promise((resolve, reject) => callback.close(error => error ? reject(error) : resolve()));
      } finally {
        if (provider) provider.verifier = undefined;
        if (provider?.releaseLock) await provider.releaseLock();
      }
    }
  }
}
