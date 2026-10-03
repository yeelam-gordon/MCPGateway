import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createGateway } from '../src/gateway-server.js';
import { GatewayError } from '../src/errors.js';
import { BackendRegistry } from '../src/backend-registry.js';
import { authenticateBackend, BackendOAuthProvider, OAuthHTTPClientTransport, boundedOAuthFetch, oauthRequired } from '../src/backend-oauth.js';
import { validateBackendConfig } from '../src/config-schema.js';

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
async function mock(t, { dcr = true, oidc = false, wrongResource = false, rotating = false, invalidRefresh = false,
  registration = {}, advertisedMethods = ['none'], authStatus = 401, issRequired, callbackIss } = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-oauth-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const counter = { registrations: 0, refreshes: 0, calls: 0, discoveries: 0, resourceFetches: 0, refreshTokens: [], bareBearer: 0, tokenExchanges: 0 };
  let authorization;
  let base;
  let token = 'initial-access';
  let refreshToken = 'persistent-refresh';
  const metadata = () => ({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'] });
  const server = createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const path = req.url.split('?')[0];
    if (path === '/resource') {
      counter.resourceFetches++;
      return json(200, {
      resource: wrongResource ? 'https://different.example/mcp' : `${base}/mcp`,
      authorization_servers: [base], scopes_supported: ['tools']
      });
    }
    if (path.startsWith('/.well-known/')) {
      if (oidc && path.includes('oauth-authorization-server')) return json(404, {});
      counter.discoveries++;
      return json(200, { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`,
        ...(oidc ? { jwks_uri: `${base}/jwks`, subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] } : {}),
        ...(dcr ? { registration_endpoint: `${base}/register` } : {}),
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        ...(issRequired === undefined ? {} : { authorization_response_iss_parameter_supported: issRequired }),
        token_endpoint_auth_methods_supported: advertisedMethods, code_challenge_methods_supported: ['S256'] });
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    if (path === '/register') {
      counter.registrations++;
      const metadata = JSON.parse(body);
      assert.equal(metadata.token_endpoint_auth_method, 'none');
      return json(201, { ...metadata, client_id: 'registered-public-client', ...registration });
    }
    if (path === '/token') {
      counter.tokenExchanges++;
      const params = new URLSearchParams(body);
      assert.equal(params.get('resource'), `${base}/mcp`);
      assert.ok(params.get('client_id'));
      if (params.get('grant_type') === 'refresh_token') {
        counter.refreshes++;
        counter.refreshTokens.push(params.get('refresh_token'));
        if (invalidRefresh || params.get('refresh_token') !== refreshToken) return json(400, { error: 'invalid_grant', error_description: 'private-token-body' });
        if (rotating) {
          refreshToken = `rotated-refresh-${counter.refreshes}`;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        token = `refreshed-${counter.refreshes}`;
        return json(200, { access_token: token, token_type: 'Bearer', expires_in: 3600,
          ...(rotating ? { refresh_token: refreshToken } : {}) });
      }
      assert.equal(params.get('code'), 'one-use-code');
      assert.equal(params.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
      assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'));
      return json(200, { access_token: token, refresh_token: 'persistent-refresh', token_type: 'Bearer', expires_in: 0 });
    }
    if (path !== '/mcp') return json(404, {});
    if (req.headers.authorization === 'Bearer') { counter.bareBearer++; return json(400, { error: 'invalid_request' }); }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${base}/resource"${authStatus === 403 ? ', error="insufficient_scope", scope="tools"' : ''}`);
      return json(authStatus, {});
    }
    if (req.method === 'GET') return json(405, {});
    if (req.method === 'DELETE') { res.writeHead(200).end(); return; }
    const message = JSON.parse(body);
    if (!Object.hasOwn(message, 'id')) { res.writeHead(202).end(); return; }
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'protected-mock', version: '1' } };
    if (message.method === 'tools/list') result = { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] };
    if (message.method === 'tools/call') { counter.calls++; result = { content: [{ type: 'text', text: 'authenticated' }] }; }
    json(200, { jsonrpc: '2.0', id: message.id, result });
  });

  base = `http://127.0.0.1:${await listen(server)}`;
  const reservation = createServer();
  const callbackPort = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const config = { name: 'arbitrary alias / mail', url: `${base}/mcp`, oauth: { redirectPort: callbackPort } };
  const browser = async url => {
    authorization = url;
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('resource'), `${base}/mcp`);
    assert.ok(url.searchParams.get('state'));
    const callback = new URL(url.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', url.searchParams.get('state'));
    callback.searchParams.set('code', 'one-use-code');
    for (const issuer of callbackIss ?? []) callback.searchParams.append('iss', issuer === 'bound' ? base : issuer);
    assert.equal((await fetch(callback, { method: 'POST' })).status, 400);
    assert.equal((await fetch(callback, { headers: { Origin: 'https://foreign.example' } })).status, 400);
    assert.equal(await new Promise((resolve, reject) => {
      const req = request(callback, { headers: { Host: 'foreign.example' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      req.once('error', reject);
      req.end();
    }), 400);
    const wrongPath = new URL(callback);
    wrongPath.pathname = '/different';
    assert.equal((await fetch(wrongPath)).status, 400);
    const response = await fetch(callback);
    assert.equal(response.status, callbackIss?.some(issuer => issuer !== 'bound') || callbackIss?.length > 1 ||
      (issRequired && !callbackIss?.length) ? 400 : 200);
  };
  return { config, stateDir, counter, browser, base,
    rejectAccess: () => { token = 'revoked-access'; },
    correctResource: () => { wrongResource = false; },
    discovery: () => ({ authorizationServerUrl: base, resourceMetadataUrl: `${base}/resource`,
      authorizationServerMetadata: metadata(), resourceMetadata: { resource: `${base}/mcp`, authorization_servers: [base] } })
  };
}

for (const [name, issRequired, callbackIss, succeeds] of [
  ['optional absent', false, undefined, true],
  ['optional exact', false, ['bound'], true],
  ['required exact', true, ['bound'], true],
  ['required absent', true, undefined, false],
  ['optional mismatch', false, ['https://wrong.example'], false],
  ['duplicate exact', true, ['bound', 'bound'], false],
  ['required OIDC absent', true, undefined, false]
]) {
  test(`generic callback issuer: ${name}`, async t => {
    const f = await mock(t, { issRequired, callbackIss, oidc: name.includes('OIDC') });
    const operation = authenticateBackend(f.config, f.stateDir, { onAuthorization: f.browser, timeoutMs: 20_000 });
    if (succeeds) await operation;
    else {
      await assert.rejects(operation, error => error.code === 'oauth_invalid_issuer');
      assert.equal(f.counter.tokenExchanges, 0);
      assert.equal((await BackendOAuthProvider.load(f.config, f.stateDir)).tokens(), undefined);
    }
  });
}

async function seed(fixture, expires_in = 3600) {
  const { config, stateDir } = fixture;
  const provider = await BackendOAuthProvider.load(config, stateDir);
  provider.saved.discovery = fixture.discovery();
  provider.saved.client = { client_id: 'registered-public-client' };
  await provider.saveTokens({ access_token: 'initial-access', refresh_token: 'persistent-refresh', token_type: 'Bearer', expires_in });
  return provider;
}

test('AUTH-PORTFOLIO-002 pending code/device publication retains acquisition expiry and refresh rotation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gateway-oauth-expiry-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const config = { name: 'expiry', url: 'https://mcp.example/mcp', oauth: { clientId: 'registered' } };
  const provider = await BackendOAuthProvider.load(config, directory, { interactive: true });
  await provider.saveTokens({ access_token: 'first', refresh_token: 'rotated', token_type: 'Bearer', expires_in: 31 });
  t.mock.timers.tick(10_000);
  await provider.saveTokens({ access_token: 'second', token_type: 'Bearer', expires_in: 60 });
  const expiry = Date.now() + 60_000;
  t.mock.timers.tick(30_000);
  await provider.commitTokens();
  assert.equal(provider.saved.expiresAt, expiry);
  assert.equal(provider.saved.tokens.refresh_token, 'rotated');
  assert.equal(provider.pendingExpiresAt, undefined);
  assert.equal((await BackendOAuthProvider.load(config, directory)).saved.expiresAt, expiry);
  await provider.saveTokens({ access_token: 'device', token_type: 'Bearer' }, true);
  t.mock.timers.tick(30_000);
  await provider.commitTokens();
  assert.equal(provider.saved.expiresAt, undefined);
  assert.equal(provider.saved.tokens.refresh_token, undefined);
});

test('SDK OAuth challenge, DCR, PKCE, discovery, call and restart refresh persistence', async t => {
  const fixture = await mock(t);
  const { config, stateDir, counter, browser } = fixture;
  assert.deepEqual(await authenticateBackend(config, stateDir, { onAuthorization: browser, timeoutMs: 20_000 }),
    { authenticated: true, server: config.name, discoveredTools: 1 });
  assert.equal(counter.registrations, 1);
  fixture.rejectAccess();
  for (let restart = 0; restart < 2; restart++) {
    const registry = new BackendRegistry(new Map([[config.name, config]]), { stateDir });
    try {
      const result = await registry.callTool(config.name, 'echo', {});
      assert.equal(result.content[0].text, 'authenticated');
    } finally { await registry.close(); }
  }
  assert.equal(counter.refreshes, 1);
  assert.equal(counter.calls, 2);
  const provider = await BackendOAuthProvider.load(config, stateDir);
  assert.equal(provider.saved.tokens.refresh_token, 'persistent-refresh');
  assert.equal((await readdir(provider.directory)).some(file => file.endsWith('.tmp')), false);
  for (const changed of [{ ...config, name: 'other' }, { ...config, url: `${fixture.base}/other` }, { ...config, oauth: { ...config.oauth, clientId: 'other' } }]) {
    const isolated = await BackendOAuthProvider.load(changed, stateDir);
    assert.equal(isolated.tokens(), undefined);
  }
});

test('pre-registered Entra-style public client works through OIDC fallback without DCR', async t => {
  const { config, stateDir, browser, counter } = await mock(t, { dcr: false, oidc: true });
  config.oauth.clientId = 'tenant-approved-public-client';
  config.oauth.scopes = ['tools', 'offline_access'];
  await authenticateBackend(config, stateDir, { onAuthorization: browser, timeoutMs: 20_000 });
  assert.equal(counter.registrations, 0);
  assert.ok(counter.discoveries);
});

test('missing registration is actionable and never opens browser', async t => {
  const { config, stateDir } = await mock(t, { dcr: false });
  await assert.rejects(authenticateBackend(config, stateDir, { onAuthorization: () => assert.fail('must not open'), timeoutMs: 20_000 }),
    error => error.code === 'oauth_registration_required' && /oauth.clientId/.test(error.message));
});

test('lazy connect requires explicit sign-in without browser or DCR', async t => {
  const { config, stateDir, counter } = await mock(t);
  const registry = new BackendRegistry(new Map([[config.name, config]]), { stateDir });
  try { await assert.rejects(registry.connect(config.name), error => error.code === 'auth_required' && /authenticate-backend/.test(error.message)); }
  finally { await registry.close(); }
  assert.equal(counter.registrations, 0);
});

for (const failure of ['state', 'denied', 'timeout', 'cancel']) {
  test(`${failure} closes callback and stores no tokens`, async t => {
    const { config, stateDir } = await mock(t);
    const controller = new AbortController();
    const started = Date.now();
    await assert.rejects(authenticateBackend(config, stateDir, { timeoutMs: failure === 'timeout' ? 2500 : 20_000,
      signal: controller.signal, onAuthorization: async url => {
        if (failure === 'timeout') return;
        if (failure === 'cancel') { controller.abort(); return; }
        const callback = new URL(url.searchParams.get('redirect_uri'));
        callback.searchParams.set('state', failure === 'state' ? 'wrong' : url.searchParams.get('state'));
        callback.searchParams.set(failure === 'denied' ? 'error' : 'code', failure === 'denied' ? 'access_denied' : 'secret-code');
        assert.equal((await fetch(callback)).status, 400);
      } }), error => ['oauth_invalid_state', 'oauth_denied', 'oauth_cancelled', 'oauth_failed'].includes(error.code));
    const provider = await BackendOAuthProvider.load(config, stateDir);
    if (failure === 'timeout') assert.ok(Date.now() - started < 6000, 'bounded timeout includes ACL cleanup');
    assert.equal(provider.tokens(), undefined);
    const replacement = createServer();
    await new Promise((resolve, reject) => { replacement.once('error', reject); replacement.listen(config.oauth.redirectPort, '127.0.0.1', resolve); });
    await new Promise(resolve => replacement.close(resolve));
    for (const file of await readdir(join(stateDir, 'oauth'))) {
      assert.doesNotMatch(await readFile(join(stateDir, 'oauth', file), 'utf8'), /secret-code|code_verifier|access_token/);
    }
  });
}

test('SDK resource validation is not overridden', async t => {
  const { config, stateDir } = await mock(t, { wrongResource: true });
  await assert.rejects(authenticateBackend(config, stateDir, { onAuthorization: () => assert.fail(), timeoutMs: 20_000 }),
    error => error.code === 'oauth_invalid_resource');
  assert.equal((await BackendOAuthProvider.load(config, stateDir)).tokens(), undefined);
});

test('OAUTH-001 concurrent registry calls share one rotated refresh and retain credentials', async t => {
  const fixture = await mock(t, { rotating: true });
  const { config, stateDir, counter } = fixture;
  await seed(fixture);
  const registry = new BackendRegistry(new Map([[config.name, config]]), { stateDir });
  t.after(() => registry.close());
  await registry.getTool(config.name, 'echo');
  fixture.rejectAccess();
  const results = await Promise.all([registry.callTool(config.name, 'echo', {}), registry.callTool(config.name, 'echo', {})]);
  for (const result of results) assert.equal(result.content[0].text, 'authenticated');
  assert.deepEqual(counter.refreshTokens, ['persistent-refresh']);
  const reloaded = await BackendOAuthProvider.load(config, stateDir);
  assert.equal(reloaded.tokens().refresh_token, 'rotated-refresh-1');
  const restarted = new BackendRegistry(new Map([[config.name, config]]), { stateDir });
  try { await restarted.callTool(config.name, 'echo', {}); } finally { await restarted.close(); }
  assert.equal(counter.refreshes, 1);
  fixture.rejectAccess();
  await Promise.all([registry.callTool(config.name, 'echo', {}), registry.callTool(config.name, 'echo', {})]);
  assert.deepEqual(counter.refreshTokens, ['persistent-refresh', 'rotated-refresh-1']);
});

test('OAUTH-001 stale credential invalidation cannot erase a newer generation', async t => {
  const fixture = await mock(t);
  const provider = await seed(fixture);
  let failOld;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const stale = provider.runRequest(async () => {
    started();
    await new Promise(resolve => { failOld = resolve; });
    await provider.invalidateCredentials('tokens');
  });
  await ready;
  await provider.runRequest(() => provider.saveTokens({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer' }));
  failOld();
  await stale;
  assert.equal((await BackendOAuthProvider.load(fixture.config, fixture.stateDir)).tokens().refresh_token, 'new-refresh');
});

test('OAUTH-002 expired access remains syntactically valid and refreshes after 401, not bare Bearer 400', async t => {
  const fixture = await mock(t);
  await seed(fixture, 0);
  fixture.rejectAccess();
  const registry = new BackendRegistry(new Map([[fixture.config.name, fixture.config]]), { stateDir: fixture.stateDir });
  try { await registry.connect(fixture.config.name); } finally { await registry.close(); }
  assert.equal(fixture.counter.bareBearer, 0);
  assert.equal(fixture.counter.refreshes, 1);
});

test('OAUTH-003 rejected metadata is not cached and corrected metadata is rediscovered', async t => {
  const fixture = await mock(t, { wrongResource: true });
  const { config, stateDir, browser, counter } = fixture;
  await assert.rejects(authenticateBackend(config, stateDir, { onAuthorization: browser, timeoutMs: 20_000 }),
    error => error.code === 'oauth_invalid_resource');
  assert.equal((await BackendOAuthProvider.load(config, stateDir)).saved.discovery, undefined);
  fixture.correctResource();
  await authenticateBackend(config, stateDir, { onAuthorization: browser, timeoutMs: 20_000 });
  assert.equal(counter.resourceFetches, 2);
  assert.equal((await BackendOAuthProvider.load(config, stateDir)).saved.discovery.resourceMetadata.resource, config.url);
});

test('OAUTH-003 old poisoned discovery is discarded before retrying corrected metadata', async t => {
  const fixture = await mock(t);
  const provider = await seed(fixture);
  provider.saved.discovery.resourceMetadata.resource = 'https://wrong.example/mcp';
  await provider.persist();
  await authenticateBackend(fixture.config, fixture.stateDir, { onAuthorization: fixture.browser, timeoutMs: 20_000 });
  assert.equal(fixture.counter.resourceFetches, 1);
});

test('standalone invalid_grant clears rejected credentials and reports explicit sign-in without body leakage', async t => {
  const fixture = await mock(t, { invalidRefresh: true });
  await seed(fixture);
  fixture.rejectAccess();
  const registry = new BackendRegistry(new Map([[fixture.config.name, fixture.config]]), { stateDir: fixture.stateDir });
  try {
    await assert.rejects(registry.connect(fixture.config.name), error => error.code === 'auth_required' && !error.message.includes('private-token-body'));
  } finally { await registry.close(); }
  assert.equal((await BackendOAuthProvider.load(fixture.config, fixture.stateDir)).tokens(), undefined);
});

test('cross-process concurrent sign-in is rejected before mutation and CLI help works outside checkout', async t => {
  const fixture = await mock(t);
  const { config, stateDir } = fixture;
  const configPath = join(stateDir, 'backends.json');
  const { name, ...settings } = config;
  await writeFile(configPath, JSON.stringify({ mcpServers: { [name]: settings } }));
  const command = fileURLToPath(new URL('../tools/authenticate-backend.mjs', import.meta.url));
  const run = promisify(execFile);
  assert.match((await run(process.execPath, [command, '--help'], { cwd: stateDir })).stdout, /Usage:/);
  const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const first = authenticateBackend(config, stateDir, { signal: controller.signal, timeoutMs: 20_000,
    onAuthorization: () => { started(); } });
  first.catch(() => {});
  try {
    await ready;
    const before = await BackendOAuthProvider.load(config, stateDir);
    const bytes = await readFile(before.path);
    await assert.rejects(run(process.execPath, [command, '--server', config.name, '--config', configPath,
      '--state-dir', stateDir, '--no-browser'], { cwd: stateDir, timeout: 10_000 }),
      error => /credentials are in use/.test(error.stderr) && !error.stdout.includes('Open this sign-in URL'));
    assert.deepEqual(await readFile(before.path), bytes);
  } finally {
    controller.abort();
    await assert.rejects(first);
  }
  assert.equal((await readdir(join(stateDir, 'oauth'))).some(file => file.endsWith('.lock')), false);
});

test('cross-provider refresh lock rejects competing owner and later reload uses rotated state', async t => {
  const fixture = await mock(t, { rotating: true });
  const first = await seed(fixture);
  const second = await BackendOAuthProvider.load(fixture.config, fixture.stateDir);
  const release = await first.acquireLock();
  try {
    const fetch = second.fetch(boundedOAuthFetch());
    await assert.rejects(fetch(`${fixture.base}/token`, { method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'persistent-refresh', resource: fixture.config.url, client_id: 'registered-public-client' }) }),
      error => error.code === 'oauth_busy');
  } finally { await release(); }
  const request = { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token',
    refresh_token: 'persistent-refresh', resource: fixture.config.url, client_id: 'registered-public-client' }) };
  await first.fetch(boundedOAuthFetch())(`${fixture.base}/token`, request);
  await second.fetch(boundedOAuthFetch())(`${fixture.base}/token`, request);
  assert.equal(fixture.counter.refreshes, 1);
  assert.equal(second.tokens().refresh_token, 'rotated-refresh-1');
});

