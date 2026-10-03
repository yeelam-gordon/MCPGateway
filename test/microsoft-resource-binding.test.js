import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BackendOAuthProvider, authenticateBackend, boundedOAuthFetch } from '../src/backend-oauth.js';
import { EntraOAuth } from '../src/entra-oauth.js';
import { VSCodeCredential } from '../src/vscode-credential.js';
import { AzureCliCredential } from '../src/azure-cli-credential.js';
import { canonicalMicrosoftResource, boundMicrosoftScopes } from '../src/microsoft-resource-binding.js';
import { validateBackendConfig } from '../src/config-schema.js';

const authority = 'https://login.microsoftonline.com/organizations';
const url = 'https://mcp.example/mcp';
const discovery = { authorizationServerUrl: `${authority}/v2.0`,
  authorizationServerMetadata: {
    issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
    authorization_endpoint: `${authority}/oauth2/v2.0/authorize`,
    token_endpoint: `${authority}/oauth2/v2.0/token`, response_types_supported: ['code']
  }, resourceMetadata: { resource: url, authorization_servers: [`${authority}/v2.0`],
    scopes_supported: ['api://fixture/.default'] } };
const clientId = '11111111-1111-1111-1111-111111111111';
const accountKey = 'a'.repeat(64);
const binding = (oauth = {}, options = {}, saved = {}) => ({ config: { oauth }, options, saved });

test('canonical operator API binding validates URLs, GUIDs and scope-derived pins independently', () => {
  for (const resource of ['', 'http://api.example', 'https://user:pass@api.example',
    'https://api.example?x=1', 'https://api.example#x', 'api://api\\evil', 'not-an-api',
    'https://api.example/a/../b', 'https://api.example/a%2fb', 'https://api.example//b']) {
    assert.throws(() => validateBackendConfig({ url, oauth: { resource } }), { code: 'entra_invalid_scope' });
  }
  assert.equal(canonicalMicrosoftResource('https://API.example/path/'), 'https://api.example/path');
  assert.equal(boundMicrosoftScopes(binding({ scopes: ['openid', 'api://fixture/Read'] }), discovery).scopes[1],
    'api://fixture/Read', 'explicit configured scopes are preferred over advertised defaults');
  const guidDiscovery = { ...discovery, resourceMetadata: { ...discovery.resourceMetadata,
    scopes_supported: [`${clientId}/Read`] } };
  assert.equal(boundMicrosoftScopes(binding({ resource: clientId }), guidDiscovery).trustedResource, clientId);
  assert.throws(() => boundMicrosoftScopes(binding({}, {}, { discovery }), discovery),
    { code: 'oauth_resource_binding_required' }, 'saved unsolicited discovery is not an operator pin');
  assert.throws(() => boundMicrosoftScopes(binding({ scopes: ['api://fixture/Read'] }, {}, {
    entra: { scopes: ['api://other/Read'] }
  }), discovery), { code: 'entra_invalid_scope' }, 'committed selection cannot override the configured API pin');
});

