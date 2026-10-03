import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { generateKeyPairSync, verify, constants } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticateBackend, BackendOAuthProvider } from '../src/backend-oauth.js';
import { DEVICE_GRANT } from '../src/oauth-device.js';
import { BackendRegistry } from '../src/backend-registry.js';

async function fixture(t, { method = 'none', errors = ['authorization_pending', 'authorization_pending', 'slow_down', 'slow_down'],
  endpoint = true, grant = true, malformed = false, expires = 120, interval = 1, oidc = false, registration = 'registered',
  rejectTools = false, hang = false, omitInterval = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'oauth-device-test-'));
  const requests = [];
  const waits = [];
  const prompts = [];
  let now = Date.now();
  let base;
  let registrations = 0;
  let key;
  const server = createServer(async (req, res) => {
    const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    if (req.url === '/resource') return json(200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['fallback'] });
    if (req.url.startsWith('/.well-known/')) {
      if (oidc && req.url.includes('oauth-authorization-server')) return json(404, {});
      return json(200, { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`,
        ...(endpoint ? { device_authorization_endpoint: `${base}/device` } : {}),
        ...(grant === undefined ? {} : { grant_types_supported: grant ? [DEVICE_GRANT] : ['authorization_code'] }),
        response_types_supported: ['code'], token_endpoint_auth_methods_supported: [method],
        registration_endpoint: `${base}/register`, client_id_metadata_document_supported: registration === 'cimd',
        ...(oidc ? { jwks_uri: `${base}/jwks`, subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] } : {}) });
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.url === '/register') {
      registrations++;
      const metadata = JSON.parse(body);
      assert.deepEqual(metadata.grant_types, [DEVICE_GRANT, 'refresh_token']);
      assert.equal(metadata.scope, 'authoritative');
      return json(201, { ...metadata, client_id: 'registered' });
    }
    if (['/device', '/token'].includes(req.url)) {
      requests.push({ path: req.url, params: new URLSearchParams(body), headers: req.headers, at: now });
      if (req.url === '/device') return json(200, malformed === true ? { device_code: 'PRIVATE-DEVICE' } :
        { device_code: 'PRIVATE-DEVICE', user_code: 'LOCAL-USER', verification_uri: `${base}/verify`, expires_in: expires,
          ...(omitInterval ? {} : { interval }), ...(typeof malformed === 'object' ? malformed : {}) });
      if (hang) return;
      const error = errors.shift();
      if (error) return json(400, { error, error_description: 'PRIVATE-ERROR-DESCRIPTION' });
      return json(200, { access_token: 'device-access', refresh_token: 'device-refresh', token_type: 'Bearer', expires_in: 3600 });
    }
    if (req.url !== '/mcp') return json(404, {});
    if (req.headers.authorization !== 'Bearer device-access') {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${base}/resource", scope="authoritative"`);
      return json(401, {});
    }
    if (req.method === 'GET') return json(405, {});
    if (req.method === 'DELETE') return res.writeHead(200).end();
    const message = JSON.parse(body);
    if (message.id === undefined) return res.writeHead(202).end();
    if (rejectTools && message.method === 'tools/list') return json(500, { private: 'PRIVATE-ERROR-DESCRIPTION' });
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'device', version: '1' } }
      : message.method === 'tools/call' ? { content: [{ type: 'text', text: 'fixture-read' }] }
        : { tools: [{ name: 'read', inputSchema: { type: 'object' } }] };
    return json(200, { jsonrpc: '2.0', id: message.id, result });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
    delete process.env.DEVICE_TEST_SECRET;
  });
  // An occupied callback port proves that the device helper never listens.
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => reservation.close(resolve)));
  const oauth = { redirectPort: reservation.address().port, scopes: ['configured'] };
  if (registration === 'registered') oauth.clientId = 'registered';
  if (registration === 'cimd') oauth.clientMetadataUrl = 'https://client.example/metadata.json';
  if (method !== 'none') {
    Object.assign(oauth, { clientId: 'registered', issuer: base, tokenEndpointAuthMethod: method });
    if (method === 'private_key_jwt') {
      key = generateKeyPairSync('rsa', { modulusLength: 2048 });
      oauth.privateKeyPath = join(directory, 'private.pem');
      await writeFile(oauth.privateKeyPath, key.privateKey.export({ format: 'pem', type: 'pkcs8' }));
      oauth.alg = 'PS256';
      oauth.kid = 'device-key';
    } else {
      oauth.secretEnv = 'DEVICE_TEST_SECRET';
      process.env.DEVICE_TEST_SECRET = 'PRIVATE-SECRET';
    }
  }
  const config = { name: 'device', url: `${base}/mcp`, oauth, headers: { 'X-Private-Backend': 'PRIVATE-HEADER' } };
  const options = { deviceCode: true, timeoutMs: 20_000, onAuthorization: () => assert.fail('no browser'),
    onDeviceCode: prompt => prompts.push(prompt), deviceClock: { now: () => now, sleep: async (ms, signal) => {
      signal.throwIfAborted();
      waits.push(ms);
      now += ms;
    } } };
  return { directory, config, options, requests, waits, prompts, key, registrations: () => registrations };
}