test('OAuth config is strict and rejects unsafe URLs and unsupported grants', () => {
  for (const oauth of [{ clientSecret: 'secret' }, { redirectPort: 0 }, { scopes: ['bad scope'] }, { clientMetadataUrl: 'http://example.com/client' }]) {
    assert.throws(() => validateBackendConfig({ url: 'https://example.com/mcp', oauth }));
  }
  for (const url of ['http://remote.example/mcp', 'https://user:password@example.com/mcp', 'https://example.com/mcp#fragment']) {
    assert.throws(() => validateBackendConfig({ url, oauth: {} }));
  }
  assert.throws(() => validateBackendConfig({ command: 'node', oauth: {} }));
});

test('static authorization bypasses OAuth even with a state directory', async t => {
  const { config, stateDir, counter } = await mock(t);
  config.headers = { aUtHoRiZaTiOn: 'Bearer initial-access' };
  const registry = new BackendRegistry(new Map([[config.name, config]]), { stateDir });
  try { assert.equal((await registry.callTool(config.name, 'echo', {})).content[0].text, 'authenticated'); }
  finally { await registry.close(); }
  assert.equal(counter.registrations, 0);
  assert.equal(counter.discoveries, 0);
  await assert.rejects(authenticateBackend(config, stateDir), error => error.code === 'oauth_not_applicable');
});