test('all Microsoft modes reject unapproved APIs and missing pins before acquisition or state mutation', async t => {
  const dir = await mkdtemp(join(process.cwd(), '.gateway-binding-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let acquisitions = 0;
  for (const mode of ['vscode', 'azure-cli', 'entra']) {
    const oauth = mode === 'entra' ? { clientId } : { credentialProvider: mode };
    const options = { interactive: true,
      azureCliResolver: () => { acquisitions++; assert.fail('no CLI resolution before resource validation'); },
      vscodeAcquire: () => { acquisitions++; assert.fail('no host UI before resource validation'); } };
    const missing = await BackendOAuthProvider.load({ name: mode, url, oauth }, dir, options);
    await assert.rejects(missing.microsoftCredential(discovery), { code: 'oauth_resource_binding_required' });
    const provider = await BackendOAuthProvider.load({ name: mode, url,
      oauth: { ...oauth, scopes: ['api://fixture/Read'] } }, dir, options);
    const other = { ...discovery, resourceMetadata: { ...discovery.resourceMetadata,
      scopes_supported: ['https://other.example/Read'] } };
    const before = JSON.stringify(provider.saved);
    await assert.rejects(provider.saveDiscoveryState(other), { code: 'entra_invalid_scope' });
    await assert.rejects(provider.microsoftCredential(other, 'https://other.example/Read'), { code: 'entra_invalid_scope' });
    assert.equal(JSON.stringify(provider.saved), before);
    assert.throws(() => new EntraOAuth(provider, other, undefined, () => assert.fail('no MSAL network')),
      { code: 'entra_invalid_scope' });
    assert.throws(() => new VSCodeCredential(provider, other), { code: 'entra_invalid_scope' });
    assert.throws(() => new AzureCliCredential(provider, other, undefined, {}), { code: 'entra_invalid_scope' });
  }
  assert.equal(acquisitions, 0);
});

for (const [mode, configured] of [
  ['vscode', false], ['vscode', true], ['azure-cli', false], ['azure-cli', true]
]) {
  test(`explicit required scope repairs ${mode} even when initialize/list accept the old token; configured=${configured}`, async t => {
    const dir = await mkdtemp(join(process.cwd(), '.gateway-binding-test-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const initial = 'api://fixture/Initial.Read';
    const config = { name: mode, url, ...(configured ? { oauth: { scopes: [initial] } } : {}) };
    const required = 'api://fixture/McpServers.Mail.Read';
    let acquisitions = 0;
    const tenant = '22222222-2222-2222-2222-222222222222';
    const options = { [mode === 'vscode' ? 'vscode' : 'azureCli']: true, resource: 'api://fixture',
      vscodeAcquire: async (_provider, credential) => {
        acquisitions++; assert.ok(credential.scopes.includes(required));
        return { accessToken: 'new-token', accountKey };
      }, azureCliResolver: async () => ({ command: 'synthetic', prefix: [], env: {} }),
      azureCliRunner: async (_launch, args) => {
        if (args[1] === 'show') return JSON.stringify({ tenantId: tenant, environmentName: 'AzureCloud',
          id: '33333333-3333-3333-3333-333333333333', isDefault: true,
          user: { name: 'fixture@example.invalid', type: 'user' } });
        if (args[0] === 'login') { assert.ok(args[args.indexOf('--scope') + 1].includes(required)); return ''; }
        if (args[1] === 'set') return '';
        assert.equal(args[1], 'get-access-token');
        acquisitions++; assert.ok(args[3].includes(required));
        return JSON.stringify({ accessToken: 'new-token', tokenType: 'Bearer', tenant,
          expires_on: Math.floor(Date.now() / 1000) + 3600 });
      } };
    const provider = await BackendOAuthProvider.load(config, dir, { ...options, interactive: true });
    await provider.saveDiscoveryState(discovery);
    const credential = await provider.microsoftCredential(discovery);
    const state = { credentialProvider: mode, binding: credential.binding, authority, resource: url,
      scopes: credential.scopes, ...(mode === 'vscode' ?
        { providerIdentity: credential.providerIdentity, accountKey } : { tenant }) };
    provider[mode === 'vscode' ? 'pendingVSCode' : 'pendingAzureCli'] = state;
    await provider.saveTokens({ access_token: 'old-token', token_type: 'Bearer' }, true);
    await provider.commitTokens();
    const before = await readFile(provider.path, 'utf8');
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
      assert.equal(String(input), url, 'no auth-server or discovery requests are necessary with approved saved discovery');
      if ((init.method ?? 'GET') === 'GET' || init.method === 'DELETE') return new Response(null, { status: 405 });
      const message = JSON.parse(init.body);
      if (message.id === undefined) return new Response(null, { status: 202 });
      assert.ok(['initialize', 'tools/list'].includes(message.method), 'helper must never execute a tool');
      calls++;
      const result = message.method === 'initialize' ? {
        protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1' } } : { tools: [] };
      // Both tokens would be accepted here: explicit scope selection must force acquisition.
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer new-token');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }),
        { headers: { 'content-type': 'application/json' } });
    });
    await authenticateBackend(config, dir, { ...options, scopes: [required], timeoutMs: 20_000 });
    assert.equal(acquisitions, 1);
    assert.equal(calls, 2);
    const committed = JSON.parse(await readFile(provider.path, 'utf8'));
    assert.notEqual(await readFile(provider.path, 'utf8'), before);
    assert.equal(committed.trustedMicrosoftResource, 'api://fixture');
    const selected = configured ? [initial, required] : [required];
    assert.deepEqual(committed[mode === 'vscode' ? 'vscode' : 'azureCli'].scopes, selected);
    const restarted = await BackendOAuthProvider.load(config, dir, options);
    assert.ok((await restarted.microsoftCredential(discovery, 'api://fixture/.default')).scopes.includes(required));
    const restored = mode === 'vscode' ? new VSCodeCredential(restarted, discovery) :
      new AzureCliCredential(restarted, discovery, undefined, {});
    assert.deepEqual(restored.scopes, selected,
      'committed host consent survives configured initial scopes without relying on a default challenge');
    assert.equal(acquisitions, 1, 'reload cannot launch a host');
    if (configured) {
      await restored.silent();
      assert.equal(acquisitions, mode === 'vscode' ? 1 : 2,
        'VS Code reuses its committed token; CLI silently reacquires its memory-only credential with expanded scopes');
      const changed = await BackendOAuthProvider.load({ ...config, oauth: { scopes: [required] } }, dir, options);
      assert.notEqual(changed.path, restarted.path);
      assert.equal(changed.tokens(), undefined);
    }
    assert.equal(committed.expiresAt, mode === 'vscode' ? undefined : committed.expiresAt);
  });
}

test('scope rejection guidance gives exact approved command and never retries a tool', async t => {
  const dir = await mkdtemp(join(process.cwd(), '.gateway-binding-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = { name: 'mail', url, oauth: { resource: 'api://fixture', credentialProvider: 'vscode' } };
  const provider = await BackendOAuthProvider.load(config, dir, { interactive: true,
    vscodeAcquire: async () => ({ accessToken: 'old-token', accountKey }) });
  await provider.saveDiscoveryState(discovery);
  await (await provider.microsoftCredential(discovery)).silent();
  await provider.commitTokens();
  const before = await readFile(provider.path, 'utf8');
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response('{}', { status: 403, headers: {
      'www-authenticate': 'Bearer error="insufficient_scope", scope="api://fixture/McpServers.Mail.Send"' } });
  });
  const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'send', arguments: {} } };
  await assert.rejects(provider.runRequest(() => provider.fetch(boundedOAuthFetch(undefined, 1000, config))(url,
    { method: 'POST', body: JSON.stringify(message) }), message), error =>
    error.code === 'auth_required' && error.requiredScopes[0] === 'api://fixture/McpServers.Mail.Send' &&
    error.message.includes("--scope 'api://fixture/McpServers.Mail.Send'") &&
    error.message.includes("--resource 'api://fixture'"));
  assert.equal(requests, 1);
  assert.equal(await readFile(provider.path, 'utf8'), before);
});
