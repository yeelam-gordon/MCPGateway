import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { constants, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BackendOAuthProvider, authenticateBackend, boundedOAuthFetch } from '../src/backend-oauth.js';
import { BackendRegistry } from '../src/backend-registry.js';
import { validateBackendConfig } from '../src/config-schema.js';
import { acquireServiceTokens } from '../src/oauth-client-auth.js';

async function fixture(t, method, grantType = 'authorization_code') {
  const directory = await mkdtemp(join(tmpdir(), 'oauth-service-test-'));
  const requests = [];
  const counts = { calls: 0, browsers: 0, registrations: 0 };
  let base;
  let rejected = false;
  let badLifetime = false;
  let tokenLifetime = 3600;
  let fixedToken;
  let denied = false;
  let scopes = 'least';
  const server = createServer(async (req, res) => {
    const json = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    if (req.url === '/resource') return json(200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['fallback'] });
    if (req.url.startsWith('/.well-known/')) return json(200, { issuer: base,
      authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`,
      response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: [method], grant_types_supported: [grantType, 'refresh_token'] });
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.url === '/token') {
      requests.push({ headers: req.headers, params: new URLSearchParams(body), receivedAt: Date.now() });
      if (denied) return json(400, { error: 'invalid_client', error_description: 'DO-NOT-PRINT-RAW-BODY' });
      rejected = false;
      return json(200, { access_token: fixedToken ?? `access-${requests.length}`, token_type: 'Bearer',
        expires_in: badLifetime ? 0 : tokenLifetime, ...(grantType === 'authorization_code' ? { refresh_token: 'refresh' } : {}) });
    }
    if (req.url === '/register') { counts.registrations++; return json(500, {}); }
    if (req.url !== '/mcp') return json(404, {});
    if (rejected || req.headers.authorization !== `Bearer ${fixedToken ?? `access-${requests.length}`}` || !requests.length) {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${base}/resource", scope="${scopes}"`);
      return json(401, {});
    }
    if (req.method === 'GET') return json(405, {});
    if (req.method === 'DELETE') return res.writeHead(200).end();
    const message = JSON.parse(body);
    if (message.id === undefined) return res.writeHead(202).end();
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'service', version: '1' } };
    if (message.method === 'tools/list') result = { tools: [{ name: 'read', inputSchema: { type: 'object' } }] };
    if (message.method === 'tools/call') { counts.calls++; result = { content: [{ type: 'text', text: 'read-only' }] }; }
    return json(200, { jsonrpc: '2.0', id: message.id, result });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
    delete process.env.OAUTH_TEST_SECRET;
  });
  process.env.OAUTH_TEST_SECRET = 'test secret:+/&';
  const oauth = { clientId: 'registered:id', issuer: base, tokenEndpointAuthMethod: method, grantType };
  let publicKey;
  if (method === 'private_key_jwt') {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    publicKey = pair.publicKey;
    oauth.privateKeyPath = join(directory, 'private.pem');
    await writeFile(oauth.privateKeyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    oauth.alg = 'PS256';
    oauth.kid = 'registered-key';
  } else oauth.secretEnv = 'OAUTH_TEST_SECRET';
  if (grantType === 'authorization_code') {
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    oauth.redirectPort = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
  }
  const config = { name: 'service', url: `${base}/mcp`, headers: {
    'X-Backend-Secret': 'not-for-as', 'Content-Type': 'application/json', Accept: 'backend-only'
  }, oauth };
  const browser = async url => {
    counts.browsers++;
    const callback = new URL(url.searchParams.get('redirect_uri'));
    callback.searchParams.set('code', 'code');
    callback.searchParams.set('state', url.searchParams.get('state'));
    assert.equal((await fetch(callback)).status, 200);
  };
  return { config, directory, requests, counts, browser, base, publicKey,
    lifetime: value => { tokenLifetime = value; },
    fixedToken: value => { fixedToken = value; },
    discovery: { authorizationServerUrl: base, authorizationServerMetadata: { issuer: base,
      authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`,
      token_endpoint_auth_methods_supported: [method] },
      resourceMetadata: { resource: config.url, authorization_servers: [base], scopes_supported: ['least'] } },
    reject: () => { rejected = true; }, bad: () => { badLifetime = true; }, deny: () => { denied = true; },
    scope: value => { scopes = value; } };
}

test('generic service identical-token renewal publishes fresh acquisition expiry once and the next request reuses it', async t => {
  const f = await fixture(t, 'client_secret_post', 'client_credentials');
  f.fixedToken('opaque-same-service-token');
  const provider = await BackendOAuthProvider.load(f.config, f.directory);
  await provider.saveDiscoveryState(f.discovery);
  const fetch = boundedOAuthFetch(undefined, 10_000, f.config);
  await acquireServiceTokens(provider, f.discovery, 'read', fetch);
  const payload = JSON.stringify(provider.tokens());
  const binding = provider.saved.service.binding;
  provider.saved.expiresAt = Date.now() + 5000;
  await provider.persist();
  f.requests.length = 0;
  let publications = 0;
  const persist = provider.persist;
  t.mock.method(provider, 'persist', async function () { publications++; return persist.call(this); });
  await acquireServiceTokens(provider, f.discovery, 'read', fetch);
  assert.equal(JSON.stringify(provider.tokens()), payload);
  assert.equal(provider.saved.service.binding, binding);
  assert.ok(provider.expiresAt > Date.now() + 30_000, 'identical payload and binding must still publish renewed expiry');
  await acquireServiceTokens(provider, f.discovery, 'read', fetch);
  assert.equal(f.requests.length, 1);
  assert.equal(publications, 1);
  const restarted = await BackendOAuthProvider.load(f.config, f.directory);
  assert.equal(restarted.expiresAt, provider.expiresAt);
});

test('generic service identical-token scope publication survives restart and stale actors cannot overwrite a newer binding', async t => {
  const f = await fixture(t, 'client_secret_post', 'client_credentials');
  f.fixedToken('opaque-same-service-token');
  f.lifetime(604);
  const provider = await BackendOAuthProvider.load(f.config, f.directory);
  await provider.saveDiscoveryState(f.discovery);
  const fetch = boundedOAuthFetch(undefined, 10_000, f.config);
  await acquireServiceTokens(provider, f.discovery, 'read', fetch);
  const initialTokens = JSON.stringify(provider.tokens());
  let publications = 0;
  const persist = provider.persist;
  t.mock.method(provider, 'persist', async function () { publications++; return persist.call(this); });
  await provider.runRequest(() => acquireServiceTokens(provider, f.discovery, 'read write', fetch));
  assert.equal(JSON.stringify(provider.tokens()), initialTokens);
  assert.equal(publications, 1, 'changed binding must publish with unchanged token JSON');
  const restarted = await BackendOAuthProvider.load(f.config, f.directory);
  assert.equal(restarted.saved.service.scope, 'read write');
  assert.equal(restarted.saved.service.binding, provider.saved.service.binding);
  await provider.runRequest(async () => {
    const oldGeneration = provider.generation;
    await provider.context.run(undefined, () => acquireServiceTokens(provider, f.discovery, 'read write extra', fetch));
    assert.notEqual(provider.generation, oldGeneration, 'binding changes are credential-generation changes');
    const before = await readFile(provider.path, 'utf8');
    const saved = JSON.stringify(provider.saved);
    const count = publications;
    await acquireServiceTokens(provider, f.discovery, 'read obsolete', fetch);
    assert.equal(publications, count, 'obsolete actor cannot force publication');
    assert.equal(JSON.stringify(provider.saved), saved);
    assert.equal(await readFile(provider.path, 'utf8'), before);
  });
});

test('AUTH-PORTFOLIO-002 generic service acquisition expiry survives delayed verification and forces renewal', async t => {
  const f = await fixture(t, 'client_secret_post', 'client_credentials');
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  f.lifetime(31);
  const provider = await BackendOAuthProvider.load(f.config, f.directory, { interactive: true });
  await provider.saveDiscoveryState(f.discovery);
  const fetch = boundedOAuthFetch(undefined, 10_000, f.config);
  await acquireServiceTokens(provider, f.discovery, 'least', fetch);
  const acquisitionExpiry = Date.now() + 31_000;
  t.mock.timers.tick(30_000);
  await provider.commitTokens();
  assert.equal(provider.saved.expiresAt, acquisitionExpiry);
  assert.equal(provider.saved.expiresAt - Date.now(), 1000);
  const restarted = await BackendOAuthProvider.load(f.config, f.directory);
  assert.equal(restarted.saved.expiresAt, acquisitionExpiry);
  await acquireServiceTokens(restarted, f.discovery, 'least', fetch);
  assert.equal(f.requests.length, 2);
  assert.equal(restarted.saved.expiresAt, Date.now() + 31_000);
});

function checkAuthentication(f, request) {
  assert.equal(request.params.get('client_id'), f.config.oauth.clientId);
  assert.equal(request.params.get('resource'), f.config.url);
  assert.equal(request.headers['x-backend-secret'], undefined);
  assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(request.headers.accept, 'application/json');
  if (f.config.oauth.tokenEndpointAuthMethod === 'client_secret_post') {
    assert.equal(request.params.get('client_secret'), process.env.OAUTH_TEST_SECRET);
    assert.equal(request.headers.authorization, undefined);
  } else if (f.config.oauth.tokenEndpointAuthMethod === 'client_secret_basic') {
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('registered%3Aid:test+secret%3A%2B%2F%26').toString('base64')}`);
    assert.equal(request.params.get('client_secret'), null);
  } else {
    const jwt = request.params.get('client_assertion');
    const [header, payload, signature] = jwt.split('.');
    const h = JSON.parse(Buffer.from(header, 'base64url'));
    const p = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.deepEqual(h, { alg: f.config.oauth.alg, typ: 'JWT', kid: 'registered-key' });
    assert.equal(p.aud, `${f.base}/token`);
    assert.equal(p.iss, f.config.oauth.clientId);
    assert.equal(p.sub, f.config.oauth.clientId);
    assert.equal(p.exp - p.iat, 60);
    assert.ok(Math.abs(p.iat - request.receivedAt / 1000) < 5);
    assert.ok(verify('sha256', Buffer.from(`${header}.${payload}`), {
      key: f.publicKey,
      padding: f.config.oauth.alg === 'PS256' ? constants.RSA_PKCS1_PSS_PADDING : constants.RSA_PKCS1_PADDING,
      ...(f.config.oauth.alg === 'PS256' ? { saltLength: 32 } : {})
    }, Buffer.from(signature, 'base64url')));
    assert.equal(request.params.get('client_assertion_type'), 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.params.get('client_secret'), null);
  }
}

for (const method of ['client_secret_basic', 'client_secret_post', 'private_key_jwt']) {
  test(`registered ${method} code exchange and refresh use exact SDK wire authentication`, async t => {
    const f = await fixture(t, method);
    await authenticateBackend(f.config, f.directory, { onAuthorization: f.browser, timeoutMs: 10_000 });
    f.reject();
    const registry = new BackendRegistry(new Map([[f.config.name, f.config]]), { stateDir: f.directory });
    try { assert.equal((await registry.callTool(f.config.name, 'read', {})).content[0].text, 'read-only'); }
    finally { await registry.close(); }
    assert.deepEqual(f.requests.map(r => r.params.get('grant_type')), ['authorization_code', 'refresh_token']);
    assert.ok(f.requests[0].params.get('code_verifier'));
    assert.equal(f.requests[0].params.get('code'), 'code');
    assert.equal(f.requests[1].params.get('refresh_token'), 'refresh');
    for (const request of f.requests) checkAuthentication(f, request);
    if (method === 'private_key_jwt') {
      const claims = f.requests.map(r => JSON.parse(Buffer.from(r.params.get('client_assertion').split('.')[1], 'base64url')));
      assert.notEqual(claims[0].jti, claims[1].jti);
    }
    assert.equal(f.counts.registrations, 0);
    const provider = await BackendOAuthProvider.load(f.config, f.directory);
    assert.doesNotMatch(await readFile(provider.path, 'utf8'), /test secret|BEGIN PRIVATE|"client_assertion"|"client_secret"/);
  });

  test(`service ${method} challenge scope, expiry, concurrent reuse and reconnect without browser`, async t => {
    const f = await fixture(t, method, 'client_credentials');
    await authenticateBackend(f.config, f.directory, { onAuthorization: () => assert.fail('no browser'), timeoutMs: 10_000 });
    assert.equal(f.counts.calls, 0);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].params.get('scope'), 'least');
    let provider = await BackendOAuthProvider.load(f.config, f.directory);
    provider.saved.expiresAt = Date.now() - 1;
    await provider.persist();
    const registry = new BackendRegistry(new Map([[f.config.name, f.config]]), { stateDir: f.directory });
    try {
      await Promise.all([registry.callTool(f.config.name, 'read', {}), registry.callTool(f.config.name, 'read', {})]);
      assert.equal(f.requests.length, 2);
      f.reject();
      f.scope('narrower');
      await registry.callTool(f.config.name, 'read', {});
      assert.equal(f.requests.at(-1).params.get('scope'), 'narrower');
    } finally { await registry.close(); }
    const restarted = new BackendRegistry(new Map([[f.config.name, f.config]]), { stateDir: f.directory });
    const before = f.requests.length;
    try { await restarted.callTool(f.config.name, 'read', {}); } finally { await restarted.close(); }
    assert.equal(f.requests.length, before);
    for (const request of f.requests) {
      checkAuthentication(f, request);
      assert.equal(request.params.get('grant_type'), 'client_credentials');
    }
    provider = await BackendOAuthProvider.load(f.config, f.directory);
    assert.equal(provider.tokens().refresh_token, undefined);
    assert.doesNotMatch(await readFile(provider.path, 'utf8'), /test secret|BEGIN PRIVATE|"client_assertion"|"client_secret"/);
    assert.equal(f.counts.registrations, 0);
  });
}