test('fetch rejects redirects and unsafe remote HTTP without exposing response bodies', async t => {
  const server = createServer((req, res) => {
    if (req.url === '/redirect') res.writeHead(302, { Location: '/secret' }).end();
    else res.writeHead(500).end('private-response-token');
  });
  const port = await listen(server);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const request = boundedOAuthFetch();
  await assert.rejects(request(`http://127.0.0.1:${port}/redirect`));
  await assert.rejects(request(`http://127.0.0.1:${port}/error`), error => !error.message.includes('private-response-token'));
  await assert.rejects(request('http://remote.example/mcp'));
});


const confidentialRegistrations = [
  { client_secret: 'synthetic-secret-do-not-log' },
  { token_endpoint_auth_method: 'client_secret_post' },
  { client_secret: 'synthetic-secret-do-not-log', token_endpoint_auth_method: 'client_secret_post' }
];

test('OAUTH-R3-001 rejected registrations leave an existing public client unchanged in memory and on disk', async t => {
  const fixture = await mock(t);
  const provider = await seed(fixture);
  const before = await readFile(provider.path);
  const client = structuredClone(provider.saved.client);
  for (const registration of [...confidentialRegistrations, { client_secret: '' }]) {
    await assert.rejects(provider.saveClientInformation({ client_id: 'replacement', ...registration }),
      error => error.code === 'oauth_confidential_client' && !error.message.includes('synthetic-secret'));
    assert.deepEqual(provider.saved.client, client);
    assert.deepEqual(await readFile(provider.path), before);
  }
});

