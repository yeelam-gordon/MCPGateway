import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { constants, createHash, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PublicClientApplication, ConfidentialClientApplication } from '@azure/msal-node';
import { authenticateBackend, BackendOAuthProvider, OAuthHTTPClientTransport, boundedOAuthFetch } from '../src/backend-oauth.js';
import { BackendRegistry } from '../src/backend-registry.js';
import { EntraOAuth, microsoftAuthority, validateMicrosoftDiscovery, entraClientId, entraServiceAuthority } from '../src/entra-oauth.js';
import { validateBackendConfig } from '../src/config-schema.js';

const clientId = '11111111-1111-1111-1111-111111111111';
const tenantId = '22222222-2222-2222-2222-222222222222';
const authority = 'https://login.microsoftonline.com/organizations';
function publisherId(t, value) {
  const previous = process.env.SHARED_MCP_ENTRA_CLIENT_ID;
  process.env.SHARED_MCP_ENTRA_CLIENT_ID = value;
  t.after(() => {
    if (previous === undefined) delete process.env.SHARED_MCP_ENTRA_CLIENT_ID;
    else process.env.SHARED_MCP_ENTRA_CLIENT_ID = previous;
  });
}
const metadata = { issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
  authorization_endpoint: `${authority}/oauth2/v2.0/authorize`, token_endpoint: `${authority}/oauth2/v2.0/token`,
  response_types_supported: ['code'], jwks_uri: `${authority}/discovery/v2.0/keys`,
  subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] };
const discovery = { authorizationServerUrl: `${authority}/v2.0`, authorizationServerMetadata: metadata,
  resourceMetadata: { resource: 'https://mcp.example/mcp', authorization_servers: [`${authority}/v2.0`],
    scopes_supported: ['api://test-resource/Mcp.Read'] } };