for (const mode of ['expiry', 'denied', 'missing-secret', 'issuer', 'method']) {
  test(`service rejects ${mode} before tool execution and hides credentials`, async t => {
    const f = await fixture(t, 'client_secret_post', 'client_credentials');
    if (mode === 'expiry') f.bad();
    if (mode === 'denied') f.deny();
    if (mode === 'missing-secret') delete process.env.OAUTH_TEST_SECRET;
    if (mode === 'issuer') f.config.oauth.issuer = `${f.base}/other`;
    if (mode === 'method') f.config.oauth.tokenEndpointAuthMethod = 'client_secret_basic';
    const registry = new BackendRegistry(new Map([[f.config.name, f.config]]), { stateDir: f.directory });
    try {
      await assert.rejects(registry.callTool(f.config.name, 'read', {}), error =>
        !/DO-NOT-PRINT|test secret/.test(error.message));
    } finally { await registry.close(); }
    assert.equal(f.counts.calls, 0);
    assert.equal((await BackendOAuthProvider.load(f.config, f.directory)).tokens(), undefined);
    if (['issuer', 'method', 'missing-secret'].includes(mode)) assert.equal(f.requests.length, 0);
  });
}

test('confidential configuration rejects conflicts and inline secret values without echoing them', () => {
  const good = { clientId: 'registered', issuer: 'https://issuer.example', tokenEndpointAuthMethod: 'client_secret_post', secretEnv: 'SECRET' };
  for (const oauth of [
    { ...good, clientSecret: 'private-value' }, { ...good, grantType: 'password' },
    { ...good, privateKeyPath: 'key' }, { ...good, secretEnv: undefined },
    { ...good, issuer: undefined }, { ...good, clientId: undefined },
    { ...good, tokenEndpointAuthMethod: 'none' }, { ...good, provider: 'entra' },
    { ...good, grantType: 'client_credentials', redirectPort: 1234 },
    { ...good, tokenEndpointAuthMethod: 'private_key_jwt', alg: 'HS256', kid: 'key' }
  ]) assert.throws(() => validateBackendConfig({ url: 'https://resource.example/mcp', oauth }), error => !error.message.includes('private-value'));
});