for (const [index, registration] of confidentialRegistrations.entries()) {
  test(`OAUTH-R3-001 rejects confidential DCR variant ${index} before storage or exchange`, async t => {
    const fixture = await mock(t, { registration, advertisedMethods: ['none', 'client_secret_post'] });
    await assert.rejects(authenticateBackend(fixture.config, fixture.stateDir, {
      onAuthorization: fixture.browser, timeoutMs: 20_000
    }), error => error.code === 'oauth_confidential_client' && !error.message.includes('synthetic-secret'));
    const provider = await BackendOAuthProvider.load(fixture.config, fixture.stateDir);
    assert.equal(provider.saved.client, undefined);
    assert.equal(provider.tokens(), undefined);
    assert.equal(fixture.counter.tokenExchanges, 0);
    for (const file of await readdir(provider.directory)) {
      assert.doesNotMatch(await readFile(join(provider.directory, file), 'utf8'), /synthetic-secret/);
    }
  });

  test(`OAUTH-R3-001 rejects cached confidential variant ${index} without mutation or exchange`, async t => {
    const fixture = await mock(t);
    const provider = await seed(fixture);
    provider.saved.client = { client_id: 'registered-public-client', ...registration };
    await provider.persist();
    const before = await readFile(provider.path);
    const cached = await BackendOAuthProvider.load(fixture.config, fixture.stateDir);
    const originalClient = structuredClone(cached.saved.client);
    assert.throws(() => cached.clientInformation(),
      error => error.code === 'oauth_confidential_client' && !error.message.includes('synthetic-secret'));
    assert.deepEqual(cached.saved.client, originalClient);
    fixture.rejectAccess();
    const registry = new BackendRegistry(new Map([[fixture.config.name, fixture.config]]), { stateDir: fixture.stateDir });
    try {
      await assert.rejects(registry.connect(fixture.config.name),
        error => error.code === 'oauth_confidential_client' && !error.message.includes('synthetic-secret'));
    } finally { await registry.close(); }
    assert.equal(fixture.counter.tokenExchanges, 0);
    assert.deepEqual(await readFile(provider.path), before);
  });
}