test('exact Microsoft cloud, authority and endpoint trust; generic issuer remains strict', async t => {
  assert.equal(microsoftAuthority(`${authority}/v2.0`), authority);
  for (const url of ['https://login.microsoftonline.com.evil.test/organizations/v2.0',
    'https://sub.login.microsoftonline.com/organizations/v2.0', `${authority}/extra/v2.0`,
    'http://login.microsoftonline.com/organizations/v2.0', `${authority}/v2.0?tenant=x`,
    'https://login.microsoftonline.com/common/v2.0']) assert.equal(microsoftAuthority(url), undefined);
  assert.equal(validateMicrosoftDiscovery(discovery), authority);
  for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint']) {
    assert.throws(() => validateMicrosoftDiscovery({ ...discovery,
      authorizationServerMetadata: { ...metadata, [key]: 'https://evil.example/endpoint' } }), { code: 'oauth_invalid_issuer' });
  }
  const directory = await mkdtemp(join(process.cwd(), '.gateway-entra-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const provider = await BackendOAuthProvider.load({ name: 'test', url: 'https://mcp.example/mcp', oauth: { clientId } }, directory);
  await assert.rejects(provider.saveDiscoveryState({ ...discovery, authorizationServerUrl: 'https://generic.example' }),
    { code: 'oauth_invalid_issuer' });
  await assert.rejects(provider.saveDiscoveryState({ ...discovery, resourceMetadata: { ...discovery.resourceMetadata,
    resource: 'https://other.example/mcp' } }), { code: 'oauth_invalid_resource' });
});

test('Microsoft tenant GUID and selector casing canonicalizes without weakening issuer or endpoint binding', async () => {
  const tenant = 'abcdefab-1234-5678-9abc-def012345678';
  const canonical = `https://login.microsoftonline.com/${tenant}`;
  const upper = `https://login.microsoftonline.com/${tenant.toUpperCase()}`;
  assert.equal(microsoftAuthority(`${upper}/v2.0`), canonical);
  assert.equal(microsoftAuthority('https://login.microsoftonline.com/ORGANIZATIONS/v2.0'), authority);
  for (const [advertised, endpoints] of [[canonical, upper], [upper, canonical], [upper, upper]]) {
    const info = { authorizationServerUrl: `${advertised}/v2.0`,
      authorizationServerMetadata: { issuer: `${endpoints}/v2.0`,
        authorization_endpoint: `${endpoints}/oauth2/v2.0/authorize`, token_endpoint: `${endpoints}/oauth2/v2.0/token` },
      resourceMetadata: { resource: 'https://mcp.example/mcp', authorization_servers: [`${canonical}/v2.0`],
        scopes_supported: ['api://fixture/.default'] } };
    const config = { oauth: { authority: upper, issuer: `${upper}/v2.0`, clientId, tokenEndpointAuthMethod: 'client_secret_post',
      scopes: ['api://fixture/.default'] } };
    assert.equal(validateMicrosoftDiscovery(info), canonical);
    assert.equal(entraServiceAuthority(config, info), canonical);
    assert.throws(() => entraServiceAuthority({ oauth: { ...config.oauth,
      authority: `https://login.microsoftonline.com/${clientId}` } }, info), { code: 'oauth_invalid_issuer' });
    for (const token_endpoint of [`https://login.microsoftonline.com/${clientId}/oauth2/v2.0/token`,
      `${canonical}/OAuth2/v2.0/token`, `${canonical}/oauth2/v2.0/token?extra=1`,
      'https://login.microsoftonline.com.evil.test/organizations/oauth2/v2.0/token']) {
      assert.throws(() => validateMicrosoftDiscovery({ ...info,
        authorizationServerMetadata: { ...info.authorizationServerMetadata, token_endpoint } }), { code: 'oauth_invalid_issuer' });
    }
    const provider = { config, options: {}, saved: {}, serviceAccount: true, confidential: true, path: 'synthetic-backend' };
    const entra = new EntraOAuth(provider, info, undefined, async () => new Response('{}'));
    const sent = await entra.msalConfig.system.networkClient.sendPostRequestAsync(`${upper}/oauth2/v2.0/token`, { body: '', headers: {} });
    assert.equal(sent.status, 200);
  }
});

test('publisher identity fallback, override and missing provisioning; schema', t => {
  publisherId(t, '');
  assert.throws(() => entraClientId({}), error => error.code === 'entra_publisher_registration_required' &&
    /publisher/.test(error.message) && /do not need to enter a tenant/.test(error.message));
  process.env.SHARED_MCP_ENTRA_CLIENT_ID = clientId;
  assert.equal(entraClientId({}), clientId);
  assert.equal(entraClientId({ oauth: { clientId: tenantId } }), tenantId);
  assert.throws(() => entraClientId({ oauth: { clientId: 'not-an-app' } }), { code: 'entra_invalid_client_id' });
  validateBackendConfig({ url: 'https://mcp.example/mcp', oauth: { provider: 'entra' } });
  assert.throws(() => validateBackendConfig({ url: 'https://mcp.example/mcp', oauth: { provider: 'other' } }));
});

async function fixture(t, service = false) {
  const authority = service ? `https://login.microsoftonline.com/${tenantId}` : 'https://login.microsoftonline.com/organizations';
  const metadata = { ...discovery.authorizationServerMetadata,
    issuer: service ? `${authority}/v2.0` : discovery.authorizationServerMetadata.issuer,
    authorization_endpoint: `${authority}/oauth2/v2.0/authorize`, token_endpoint: `${authority}/oauth2/v2.0/token` };
  const resourceMetadata = { ...discovery.resourceMetadata, authorization_servers: [`${authority}/v2.0`],
    scopes_supported: [service ? 'api://test-resource/.default' : 'api://test-resource/Mcp.Read'] };
  const stateDir = await mkdtemp(join(process.cwd(), '.gateway-entra-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const redirectPort = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const config = { name: 'mail', url: 'https://mcp.example/mcp', oauth: service ? {
    provider: 'entra', resource: 'api://test-resource', clientId, authority, grantType: 'client_credentials',
    tokenEndpointAuthMethod: 'client_secret_post', secretEnv: 'ENTRA_SERVICE_TEST_SECRET'
  } : { resource: 'api://test-resource', redirectPort } };
  if (service) {
    const previous = process.env.ENTRA_SERVICE_TEST_SECRET;
    process.env.ENTRA_SERVICE_TEST_SECRET = 'private-test-secret';
    t.after(() => {
      if (previous === undefined) delete process.env.ENTRA_SERVICE_TEST_SECRET;
      else process.env.ENTRA_SERVICE_TEST_SECRET = previous;
    });
  }
  const requests = [];
  let authUrl;
  let token = 'opaque-access-one';
  let refreshes = 0;
  let denyRefresh = false;
  let deviceResult = 'success';
  let serviceResult = 'success';
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === '127.0.0.1') return originalFetch(input, init);
    requests.push({ url, init });
    const json = (status, body, headers) => new Response(JSON.stringify(body), { status,
      headers: { 'content-type': 'application/json', ...headers } });
    if (url.pathname.includes('.well-known/oauth-protected-resource')) return json(200, resourceMetadata);
    if (url.pathname.includes('.well-known/oauth-authorization-server')) return json(404, {});
    if (url.pathname.includes('.well-known/openid-configuration')) return json(200, metadata);
    if (url.pathname.endsWith('/devicecode')) {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get('client_id'), clientId);
      assert.equal(params.has('resource'), false);
      assert.ok(params.get('scope').includes('api://test-resource/Mcp.Read'));
      return json(200, { device_code: 'private-device-code', user_code: 'TEST-CODE',
        verification_uri: deviceResult === 'unsafe' ? 'https://microsoft.com.evil.test/devicelogin' : 'https://microsoft.com/devicelogin',
        expires_in: 900, interval: 1, message: 'untrusted-response-message' });
    }
    if (url.pathname.endsWith('/token')) {
      if (config.headers?.['Content-Type'] &&
          new Headers(init.headers).get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') {
        return json(400, { error: 'invalid_request' });
      }
      const params = new URLSearchParams(init.body);
      assert.equal(params.get('client_id'), clientId);
      assert.equal(params.has('resource'), false);
      if (service) {
        assert.equal(params.get('grant_type'), 'client_credentials');
        assert.equal(params.get('scope'), 'api://test-resource/.default');
        assert.equal(params.has('refresh_token'), false);
        assert.equal(`${url.origin}${url.pathname}`, `${authority}/oauth2/v2.0/token`);
        if (config.oauth.tokenEndpointAuthMethod === 'client_secret_post') {
          assert.equal(params.get('client_secret'), 'private-test-secret');
        }
        if (serviceResult === 'timeout') {
          return new Promise((resolve, reject) => {
            if (init.signal.aborted) reject(init.signal.reason);
            else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
          });
        }
        if (denyRefresh) return json(400, { error: 'invalid_client', error_description: 'private-token-response-body' });
        refreshes++;
        token = `service-access-${refreshes}`;
        return json(200, { access_token: token, token_type: 'Bearer',
          expires_in: serviceResult === 'expiry' ? 0 : serviceResult === 'short' ? 31 : 3600 });
      }
      if (params.get('grant_type') !== 'device_code') {
        assert.ok(params.get('scope').includes('api://test-resource/Mcp.Read'));
      }
      if (params.get('grant_type') === 'authorization_code') {
        assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'),
          authUrl.searchParams.get('code_challenge'));
      } else if (params.get('grant_type') === 'device_code') {
        assert.equal(params.get('device_code'), 'private-device-code');
        if (deviceResult === 'pending') return json(400, { error: 'authorization_pending', error_description: 'private-device-error-body' });
        if (deviceResult === 'denied') return json(400, { error: 'access_denied', error_description: 'private-device-error-body' });
      } else {
        assert.equal(params.get('grant_type'), 'refresh_token');
        if (denyRefresh) return json(400, { error: 'invalid_grant', error_description: 'private-token-response-body' });
        refreshes++;
        token = `opaque-access-${refreshes}`;
      }
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      return json(200, { access_token: token, refresh_token: `rotated-${refreshes}`, token_type: 'Bearer',
        expires_in: 3600, scope: 'api://test-resource/Mcp.Read',
        client_info: encode({ uid: 'test-user', utid: tenantId }),
        id_token: `${encode({ alg: 'none' })}.${encode({ aud: clientId, tid: tenantId, oid: 'test-user',
          sub: 'test-user', preferred_username: 'test@example.invalid', iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
          iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature` });
    }
    if (url.href === config.url) {
      if (serviceResult === 'resource-reject' || new Headers(init.headers).get('authorization') !== `Bearer ${token}`) {
        return json(401, {}, { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"' });
      }
      if (init.method !== 'POST') return json(405, {});
      const message = JSON.parse(init.body);
      if (!Object.hasOwn(message, 'id')) return new Response(null, { status: 202 });
      const result = message.method === 'initialize' ?
        { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } :
        message.method === 'tools/list' ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } :
          { content: [{ type: 'text', text: 'authenticated' }] };
      return json(200, { jsonrpc: '2.0', id: message.id, result });
    }
    assert.fail(`Unexpected fixture network target: ${url.origin}${url.pathname}`);
  });
  return { config, stateDir, requests, rejectToken: () => { token = 'revoked'; },
    discovery: { authorizationServerUrl: `${authority}/v2.0`, authorizationServerMetadata: metadata, resourceMetadata },
    denyRefresh: () => { denyRefresh = true; }, refreshes: () => refreshes,
    deviceResult: result => { deviceResult = result; },
    serviceResult: result => { serviceResult = result; },
    browser: async url => {
      authUrl = url;
      assert.equal(url.hostname, 'login.microsoftonline.com');
      assert.equal(url.pathname, '/organizations/oauth2/v2.0/authorize');
      assert.equal(url.searchParams.get('client_id'), clientId);
      assert.equal(url.searchParams.has('resource'), false);
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', url.searchParams.get('state'));
      callback.searchParams.set('code', 'test-code');
      assert.equal((await originalFetch(callback)).status, 200);
    } };
}