for (const method of ['none', 'client_secret_basic', 'client_secret_post', 'private_key_jwt']) {
  test(`RFC8628 ${method} SDK wire, pending/slow_down timing and private publication`, async t => {
    const f = await fixture(t, { method });
    f.options.timeoutMs = 60_000;
    assert.equal((await authenticateBackend(f.config, f.directory, f.options)).authenticated, true);
    assert.deepEqual(f.waits, [1000, 1000, 1000, 6000, 11000]);
    assert.deepEqual(f.prompts, [{ verification_uri: f.config.url.replace('/mcp', '/verify'), user_code: 'LOCAL-USER' }]);
    for (const r of f.requests) {
      assert.equal(r.params.get('client_id'), 'registered');
      assert.equal(r.params.get('resource'), f.config.url);
      assert.equal(r.headers['x-private-backend'], undefined);
      if (r.path === '/device') assert.equal(r.params.get('scope'), 'authoritative');
      else {
        assert.equal(r.params.get('grant_type'), DEVICE_GRANT);
        assert.equal(r.params.get('device_code'), 'PRIVATE-DEVICE');
      }
      if (method === 'client_secret_basic') assert.equal(r.headers.authorization, `Basic ${Buffer.from('registered:PRIVATE-SECRET').toString('base64')}`);
      if (method === 'client_secret_post') assert.equal(r.params.get('client_secret'), 'PRIVATE-SECRET');
      if (method === 'private_key_jwt') {
        const [header, payload, signature] = r.params.get('client_assertion').split('.');
        assert.equal(JSON.parse(Buffer.from(header, 'base64url')).kid, 'device-key');
        assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).aud, f.config.url.replace('/mcp', r.path));
        assert.ok(verify('sha256', Buffer.from(`${header}.${payload}`), { key: f.key.publicKey,
          padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(signature, 'base64url')));
      }
    }
    const provider = await BackendOAuthProvider.load(f.config, f.directory);
    assert.equal(provider.tokens().refresh_token, 'device-refresh');
    assert.doesNotMatch(await readFile(provider.path, 'utf8'), /PRIVATE-DEVICE|LOCAL-USER|PRIVATE-SECRET|BEGIN PRIVATE|client_assertion/);
    assert.ok(provider.saved.device.binding.includes('authoritative'));
    if (method === 'none') {
      const before = f.requests.length;
      const registry = new BackendRegistry(new Map([[f.config.name, f.config]]), { stateDir: f.directory });
      try { assert.equal((await registry.callTool(f.config.name, 'read', {})).content[0].text, 'fixture-read'); }
      finally { await registry.close(); }
      assert.equal(f.requests.length, before);
    }
  });
}

for (const settings of [
  { endpoint: false }, { grant: false }, { malformed: true },
  { malformed: { expires_in: '120' } }, { malformed: { interval: '5' } },
  { errors: ['access_denied'] }, { errors: ['expired_token'] }, { errors: ['invalid_client'] },
  { expires: 1 }, { rejectTools: true, errors: [] }
]) {
  test(`device rejects ${JSON.stringify(settings)} without saving tokens`, async t => {
    const f = await fixture(t, settings);
    await assert.rejects(authenticateBackend(f.config, f.directory, f.options),
      error => !/PRIVATE-DEVICE|PRIVATE-ERROR|PRIVATE-SECRET|LOCAL-USER/.test(error.message));
    assert.equal((await BackendOAuthProvider.load(f.config, f.directory)).tokens(), undefined);
    if (settings.endpoint === false || settings.grant === false) assert.equal(f.requests.length, 0);
    if (settings.expires === 1) assert.equal(f.requests.filter(r => r.path === '/token').length, 0);
  });
}