for (const method of [undefined, 'none']) {
  test(`OAUTH-R3-001 accepts public DCR with ${method ?? 'omitted'} method despite confidential AS capabilities`, async t => {
    const fixture = await mock(t, { registration: { token_endpoint_auth_method: method },
      advertisedMethods: ['none', 'client_secret_post', 'client_secret_basic'] });
    await authenticateBackend(fixture.config, fixture.stateDir, { onAuthorization: fixture.browser, timeoutMs: 20_000 });
    const cached = await BackendOAuthProvider.load(fixture.config, fixture.stateDir);
    assert.equal(cached.clientInformation().client_id, 'registered-public-client');
    assert.equal(cached.clientInformation().client_secret, undefined);
    assert.equal(fixture.counter.tokenExchanges, 1);
  });
}

test('OAUTH-R3-002 SDK notification stream outlives request deadline and closes on cancellation', async t => {
  let gets = 0;
  let streamClosed;
  const closed = new Promise(resolve => { streamClosed = resolve; });
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      gets++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const notify = data => res.write(`event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data }
      })}\n\n`);
      notify('initial');
      const timer = gets === 1 ? setTimeout(() => notify('delayed'), 600) : undefined;
      res.on('close', () => { clearTimeout(timer); streamClosed(); });
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    if (!Object.hasOwn(message, 'id')) { res.writeHead(202).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: '2025-11-25', capabilities: { logging: {} }, serverInfo: { name: 'notification-test', version: '1' }
      }
    }));
  });
  const port = await listen(server);
  const controller = new AbortController();
  const config = { name: 'notifications', url: `http://127.0.0.1:${port}/mcp` };
  const provider = new BackendOAuthProvider(config, tmpdir(), {});
  const transport = new OAuthHTTPClientTransport(new URL(config.url), {
    authProvider: provider, fetch: boundedOAuthFetch(controller.signal, 200, config),
    reconnectionOptions: { initialReconnectionDelay: 20, maxReconnectionDelay: 20, reconnectionDelayGrowFactor: 1, maxRetries: 1 }
  });
  const client = new Client({ name: 'notification-test', version: '1' });
  t.after(async () => {
    await client.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const notifications = [];
  const errors = [];
  let received;
  const delayed = new Promise(resolve => { received = resolve; });
  client.onerror = error => { errors.push(error); };
  client.setNotificationHandler(LoggingMessageNotificationSchema, notification => {
    notifications.push(notification.params.data);
    if (notification.params.data === 'delayed') received(true);
  });
  await client.connect(transport, { timeout: 1000 });
  const timer = setTimeout(() => received(false), 1500);
  try { assert.equal(await delayed, true, 'notification after 600ms must survive the 200ms request deadline'); }
  finally { clearTimeout(timer); }
  assert.deepEqual(notifications, ['initial', 'delayed']);
  assert.equal(gets, 1);
  assert.equal(errors.length, 0);
  controller.abort();
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('stream did not close on cancellation')), 1000).unref())]);
});