test('AUTH-PORTFOLIO-001 actual MSAL preserves token protocol headers without forwarding backend credentials', async t => {
  const f = await fixture(t, true);
  f.config.headers = { 'Content-Type': 'application/json', Accept: 'backend-only',
    'X-Backend-Credential': 'private-backend-header', 'mcp-session-id': 'private-backend-session' };
  await authenticateBackend(f.config, f.stateDir, { timeoutMs: 10_000 });
  const tokenRequest = f.requests.find(({ url }) => url.pathname.endsWith('/token'));
  assert.ok(tokenRequest);
  assert.equal(new Headers(tokenRequest.init.headers).get('content-type'), 'application/x-www-form-urlencoded;charset=utf-8');
  for (const { url, init } of f.requests.filter(({ url }) => url.href !== f.config.url)) {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('x-backend-credential'), null, url.pathname);
    assert.equal(headers.get('mcp-session-id'), null, url.pathname);
    assert.equal(headers.get('authorization'), null, url.pathname);
    assert.notEqual(headers.get('accept'), 'backend-only', url.pathname);
  }
  assert.equal(f.refreshes(), 1);
});

test('AUTH-PORTFOLIO-002 MSAL acquisition expiry survives delayed verification and forces renewal', async t => {
  const f = await fixture(t, true);
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  f.serviceResult('short');
  const provider = await BackendOAuthProvider.load(f.config, f.stateDir, { interactive: true });
  await provider.saveDiscoveryState(f.discovery);
  const entra = new EntraOAuth(provider, f.discovery, undefined, boundedOAuthFetch(undefined, 10_000, f.config));
  const result = await entra.service();
  const acquisitionExpiry = result.expiresOn.getTime();
  assert.equal(acquisitionExpiry, Date.now() + 31_000);
  t.mock.timers.tick(30_000);
  await provider.commitTokens();
  assert.equal(provider.saved.expiresAt, acquisitionExpiry);
  assert.equal(provider.saved.expiresAt - Date.now(), 1000);
  const restarted = await BackendOAuthProvider.load(f.config, f.stateDir);
  assert.equal(restarted.saved.expiresAt, acquisitionExpiry);
  await new EntraOAuth(restarted, f.discovery, undefined, boundedOAuthFetch(undefined, 10_000, f.config)).service();
  assert.equal(f.refreshes(), 2);
  assert.equal(restarted.saved.expiresAt, Date.now() + 31_000);
});