test('service credentials lock excludes another owner and subsequent reload reuses durable state', async t => {
  const f = await fixture(t, 'client_secret_post', 'client_credentials');
  await authenticateBackend(f.config, f.directory, { timeoutMs: 10_000 });
  const owner = await BackendOAuthProvider.load(f.config, f.directory);
  const contender = await BackendOAuthProvider.load(f.config, f.directory);
  const release = await owner.acquireLock();
  try {
    await assert.rejects(contender.fetch(boundedOAuthFetch(undefined, 10_000, f.config))(f.config.url, {
      method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    }), error => error.code === 'oauth_busy');
  } finally { await release(); }
  const response = await contender.fetch(boundedOAuthFetch(undefined, 10_000, f.config))(f.config.url, {
    method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  });
  assert.equal(response.status, 200);
  assert.equal(f.requests.length, 1);
  const code = `import { BackendRegistry } from './src/backend-registry.js';
    const config = JSON.parse(process.argv[1]);
    const registry = new BackendRegistry(new Map([[config.name, config]]), { stateDir: process.argv[2] });
    try { await registry.callTool(config.name, 'read', {}); } finally { await registry.close(); }`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code, JSON.stringify(f.config), f.directory],
    { timeout: 10_000 });
  assert.equal(f.requests.length, 1, 'a real child process reuses the private cache without acquisition');
});

test('service JWT RS256 uses the registered algorithm and missing key errors are redacted', async t => {
  const f = await fixture(t, 'private_key_jwt', 'client_credentials');
  f.config.oauth.alg = 'RS256';
  await authenticateBackend(f.config, f.directory, { timeoutMs: 10_000 });
  checkAuthentication(f, f.requests[0]);
  const provider = await BackendOAuthProvider.load(f.config, f.directory);
  provider.saved.expiresAt = 0;
  await provider.persist();
  await rm(f.config.oauth.privateKeyPath);
  const registry = new BackendRegistry(new Map([[f.config.name, f.config]]), { stateDir: f.directory });
  try {
    await assert.rejects(registry.callTool(f.config.name, 'read', {}), error =>
      error.code === 'oauth_client_credentials_invalid' && !error.message.includes(f.config.oauth.privateKeyPath));
  } finally { await registry.close(); }
  assert.equal(f.requests.length, 1);
  assert.equal(f.counts.calls, 0);
});