test('OAUTH-R3-002 notification headers are bounded; other GET and POST bodies retain deadlines and redirects stay blocked', async t => {
  let redirectedRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/no-headers') return;
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/target' }).end(); return; }
    if (req.url === '/target') redirectedRequests++;
    res.writeHead(200, { 'Content-Type': req.url === '/json-body' ? 'application/json' : 'text/event-stream' });
    res.write(': initial\n\n');
  });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const request = boundedOAuthFetch(undefined, 150, { url: `${base}/no-headers` });
  const started = Date.now();
  await assert.rejects(request(`${base}/no-headers`, { method: 'GET', headers: { Accept: 'text/event-stream' } }));
  assert.ok(Date.now() - started < 1000, 'notification header establishment must remain bounded');
  for (const [path, method, accept] of [
    ['/metadata', 'GET', 'text/event-stream'],
    ['/post', 'POST', 'text/event-stream'],
    ['/other', 'GET', 'application/json, text/event-stream'],
    ['/json-body', 'GET', 'text/event-stream']
  ]) {
    const config = { url: `${base}${path === '/metadata' ? '/other-backend' : path}` };
    const fetch = boundedOAuthFetch(undefined, 150, config);
    const url = `${base}${path}`;
    const response = await fetch(url, { method, headers: { Accept: accept } });
    const reader = response.body.getReader();
    assert.equal((await reader.read()).done, false);
    await assert.rejects(reader.read());
  }
  const redirect = boundedOAuthFetch(undefined, 150, { url: `${base}/redirect` });
  await assert.rejects(redirect(`${base}/redirect`, { method: 'GET', headers: { Accept: 'text/event-stream' } }));
  assert.equal(redirectedRequests, 0);
});