test('MSAL app-only secret, accountless private cache, expiry, rejection, singleflight and reconnect', async t => {
  const f = await fixture(t, true);
  assert.deepEqual(await authenticateBackend(f.config, f.stateDir, {
    onAuthorization: () => assert.fail('app-only must not open browser'), timeoutMs: 20_000
  }), { authenticated: true, server: 'mail', discoveredTools: 1 });
  let provider = await BackendOAuthProvider.load(f.config, f.stateDir);
  const entra = new EntraOAuth(provider, provider.saved.discovery, undefined, globalThis.fetch);
  await entra.service();
  assert.ok(entra.pca instanceof ConfidentialClientApplication);
  assert.equal(f.refreshes(), 1);
  assert.equal(provider.saved.entra.homeAccountId, undefined);
  assert.equal(provider.tokens().refresh_token, undefined);
  provider.saved.expiresAt = Date.now() - 1;
  await provider.persist();
  const registry = new BackendRegistry(new Map([['mail', f.config]]), { stateDir: f.stateDir });
  try {
    await Promise.all([registry.callTool('mail', 'echo', {}), registry.callTool('mail', 'echo', {})]);
    assert.equal(f.refreshes(), 2);
    f.rejectToken();
    await Promise.all([registry.callTool('mail', 'echo', {}), registry.callTool('mail', 'echo', {})]);
    assert.equal(f.refreshes(), 3);
  } finally { await registry.close(); }
  provider = await BackendOAuthProvider.load(f.config, f.stateDir);
  const restart = new BackendRegistry(new Map([['mail', f.config]]), { stateDir: f.stateDir });
  try { await restart.callTool('mail', 'echo', {}); } finally { await restart.close(); }
  assert.equal(f.refreshes(), 3);
  assert.doesNotMatch(await readFile(provider.path, 'utf8'), /private-test-secret|client_secret|refresh_token/);
  const before = provider.saved.entra.cache;
  f.denyRefresh();
  await assert.rejects(new EntraOAuth(provider, provider.saved.discovery, undefined, globalThis.fetch)
    .service(provider.tokens().access_token), error => error.code === 'oauth_service_auth_failed' &&
      !/private-token|private-test-secret/.test(error.message));
  assert.equal((await BackendOAuthProvider.load(f.config, f.stateDir)).saved.entra.cache, before);
  assert.equal((await readdir(provider.directory)).some(file => file.endsWith('.lock')), false);
});

for (const mode of ['missing-secret', 'expiry', 'timeout', 'resource-reject']) {
  test(`MSAL app-only ${mode} fails closed without publishing tokens or credential material`, async t => {
    const f = await fixture(t, true);
    f.serviceResult(mode);
    if (mode === 'missing-secret') delete process.env.ENTRA_SERVICE_TEST_SECRET;
    const started = Date.now();
    await assert.rejects(authenticateBackend(f.config, f.stateDir, { timeoutMs: mode === 'timeout' ? 3000 : 20_000,
      onAuthorization: () => assert.fail('app-only must not launch browser') }), error =>
      error.code === ({ 'missing-secret': 'oauth_client_credentials_invalid', expiry: 'oauth_invalid_token',
        timeout: 'oauth_cancelled', 'resource-reject': 'auth_required' })[mode] &&
      !/private-test-secret|private-token-response|service-access/.test(error.message));
    if (mode === 'timeout') assert.ok(Date.now() - started < 6000);
    const provider = await BackendOAuthProvider.load(f.config, f.stateDir);
    assert.equal(provider.tokens(), undefined);
    assert.equal(provider.saved.entra, undefined);
    assert.equal((await readdir(provider.directory)).some(file => file.endsWith('.lock') || file.endsWith('.tmp')), false);
  });
}