for (const registration of ['dcr', 'cimd']) {
  test(`device public ${registration} reuses verified discovery including OIDC extensions`, async t => {
    const f = await fixture(t, { registration, oidc: true, errors: [] });
    await authenticateBackend(f.config, f.directory, f.options);
    assert.equal(f.registrations(), registration === 'dcr' ? 1 : 0);
    assert.equal(f.requests[0].params.get('client_id'), registration === 'cimd' ? 'https://client.example/metadata.json' : 'registered');
  });
}

for (const mode of ['poll-sleep', 'token-request']) {
  test(`device own lifetime expiry during ${mode} preserves oauth_device_expired without pending publication`, async t => {
    const f = await fixture(t, { expires: mode === 'poll-sleep' ? 1 : 2, interval: mode === 'poll-sleep' ? 5 : 1,
      hang: mode === 'token-request', errors: [] });
    const base = f.config.url.replace('/mcp', '');
    const provider = await BackendOAuthProvider.load(f.config, f.directory);
    await provider.saveDiscoveryState({ authorizationServerUrl: base,
      authorizationServerMetadata: { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`,
        device_authorization_endpoint: `${base}/device`, grant_types_supported: [DEVICE_GRANT], response_types_supported: ['code'] },
      resourceMetadata: { resource: f.config.url, authorization_servers: [base], scopes_supported: ['authoritative'] } });
    f.options.timeoutMs = 5000;
    f.options.deviceClock = undefined;
    await assert.rejects(authenticateBackend(f.config, f.directory, f.options), { code: 'oauth_device_expired' });
    const polls = f.requests.filter(r => r.path === '/token').length;
    assert.equal(polls, mode === 'poll-sleep' ? 0 : 1);
    const saved = await BackendOAuthProvider.load(f.config, f.directory);
    assert.equal(saved.tokens(), undefined);
    assert.equal(saved.saved.device, undefined);
  });
}

for (const mode of ['cancel', 'deadline']) {
  test(`device ${mode} stops polling and never publishes`, async t => {
    const f = await fixture(t);
    const controller = new AbortController();
    f.options.signal = controller.signal;
    f.options.deviceClock.sleep = async (ms, signal) => {
      f.waits.push(ms);
      if (mode === 'cancel') controller.abort();
      else await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      signal.throwIfAborted();
    };
    if (mode === 'deadline') f.options.timeoutMs = 1000;
    await assert.rejects(authenticateBackend(f.config, f.directory, f.options));
    assert.equal(f.requests.filter(r => r.path === '/token').length, 0);
    assert.equal((await BackendOAuthProvider.load(f.config, f.directory)).tokens(), undefined);
  });
}

test('device defaults to five-second polling when interval is omitted', async t => {
  const f = await fixture(t, { errors: [], omitInterval: true });
  await authenticateBackend(f.config, f.directory, f.options);
  assert.deepEqual(f.waits, [5000]);
});

for (const mode of ['cancel', 'deadline']) {
  test(`device ${mode} aborts a pending token network request`, async t => {
    const f = await fixture(t, { hang: true });
    const controller = new AbortController();
    f.options.signal = controller.signal;
    let cancellation;
    f.options.onDeviceCode = () => {
      if (mode === 'cancel') cancellation = setTimeout(() => controller.abort(), 700);
    };
    if (mode === 'deadline') f.options.timeoutMs = 10_000;
    try {
      await assert.rejects(authenticateBackend(f.config, f.directory, f.options));
      const polls = f.requests.filter(r => r.path === '/token').length;
      assert.equal(polls, 1);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(f.requests.filter(r => r.path === '/token').length, polls);
      assert.equal((await BackendOAuthProvider.load(f.config, f.directory)).tokens(), undefined);
    } finally { clearTimeout(cancellation); }
  });
}