for (const status of [401, 403]) {
  test(`ready exclusive backend recovers from rejected tool POST ${status} after explicit reauthentication`, async t => {
    const fixture = await mock(t, { invalidRefresh: true, authStatus: status });
    const { config, stateDir, counter } = fixture;
    config.requiresExclusiveAccess = true;
    await seed(fixture);
    const registry = new BackendRegistry(new Map([[config.name, config]]), { stateDir });
    const token = 'oauth-lease-test-token';
    const gateway = createGateway({ registry, token, port: 0 });
    const address = await gateway.listen();
    const clients = [];
    t.after(async () => {
      await Promise.all(clients.map(client => client.close()));
      await gateway.close();
    });
    for (const name of ['original-owner', 'next-owner']) {
      const client = new Client({ name, version: '1' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      clients.push(client);
    }
    const decode = result => JSON.parse(result.content[0].text);
    const [owner, next] = clients;
    assert.equal(decode(await owner.callTool({ name: 'claim_server', arguments: { server: config.name } })).claimed, true);
    await registry.getTool(config.name, 'echo');
    assert.equal(registry.entries.get(config.name).state, 'ready');
    fixture.rejectAccess();
    const failed = decode(await owner.callTool({ name: 'call_tool', arguments: { server: config.name, tool: 'echo', arguments: {} } }));
    assert.equal(failed.error, 'auth_required');
    assert.doesNotMatch(failed.message, /outcome is unknown|restart gateway/);
    assert.equal(counter.calls, 0);
    assert.equal(counter.refreshes, 1);
    assert.equal(decode(await owner.callTool({ name: 'release_server', arguments: { server: config.name } })).released, true);
    assert.equal(decode(await next.callTool({ name: 'claim_server', arguments: { server: config.name } })).claimed, true);
    await authenticateBackend(config, stateDir, { onAuthorization: fixture.browser, timeoutMs: 20_000 });
    assert.equal(counter.calls, 0);
    const completed = await next.callTool({ name: 'call_tool', arguments: { server: config.name, tool: 'echo', arguments: {} } });
    assert.equal(completed.isError, undefined);
    assert.equal(counter.calls, 1);
    assert.equal(decode(await next.callTool({ name: 'release_server', arguments: { server: config.name } })).released, true);
  });
}

for (const scenario of ['notification-get', 'accepted-post', 'rejected-post-then-get', 'post-network-failure']) {
  test(`authentication error from ${scenario} remains an unknown tool outcome`, async () => {
    const config = { name: 'exclusive', url: 'https://example.test/mcp', requiresExclusiveAccess: true };
    const provider = new BackendOAuthProvider(config, tmpdir(), {});
    const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: {} } };
    const fetch = provider.fetch(async (_url, init) => {
      if (scenario === 'post-network-failure') throw new Error('Connection lost before response');
      if (init.method === 'GET') throw oauthRequired(config.name);
      if (scenario === 'rejected-post-then-get') return new Response('{}', {
        status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://example.test/resource"' }
      });
      return new Response('accepted', { status: 200 });
    });
    const client = {
      async callTool() {
        return provider.runRequest(async () => {
          if (scenario !== 'notification-get') {
            try { await fetch(config.url, { method: 'POST', body: JSON.stringify(message) }); }
            catch (error) { if (scenario !== 'post-network-failure') throw error; }
          }
          if (scenario === 'notification-get' || scenario === 'rejected-post-then-get') await fetch(config.url, { method: 'GET' });
          throw oauthRequired(config.name);
        }, message);
      },
      async close() {}
    };
    const registry = new BackendRegistry(new Map([[config.name, config]]));
    registry.entries.set(config.name, { state: 'ready', client, transport: null,
      tools: new Map([['echo', { name: 'echo', inputSchema: { type: 'object' } }]]) });
    await assert.rejects(registry.callTool(config.name, 'echo', {}), error => {
      assert.ok(error instanceof GatewayError);
      assert.equal(error.code, 'auth_required');
      assert.equal(error.outcomeUnknown, true);
      assert.match(error.message, /server remains blocked/);
      return true;
    });
    await registry.close();
  });
}