for (const stalled of [false, true]) {
test(`helper cancellation waits for delayed private staging cleanup before releasing its lock; stalled=${stalled}`, async t => {
  const f = await fixture(t, true);
  f.serviceResult('timeout');
  const controller = new AbortController();
  let enterWrite;
  let releaseWrite;
  let finishWrite;
  let enterClose;
  const writing = new Promise(resolve => { enterWrite = resolve; });
  const writeGate = new Promise(resolve => { releaseWrite = resolve; });
  const cleaned = new Promise(resolve => { finishWrite = resolve; });
  const closing = new Promise(resolve => { enterClose = resolve; });
  let delayed = false;
  let closeSettled = false;
  const persist = BackendOAuthProvider.prototype.persistLocked;
  t.mock.method(BackendOAuthProvider.prototype, 'persistLocked', async function () {
    if (delayed) return persist.call(this);
    delayed = true;
    const staged = `${this.path}.delayed-fixture.tmp`;
    await writeFile(staged, JSON.stringify(this.saved), { flag: 'wx', mode: 0o600 });
    enterWrite(this);
    try { await writeGate; return await persist.call(this); }
    finally { try { await unlink(staged); } finally { finishWrite(); } }
  });
  const close = OAuthHTTPClientTransport.prototype.close;
  t.mock.method(OAuthHTTPClientTransport.prototype, 'close', function () {
    const result = close.call(this);
    result.then(() => { closeSettled = true; }, () => { closeSettled = true; });
    enterClose();
    return result;
  });
  let failure;
  const authentication = authenticateBackend(f.config, f.stateDir, { signal: controller.signal, timeoutMs: 20_000 })
    .then(() => assert.fail('cancelled helper must not authenticate'), error => { failure = error; });
  const owner = await writing;
  if (stalled) {
    const settle = owner.settleOperations;
    owner.settleOperations = () => settle.call(owner, 50);
  }
  try {
    controller.abort();
    await closing;
    if (!stalled) {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(closeSettled, false, 'transport cleanup must await the owned private write, not only abort HTTP');
    }
    assert.ok((await readdir(owner.directory)).includes(`${owner.path.split(/[\\/]/).at(-1)}.lock`),
      'helper must retain its credential lock until the delayed staging file is cleaned');
    if (stalled) {
      await authentication;
      assert.equal(failure?.code, 'oauth_cleanup_uncertain');
      assert.equal(failure.credentialLockPath, `${owner.path}.lock`);
      assert.equal(owner.cleanupUncertain, true);
      assert.ok((await readdir(owner.directory)).includes(`${owner.path.split(/[\\/]/).at(-1)}.lock`),
        'a timed-out cleanup barrier must retain the owned lock and provenance');
    }
  } finally {
    releaseWrite();
    await cleaned;
    await authentication;
  }
  if (stalled) {
    await Promise.allSettled([...owner.pendingOperations]);
    await owner.releaseLock();
  }
  assert.equal(failure?.code, stalled ? 'oauth_cleanup_uncertain' : 'oauth_cancelled');
  assert.equal((await readdir(owner.directory)).some(file => file.endsWith('.lock') || file.endsWith('.tmp')), false);
  const restarted = await BackendOAuthProvider.load(f.config, f.stateDir);
  assert.equal(restarted.tokens(), undefined);
  assert.equal(restarted.saved.entra, undefined);
});
}

test('actual MSAL certificate assertion uses token endpoint audience and registered SHA-256 thumbprint', async t => {
  const f = await fixture(t, true);
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPath = join(f.stateDir, 'registered-key.pem');
  await writeFile(privateKeyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  delete f.config.oauth.secretEnv;
  Object.assign(f.config.oauth, { tokenEndpointAuthMethod: 'private_key_jwt', privateKeyPath,
    certificateThumbprintSha256: 'ab'.repeat(32) });
  await authenticateBackend(f.config, f.stateDir, { timeoutMs: 20_000,
    onAuthorization: () => assert.fail('no browser') });
  const params = new URLSearchParams(f.requests.find(({ url }) => url.pathname.endsWith('/token')).init.body);
  const [header, payload, signature] = params.get('client_assertion').split('.');
  const h = JSON.parse(Buffer.from(header, 'base64url'));
  const p = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(h['x5t#S256'], Buffer.from('ab'.repeat(32), 'hex').toString('base64url'));
  assert.equal(h.alg, 'PS256');
  assert.equal(p.aud, `${f.config.oauth.authority}/oauth2/v2.0/token`);
  assert.equal(p.iss, clientId);
  assert.equal(p.sub, clientId);
  assert.equal(params.get('client_assertion_type'), 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
  assert.equal(params.has('client_secret'), false);
  assert.ok(verify('sha256', Buffer.from(`${header}.${payload}`), {
    key: pair.publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32
  }, Buffer.from(signature, 'base64url')));
  const provider = await BackendOAuthProvider.load(f.config, f.stateDir);
  assert.doesNotMatch(await readFile(provider.path, 'utf8'), /BEGIN PRIVATE|client_assertion/);
});

test('app-only requires tenant authority lineage, explicit /.default and supported method/grant', async t => {
  const f = await fixture(t, true);
  assert.equal(entraServiceAuthority(f.config, discovery), f.config.oauth.authority);
  const tenantDiscovery = { ...discovery, authorizationServerUrl: `${f.config.oauth.authority}/v2.0`,
    authorizationServerMetadata: { ...metadata, issuer: `${f.config.oauth.authority}/v2.0`,
      authorization_endpoint: `${f.config.oauth.authority}/oauth2/v2.0/authorize`,
      token_endpoint: `${f.config.oauth.authority}/oauth2/v2.0/token` },
    resourceMetadata: { ...discovery.resourceMetadata, authorization_servers: [`${f.config.oauth.authority}/v2.0`] } };
  const other = { ...f.config, oauth: { ...f.config.oauth, authority: `https://login.microsoftonline.com/${clientId}` } };
  assert.throws(() => entraServiceAuthority(other, tenantDiscovery), { code: 'oauth_invalid_issuer' });
  for (const authority of [undefined, 'https://login.microsoftonline.com/organizations',
    'https://login.microsoftonline.com/common', 'https://login.microsoftonline.com.evil.test/tenant']) {
    assert.throws(() => entraServiceAuthority({ ...f.config, oauth: { ...f.config.oauth, authority } }, discovery),
      { code: 'entra_tenant_authority_required' });
  }
  const provider = await BackendOAuthProvider.load(f.config, f.stateDir);
  assert.throws(() => new EntraOAuth(provider, discovery, 'api://test-resource/Mcp.Read', globalThis.fetch), { code: 'entra_invalid_scope' });
  assert.throws(() => validateBackendConfig({ ...f.config, name: undefined,
    oauth: { ...f.config.oauth, grantType: 'authorization_code' } }, 'test', { allowUnknown: true }));
  assert.throws(() => validateBackendConfig({ url: f.config.url,
    oauth: { ...f.config.oauth, tokenEndpointAuthMethod: 'client_secret_basic' } }));
  const valid = new EntraOAuth(provider, tenantDiscovery, 'api://test-resource/.default', globalThis.fetch);
  assert.throws(() => new EntraOAuth(provider, { ...tenantDiscovery,
    authorizationServerMetadata: { ...tenantDiscovery.authorizationServerMetadata, grant_types_supported: ['authorization_code'] } },
  'api://test-resource/.default', globalThis.fetch), { code: 'oauth_unsupported_flow' });
  assert.throws(() => new EntraOAuth(provider, { ...tenantDiscovery,
    authorizationServerMetadata: { ...tenantDiscovery.authorizationServerMetadata, token_endpoint_auth_methods_supported: ['private_key_jwt'] } },
  'api://test-resource/.default', globalThis.fetch), { code: 'oauth_client_auth_method' });
  assert.throws(() => new EntraOAuth(provider, tenantDiscovery, 'api://other-resource/.default', globalThis.fetch),
    { code: 'entra_invalid_scope' });
  assert.notEqual(valid.binding, new EntraOAuth(provider, { ...tenantDiscovery,
    resourceMetadata: { ...tenantDiscovery.resourceMetadata, resource: 'https://mcp.example/other' } },
  'api://test-resource/.default', globalThis.fetch).binding);
});

test('MSAL device-code explicit sign-in needs no browser or callback port and publishes reusable cache', async t => {
  publisherId(t, clientId);
  const f = await fixture(t);
  const occupied = createServer();
  await new Promise(resolve => occupied.listen(f.config.oauth.redirectPort, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  let prompts = 0;
  assert.deepEqual(await authenticateBackend(f.config, f.stateDir, { deviceCode: true, timeoutMs: 20_000,
    onAuthorization: () => assert.fail('device code must not open a browser'),
    onDeviceCode: prompt => {
      prompts++;
      assert.deepEqual(prompt, { verificationUri: 'https://microsoft.com/devicelogin', userCode: 'TEST-CODE' });
    } }), { authenticated: true, server: 'mail', discoveredTools: 1 });
  assert.equal(prompts, 1);
  const saved = await BackendOAuthProvider.load(f.config, f.stateDir);
  assert.ok(saved.saved.entra.cache);
  assert.doesNotMatch(await readFile(saved.path, 'utf8'), /private-device-code|TEST-CODE|untrusted-response-message/);
  const registry = new BackendRegistry(new Map([['mail', f.config]]), { stateDir: f.stateDir });
  try { assert.equal((await registry.callTool('mail', 'echo', {})).content[0].text, 'authenticated'); }
  finally { await registry.close(); }
  assert.equal(f.requests.filter(({ url }) => url.pathname.endsWith('/devicecode')).length, 1);
});

for (const failure of ['cancel', 'timeout', 'denied', 'unsafe']) {
  test(`MSAL device-code ${failure} is bounded, redacted and publishes no cache`, async t => {
    publisherId(t, clientId);
    const f = await fixture(t);
    f.deviceResult(failure === 'timeout' ? 'pending' : failure);
    const controller = new AbortController();
    let prompted = false;
    const started = Date.now();
    await assert.rejects(authenticateBackend(f.config, f.stateDir, { deviceCode: true,
      timeoutMs: failure === 'timeout' ? 5000 : 20_000, signal: controller.signal,
      onDeviceCode: () => {
        prompted = true;
        if (failure === 'cancel') controller.abort();
      },
      onAuthorization: () => assert.fail('device code must not open a browser') }), error =>
      error.code === (failure === 'unsafe' ? 'entra_invalid_device_code' :
        failure === 'denied' ? 'auth_required' : 'oauth_cancelled') &&
      !/private-device|TEST-CODE|untrusted-response/.test(error.message));
    assert.equal(prompted, failure !== 'unsafe');
    if (failure === 'timeout') assert.ok(Date.now() - started < 8000);
    const saved = await BackendOAuthProvider.load(f.config, f.stateDir);
    assert.equal(saved.saved.entra, undefined);
    assert.equal(saved.tokens(), undefined);
    assert.equal((await readdir(saved.directory)).some(file => file.endsWith('.lock')), false);
  });
}

test('device-code mode rejects generic providers without an advertised device endpoint', async t => {
  const stateDir = await mkdtemp(join(process.cwd(), '.gateway-entra-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const provider = await BackendOAuthProvider.load({ name: 'generic', url: 'https://mcp.example/mcp' },
    stateDir, { interactive: true, deviceCode: true });
  provider.saved.discovery = { authorizationServerUrl: 'https://generic.example',
    resourceMetadata: discovery.resourceMetadata, authorizationServerMetadata: { ...metadata, issuer: 'https://generic.example' } };
  await assert.rejects(provider.fetch(async () => new Response('{}', { status: 401,
    headers: { 'www-authenticate': 'Bearer' } }))('https://mcp.example/mcp'), { code: 'oauth_unsupported_flow' });
});

test('actual MSAL PCA browser PKCE, organizations, opaque token, private cache and restart refresh', async t => {
  publisherId(t, clientId);
  const f = await fixture(t);
  const provider = await BackendOAuthProvider.load(f.config, f.stateDir);
  const entra = new EntraOAuth(provider, discovery, undefined, globalThis.fetch);
  assert.ok(entra.pca instanceof PublicClientApplication);
  assert.deepEqual(await authenticateBackend(f.config, f.stateDir, { onAuthorization: f.browser, timeoutMs: 20_000 }),
    { authenticated: true, server: 'mail', discoveredTools: 1 });
  const saved = await BackendOAuthProvider.load(f.config, f.stateDir);
  assert.ok(saved.saved.entra.cache.includes('rotated-0'));
  assert.equal(saved.saved.entra.tenantId, tenantId);
  f.rejectToken();
  const registry = new BackendRegistry(new Map([['mail', f.config]]), { stateDir: f.stateDir });
  try {
    const results = await Promise.all([registry.callTool('mail', 'echo', {}), registry.callTool('mail', 'echo', {})]);
    assert.equal(results[0].content[0].text, 'authenticated');
    assert.equal(f.refreshes(), 1);
    f.rejectToken();
    await Promise.all([registry.callTool('mail', 'echo', {}), registry.callTool('mail', 'echo', {})]);
  } finally { await registry.close(); }
  assert.equal(f.refreshes(), 2);
  const refreshed = await BackendOAuthProvider.load(f.config, f.stateDir);
  assert.ok(refreshed.saved.entra.cache.includes('rotated-2'));
  f.denyRefresh();
  const failed = new EntraOAuth(refreshed, discovery, undefined, globalThis.fetch);
  await assert.rejects(failed.silent(refreshed.tokens().access_token), error =>
    error.code === 'auth_required' && !/private-token-response-body|rotated-2|opaque-access/.test(error.message));
  assert.equal((await BackendOAuthProvider.load(f.config, f.stateDir)).saved.entra.cache, refreshed.saved.entra.cache);
  process.env.SHARED_MCP_ENTRA_CLIENT_ID = tenantId;
  assert.equal((await BackendOAuthProvider.load(f.config, f.stateDir)).tokens(), undefined);
  const isolated = await BackendOAuthProvider.load({ ...f.config, name: 'other' }, f.stateDir);
  assert.equal(isolated.tokens(), undefined);
  assert.equal((await readdir(saved.directory)).some(file => file.endsWith('.lock') || file.endsWith('.tmp')), false);
  assert.doesNotMatch(await readFile(saved.path, 'utf8'), /test-code|code_verifier/);
});

test('explicit MSAL scope selection reacquires before initialize/list even when the existing token is accepted', async t => {
  publisherId(t, clientId);
  const f = await fixture(t);
  f.config.oauth.scopes = ['api://test-resource/Mcp.Read'];
  await authenticateBackend(f.config, f.stateDir, { onAuthorization: f.browser, timeoutMs: 20_000 });
  const before = await BackendOAuthProvider.load(f.config, f.stateDir);
  const start = f.requests.length;
  let prompts = 0;
  const requested = 'api://test-resource/McpServers.Mail.Read';
  await authenticateBackend(f.config, f.stateDir, { scopes: [requested], timeoutMs: 20_000,
    onAuthorization: async url => { prompts++; await f.browser(url); } });
  assert.equal(prompts, 1);
  const requests = f.requests.slice(start);
  const tokenIndex = requests.findIndex(({ url }) => url.pathname.endsWith('/token'));
  const initializeIndex = requests.findIndex(({ url, init }) => url.href === f.config.url &&
    init.method === 'POST' && JSON.parse(init.body).method === 'initialize');
  assert.ok(tokenIndex >= 0 && tokenIndex < initializeIndex);
  assert.ok(new URLSearchParams(requests[tokenIndex].init.body).get('scope').includes(requested));
  assert.equal(requests.some(({ url, init }) => url.href === f.config.url &&
    init.method === 'POST' && JSON.parse(init.body).method === 'tools/call'), false);
  const after = await BackendOAuthProvider.load(f.config, f.stateDir);
  assert.ok(after.saved.entra.scopes.includes(requested));
  assert.equal(after.saved.entra.homeAccountId, before.saved.entra.homeAccountId);
  assert.equal(after.saved.entra.tenantId, before.saved.entra.tenantId);
  assert.ok(after.tokens()?.access_token, 'configured initial scopes must not invalidate the expanded committed selection on reload');
  assert.equal(after.tokens().access_token, before.tokens().access_token,
    'a repeated opaque token must still publish the newly verified scope selection');
  const silentStart = f.requests.length;
  const credential = await after.microsoftCredential(after.saved.discovery, undefined, globalThis.fetch);
  assert.deepEqual(credential.scopes, after.saved.entra.scopes);
  await credential.silent();
  const registry = new BackendRegistry(new Map([[f.config.name, f.config]]), { stateDir: f.stateDir });
  try { await registry.connect(f.config.name); }
  finally { await registry.close(); }
  const silentRequests = f.requests.slice(silentStart);
  assert.equal(silentRequests.filter(({ url, init }) => url.href === f.config.url &&
    init.method === 'POST' && JSON.parse(init.body).method === 'initialize').length, 1,
    'ordinary initialization must succeed without a WWW-Authenticate challenge or retry');
  assert.equal(silentRequests.some(({ init }) =>
    new URLSearchParams(init.body).get('grant_type') === 'authorization_code'), false);
  assert.equal(prompts, 1, 'restart and silent acquisition cannot prompt for consent again');
  const changed = await BackendOAuthProvider.load({ ...f.config,
    oauth: { ...f.config.oauth, scopes: [requested] } }, f.stateDir);
  assert.notEqual(changed.path, after.path);
  assert.equal(changed.tokens(), undefined, 'operator configuration changes retain cache-identity isolation');
});

test('unprovisioned publisher and ordinary lazy calls never open a browser', async t => {
  publisherId(t, '');
  const f = await fixture(t);
  await assert.rejects(authenticateBackend(f.config, f.stateDir, { timeoutMs: 20_000,
    onAuthorization: () => assert.fail('must not open browser') }), { code: 'entra_publisher_registration_required' });
  await assert.rejects(authenticateBackend(f.config, f.stateDir, { deviceCode: true, timeoutMs: 20_000,
    onDeviceCode: () => assert.fail('must not request device sign-in') }), { code: 'entra_publisher_registration_required' });
  assert.equal(f.requests.some(({ url }) => url.pathname.endsWith('/devicecode')), false);
  process.env.SHARED_MCP_ENTRA_CLIENT_ID = clientId;
  const registry = new BackendRegistry(new Map([['mail', f.config]]), { stateDir: f.stateDir });
  try { await assert.rejects(registry.connect('mail'), { code: 'auth_required' }); }
  finally { await registry.close(); }
  assert.equal(f.requests.some(({ url }) => url.pathname.endsWith('/token')), false);
});

for (const failure of ['state', 'cancel', 'denied', 'timeout']) {
  test(`Entra ${failure} cleans callback and publishes no cache`, async t => {
    publisherId(t, clientId);
    const f = await fixture(t);
    const controller = new AbortController();
    await assert.rejects(authenticateBackend(f.config, f.stateDir, { timeoutMs: failure === 'timeout' ? 5000 : 20_000, signal: controller.signal,
      onAuthorization: async url => {
        if (failure === 'timeout') return;
        if (failure === 'cancel') { controller.abort(); return; }
        const callback = new URL(url.searchParams.get('redirect_uri'));
        callback.searchParams.set('state', failure === 'state' ? 'wrong' : url.searchParams.get('state'));
        callback.searchParams.set(failure === 'denied' ? 'error' : 'code', failure === 'denied' ? 'access_denied' : 'test-code');
        assert.equal((await fetch(callback)).status, 400);
      } }), { code: failure === 'state' ? 'oauth_invalid_state' : failure === 'denied' ? 'oauth_denied' : 'oauth_cancelled' });
    const provider = await BackendOAuthProvider.load(f.config, f.stateDir);
    assert.equal(provider.saved.entra, undefined);
    assert.equal(provider.tokens(), undefined);
    const server = createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(f.config.oauth.redirectPort, '127.0.0.1', resolve); });
    await new Promise(resolve => server.close(resolve));
  });
}
