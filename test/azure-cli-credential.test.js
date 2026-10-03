import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AzureCliCredential, resolveAzureCli, azureCliToken, runAzureCli } from '../src/azure-cli-credential.js';
import { BackendOAuthProvider, authenticateBackend, hasStaticAuthorization, boundedOAuthFetch, MICROSOFT_REQUIRED_SCOPE } from '../src/backend-oauth.js';
import { errorResult } from '../src/errors.js';
import { BackendRegistry } from '../src/backend-registry.js';
import { validateBackendConfig } from '../src/config-schema.js';
import { microsoftHostEnv } from '../src/microsoft-host-env.js';

const tenant = '22222222-2222-2222-2222-222222222222';
const authority = 'https://login.microsoftonline.com/organizations';
const scopes = ['api://mail/Mail.Read', 'api://mail/Mail.Search'];
const discovery = {
  authorizationServerUrl: `${authority}/v2.0`,
  authorizationServerMetadata: {
    issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
    authorization_endpoint: `${authority}/oauth2/v2.0/authorize`,
    token_endpoint: `${authority}/oauth2/v2.0/token`,
    response_types_supported: ['code']
  },
  resourceMetadata: { resource: 'https://mcp.example/mcp',
    authorization_servers: [`${authority}/v2.0`], scopes_supported: scopes }
};
const launch = { command: 'fixture-az', prefix: [], env: {} };
const token = () => JSON.stringify({ accessToken: 'private-fixture-token', tokenType: 'Bearer',
  tenant, expires_on: Math.floor(Date.now() / 1000) + 3600 });
const subscription = '33333333-3333-3333-3333-333333333333';
const accountInfo = { tenantId: tenant, environmentName: 'AzureCloud', id: subscription, isDefault: true,
  user: { name: 'fixture@example.invalid', type: 'user' } };
const account = () => JSON.stringify(accountInfo);
async function fixture(t, options = {}) {
  const stateDir = await mkdtemp(join(process.cwd(), '.gateway-azure-cli-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const config = { name: 'mail', url: discovery.resourceMetadata.resource,
    oauth: { resource: 'api://mail', credentialProvider: 'azure-cli' } };
  const provider = await BackendOAuthProvider.load(config, stateDir, {
    azureCliResolver: async () => launch, ...options
  });
  return { config, provider, stateDir };
}

function testEnv(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test('Azure CLI resolves validated Windows installer without a shell and native Unix argv', async () => {
  const shim = 'Microsoft Azure CLI - Windows Installer\nSET AZ_INSTALLER=MSI\n"%~dp0\\..\\python.exe" -IBm azure.cli %*';
  const windows = await resolveAzureCli({ platform: 'win32', env: { PATH: 'C:\\Azure\\wbin' },
    read: async () => shim, exists: async () => {} });
  assert.equal(windows.command, 'C:\\Azure\\python.exe');
  assert.deepEqual(windows.prefix, ['-IBm', 'azure.cli']);
  assert.equal(await resolveAzureCli({ platform: 'win32', env: { PATH: 'C:\\evil' },
    read: async () => 'cmd /c untrusted', exists: async () => {} }), undefined);
  assert.deepEqual(await resolveAzureCli({ platform: 'linux', env: { PATH: '/opt/azure/bin' },
    exists: async () => {} }), { command: '/opt/azure/bin/az', prefix: [], env: {} });
});

test('privacy Azure CLI child excludes credential canaries and honors only whitelisted overrides', async t => {
  testEnv(t, { PRIVACY_CREDENTIAL_CANARY: 'excluded-credential',
    REGISTERED_CLIENT_SECRET: 'excluded-client-secret', HARMLESS_UNUSED_USER_SETTING: 'excluded-setting',
    AZURE_CORE_UNRELATED_SECRET: 'excluded-azure-secret', AZURE_CONFIG_DIR: 'parent-profile' });
  const script = `const e=process.env; console.log(JSON.stringify({
    canary:e.PRIVACY_CREDENTIAL_CANARY, secret:e.REGISTERED_CLIENT_SECRET,
    unused:e.HARMLESS_UNUSED_USER_SETTING, arbitrary:e.AZURE_CORE_UNRELATED_SECRET,
    injected:e.CUSTOM_SECRET, config:e.AZURE_CONFIG_DIR, installer:e.AZ_INSTALLER,
    broker:e.AZURE_CORE_ENABLE_BROKER_ON_WINDOWS, experience:e.AZURE_CORE_LOGIN_EXPERIENCE_V2,
    root:e.SystemRoot ?? e.SYSTEMROOT, path:e.Path ?? e.PATH
  }))`;
  const child = { command: process.execPath, prefix: ['-e', script], env: {
    AZURE_CONFIG_DIR: 'selected-profile', AZ_INSTALLER: 'MSI', CUSTOM_SECRET: 'excluded-extra',
    AZURE_CORE_ENABLE_BROKER_ON_WINDOWS: 'true'
  } };
  const result = JSON.parse(await runAzureCli(child, [], { login: true }));
  for (const name of ['canary', 'secret', 'unused', 'arbitrary', 'injected']) assert.equal(result[name], undefined);
  assert.equal(result.config, 'selected-profile');
  assert.equal(result.installer, 'MSI');
  assert.equal(result.broker, 'false');
  assert.equal(result.experience, 'off');
  assert.ok(result.path);
  if (process.platform === 'win32') assert.ok(result.root);
  assert.deepEqual(microsoftHostEnv({ HOME: 'home', HTTP_PROXY: 'network-exception',
    PATH: 'original', SECRET: 'excluded' }, { platform: 'win32', overrides: { Path: 'override', SECRET: 'excluded' } }),
  { HOME: 'home', HTTP_PROXY: 'network-exception', Path: 'override' });
  assert.deepEqual(microsoftHostEnv({ HOME: 'home', https_proxy: 'network-exception',
    AZURE_CONFIG_DIR: 'excluded-for-code', CLIENT_SECRET: 'excluded' }, { platform: 'linux' }),
  { HOME: 'home', https_proxy: 'network-exception' });
});

test('Azure CLI expiry parsing rejects local-time ambiguity, invalid JSON and token/tenant leakage', () => {
  assert.equal(azureCliToken(token()).tenant, tenant);
  for (const value of ['private-invalid-json', JSON.stringify({ accessToken: 'private-secret', tokenType: 'Bearer',
    tenant, expiresOn: '2030-01-01 12:00:00' }), JSON.stringify({ accessToken: 'private-secret',
    tokenType: 'Bearer', tenant, expires_on: 0 })]) {
    assert.throws(() => azureCliToken(value), error => error.code === 'oauth_invalid_token' &&
      !/private-secret|private-invalid/.test(error.message));
  }
});

test('Azure CLI scopes are one argv, acquisition is cached/singleflight and refresh stays memory-only', async t => {
  let calls = 0;
  const f = await fixture(t, { azureCliRunner: async (_launch, args, options) => {
    if (args[1] === 'show') return account();
    calls++;
    assert.deepEqual(args.slice(0, 4), ['account', 'get-access-token', '--scope', scopes.join(' ')]);
    assert.equal(options.login, undefined);
    return token();
  } });
  await f.provider.saveDiscoveryState(discovery);
  const credential = await f.provider.microsoftCredential(discovery);
  await Promise.all([credential.silent(), credential.silent()]);
  await credential.silent();
  assert.equal(calls, 1);
  await credential.silent('private-fixture-token');
  assert.equal(calls, 2);
  const persisted = await readFile(f.provider.path, 'utf8');
  assert.equal(persisted.includes('private-fixture-token'), false);
  assert.equal(persisted.includes('refresh_token'), false);
  assert.equal(f.provider.saved.azureCli.tenant, tenant);
  assert.throws(() => f.provider.clientInformation(), error => error.code === 'auth_required' && /--azure-cli/.test(error.message));
});

test('only explicit helper may login; registered identity and static header take precedence', async t => {
  let login = 0;
  let acquire = 0;
  const runner = async (_launch, args, options) => {
    if (args[1] === 'show') return account();
    if (args[1] === 'set') { assert.equal(args[3], subscription); return ''; }
    if (args[0] === 'login') {
      assert.equal(args[args.indexOf('--tenant') + 1], tenant, 'use only the validated existing profile GUID, never organizations');
      login++;
      assert.equal(options.login, true);
      assert.equal(options.deviceCode, true);
      assert.ok(args.includes('--use-device-code'));
      assert.ok(args.includes('--allow-no-subscriptions'));
      return '';
    }
    assert.equal(args.includes('--tenant'), false, 'fresh organizations discovery must not become an Azure CLI tenant selector');
    if (++acquire === 1) { const error = new Error('private diagnostics'); error.code = 'auth_required'; throw error; }
    return token();
  };
  const f = await fixture(t, { interactive: true, deviceCode: true, azureCliRunner: runner });
  await (await f.provider.microsoftCredential(discovery)).silent();
  assert.equal(login, 1);
  assert.equal(f.provider.saved.azureCli, undefined);
  assert.ok(f.provider.pendingAzureCli);
  const registered = await BackendOAuthProvider.load({ ...f.config, oauth: { ...f.config.oauth,
    clientId: '11111111-1111-1111-1111-111111111111' } }, f.stateDir, { azureCli: true });
  assert.equal(registered.azureCli, false);
  const previous = process.env.SHARED_MCP_ENTRA_CLIENT_ID;
  try {
    process.env.SHARED_MCP_ENTRA_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
    assert.equal(f.provider.azureCli, false);
  } finally {
    if (previous === undefined) delete process.env.SHARED_MCP_ENTRA_CLIENT_ID;
    else process.env.SHARED_MCP_ENTRA_CLIENT_ID = previous;
  }
  assert.equal(hasStaticAuthorization({ headers: { Authorization: 'operator-token' } }), true);
  await assert.rejects(authenticateBackend({ ...f.config, headers: { Authorization: 'operator-token' } },
    f.stateDir, { azureCli: true }), { code: 'oauth_not_applicable' });
  const { name, ...settings } = f.config;
  validateBackendConfig(settings);
  assert.throws(() => validateBackendConfig({ url: f.config.url, oauth: { credentialProvider: 'arbitrary-command' } }));
});

test('ordinary CLI failure gives exact helper guidance and never attempts login', async t => {
  let calls = 0;
  const f = await fixture(t, { azureCliRunner: async (_launch, args) => {
    calls++; assert.equal(args[0], 'account');
    const error = new Error('secret'); error.code = 'auth_required'; throw error;
  } });
  await f.provider.saveDiscoveryState(discovery);
  await assert.rejects(f.provider.fetch(async () => assert.fail('no backend request'))(f.config.url),
    error => error.code === 'auth_required' && /--azure-cli/.test(error.message) && !/secret/.test(error.message));
  assert.equal(calls, 1);
  assert.throws(() => new AzureCliCredential(f.provider, { ...discovery,
    resourceMetadata: { ...discovery.resourceMetadata, scopes_supported: ['api://one/Read', 'api://two/Read'] } },
  undefined, launch), { code: 'entra_invalid_scope' });
});

test('advertised API default plus standard OIDC scopes remain one exact CLI argument', async t => {
  const advertised = ['api://mail/.default', 'openid', 'profile', 'offline_access'];
  const f = await fixture(t, { azureCliRunner: async (_launch, args) => {
    if (args[1] === 'show') return account();
    assert.equal(args[3], advertised.join(' '));
    return token();
  } });
  const info = { ...discovery, resourceMetadata: { ...discovery.resourceMetadata, scopes_supported: advertised } };
  await (await f.provider.microsoftCredential(info)).silent();
  const fresh = new BackendOAuthProvider(f.config, f.stateDir, f.provider.options);
  assert.throws(() => new AzureCliCredential(fresh, { ...info, resourceMetadata: {
    ...info.resourceMetadata, scopes_supported: ['openid', 'profile', 'offline_access']
  } }, undefined, launch), { code: 'entra_invalid_scope' });
});

test('host credentials reject generic discovery and switched accounts without publishing them', async t => {
  let switched = false;
  const f = await fixture(t, { azureCliRunner: async (_launch, args) =>
    args[1] === 'show' ? JSON.stringify({ ...accountInfo,
      user: { name: switched ? 'other@example.invalid' : 'fixture@example.invalid', type: 'user' } }) : token() });
  await assert.rejects(f.provider.microsoftCredential({ ...discovery,
    authorizationServerUrl: 'https://generic.example/v2.0' }), { code: 'oauth_invalid_issuer' });
  await assert.rejects(f.provider.microsoftCredential({ ...discovery,
    resourceMetadata: { ...discovery.resourceMetadata, resource: 'https://other.example/mcp' } }),
  { code: 'oauth_invalid_resource' });
  const credential = await f.provider.microsoftCredential(discovery);
  await credential.silent();
  const before = await readFile(f.provider.path, 'utf8');
  switched = true;
  await assert.rejects(credential.silent('private-fixture-token'), { code: 'oauth_invalid_token' });
  assert.equal(await readFile(f.provider.path, 'utf8'), before);
});

for (const outcome of ['success', 'denied', 'cancelled', 'restore-failed']) {
  test(`force-login uses validated profile context and restores the exact default: ${outcome}`, async t => {
    const operations = [];
    let loginCount = 0;
    const f = await fixture(t, { interactive: true, forceLogin: true, azureCliRunner: async (_launch, args, options) => {
      operations.push(args.slice(0, 2).join(' '));
      if (args[1] === 'show') return account();
      if (args[1] === 'set') {
        assert.equal(args[3], subscription);
        assert.equal(options.signal, undefined, 'restoration cannot inherit an already-cancelled login signal');
        assert.equal(options.timeoutMs, 5000);
        if (outcome === 'restore-failed') throw new Error('private-context-error');
        return '';
      }
      if (args[0] === 'login') {
        loginCount++;
        assert.equal(args[args.indexOf('--tenant') + 1], tenant);
        assert.equal(args[args.indexOf('--scope') + 1], scopes.join(' '));
        assert.equal(options.login, true);
        assert.ok(options.timeoutMs <= 175_000);
        if (['denied', 'cancelled'].includes(outcome)) {
          const error = new Error('private-login-error');
          error.code = outcome === 'cancelled' ? 'oauth_cancelled' : 'auth_required';
          throw error;
        }
        return '';
      }
      assert.equal(args[1], 'get-access-token');
      assert.equal(loginCount, 1, 'forced login precedes token acquisition');
      return token();
    } });
    const credential = await f.provider.microsoftCredential(discovery);
    if (outcome === 'success') {
      await credential.silent();
      await credential.silent();
      assert.equal(loginCount, 1);
      assert.deepEqual(operations.slice(0, 3), ['account show', 'login --scope', 'account set']);
    } else {
      await assert.rejects(credential.silent(), {
        code: outcome === 'restore-failed' ? 'azure_cli_context_restore_failed' : outcome === 'cancelled' ? 'oauth_cancelled' : 'auth_required'
      });
      assert.equal(operations.at(-1), 'account set');
      assert.equal(f.provider.pendingTokens, undefined);
    }
  });
}

test('force-login without an existing profile omits tenant aliases and cannot override registered credentials', async t => {
  let shows = 0;
  const f = await fixture(t, { interactive: true, forceLogin: true, azureCliRunner: async (_launch, args) => {
    if (args[1] === 'show') {
      if (++shows > 1) return account();
      const error = new Error('not signed in'); error.code = 'auth_required'; throw error;
    }
    assert.equal(args.includes('--tenant'), false);
    assert.notEqual(args[1], 'set');
    return args[0] === 'login' ? '' : token();
  } });
  await (await f.provider.microsoftCredential(discovery)).silent();
  await assert.rejects(authenticateBackend({ ...f.config, oauth: { clientId: '11111111-1111-1111-1111-111111111111' } },
    f.stateDir, { azureCli: true, forceLogin: true }), { code: 'oauth_unsupported_flow' });
});

test('HTTP failure phases expose status without endpoint, response body or credentials', async t => {
  const config = { url: 'https://mcp.example/mcp' };
  t.mock.method(globalThis, 'fetch', async () => new Response('private-body', { status: 502 }));
  const fetchFn = boundedOAuthFetch(undefined, 1000, config);
  for (const [url, phase] of [[config.url, 'backend'],
    ['https://login.microsoftonline.com/organizations/.well-known/openid-configuration', 'discover'],
    ['https://login.microsoftonline.com/organizations/oauth2/v2.0/token', 'token']]) {
    await assert.rejects(fetchFn(url), error => error.code === 'oauth_http_error' &&
      error.message.includes(`502; phase: ${phase}`) && !/private-body|https:/.test(error.message));
  }
});

test('403 scope detail survives only as an internal validated hint; raw response remains redacted', async t => {
  const config = { url: discovery.resourceMetadata.resource };
  let message = "Access denied: Scope 'McpServers.Mail.All' is not present in the request.";
  let challenge;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    error: { message }, token: 'private-body-token', account: 'private-account'
  }), { status: 403, headers: challenge ? { 'www-authenticate': challenge } : {} }));
  const fetchFn = boundedOAuthFetch(undefined, 1000, config);
  const response = await fetchFn(config.url);
  assert.equal(response[MICROSOFT_REQUIRED_SCOPE], 'McpServers.Mail.All');
  assert.equal(await response.text(), '{}');
  challenge = 'Bearer error="insufficient_scope", scope="api://mail/Authoritative"';
  assert.equal((await fetchFn(config.url))[MICROSOFT_REQUIRED_SCOPE], undefined);
  challenge = undefined;
  assert.equal((await fetchFn('https://other.example/mcp'))[MICROSOFT_REQUIRED_SCOPE], undefined);
  for (const invalid of ["Access denied: Scope 'https://evil.example/Read' is not present in the request.",
    "Access denied: Scope 'McpServers.Mail.All extra' is not present in the request.",
    "Access denied: Scope 'McpServers.Mail.All' is not present in the request. private-token"]) {
    message = invalid;
    assert.equal((await fetchFn(config.url))[MICROSOFT_REQUIRED_SCOPE], undefined);
  }
});

test('ordinary 403 step-up gives structured helper guidance without requesting additional permissions', async t => {
  let acquisitions = 0;
  const advertised = ['api://mail/.default', 'openid', 'profile', 'offline_access'];
  const info = { ...discovery, resourceMetadata: { ...discovery.resourceMetadata, scopes_supported: advertised } };
  const f = await fixture(t, { azureCliRunner: async (_launch, args) => {
    if (args[1] === 'show') return account();
    assert.equal(args[1], 'get-access-token');
    assert.equal(args[3], advertised.join(' '));
    acquisitions++;
    return token();
  } });
  await f.provider.saveDiscoveryState(info);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: {
    message: "Access denied: Scope 'McpServers.Mail.All' is not present in the request."
  } }), { status: 403 }));
  await assert.rejects(f.provider.fetch(boundedOAuthFetch(undefined, 1000, f.config))(f.config.url), error => {
    assert.equal(error.code, 'auth_required');
    assert.ok(error.message.includes('--azure-cli'));
    assert.deepEqual(error.requiredScopes, ['openid', 'profile', 'offline_access', 'api://mail/McpServers.Mail.All']);
    assert.deepEqual(JSON.parse(errorResult(error).content[0].text).requiredScopes, error.requiredScopes);
    return true;
  });

  assert.equal(acquisitions, 1);
});

test('standard insufficient_scope header is authoritative over body hints and metadata defaults', async t => {
  let acquisitions = 0;
  const f = await fixture(t, { azureCliRunner: async (_launch, args) => {
    if (args[1] === 'show') return account();
    assert.equal(args[1], 'get-access-token');
    acquisitions++;
    return token();
  } });
  await f.provider.saveDiscoveryState(discovery);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: {
    message: "Access denied: Scope 'McpServers.Mail.All' is not present in the request."
  } }), { status: 403, headers: {
    'www-authenticate': 'Bearer error="insufficient_scope", scope="api://mail/Header.Required"'
  } }));
  await assert.rejects(f.provider.fetch(boundedOAuthFetch(undefined, 1000, f.config))(f.config.url),
    error => error.code === 'auth_required' && error.requiredScopes?.join(' ') === 'api://mail/Header.Required');
  assert.equal(acquisitions, 1, 'ordinary calls cannot request newly challenged permissions');
});

for (const rejectTools of [false, true]) {
  test(`explicit helper consents only to verified-base server step-up and commits after verification: ${rejectTools}`, async t => {
    const advertised = ['api://mail/.default', 'openid', 'profile', 'offline_access'];
    const required = ['openid', 'profile', 'offline_access', 'api://mail/McpServers.Mail.All'];
    let activeScopes;
    let logins = 0;
    const f = await fixture(t, { azureCliRunner: async (_launch, args, options) => {
      if (args[1] === 'show') return account();
      if (args[1] === 'set') return '';
      if (args[0] === 'login') {
        logins++;
        assert.equal(args[args.indexOf('--scope') + 1], required.join(' '));
        assert.equal(options.login, true);
        return '';
      }
      activeScopes = args[3];
      return token();
    } });
    t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
      const url = String(input);
      const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body),
        { status, headers: { 'content-type': 'application/json', ...headers } });
      if (url.includes('oauth-protected-resource')) return json({ ...discovery.resourceMetadata, scopes_supported: advertised });
      if (url.includes('.well-known/')) return json(discovery.authorizationServerMetadata);
      assert.equal(url, f.config.url);
      if (!new Headers(init.headers).has('authorization')) {
        return json({}, 401, { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"' });
      }
      if (activeScopes !== required.join(' ')) return json({ error: {
        message: "Access denied: Scope 'McpServers.Mail.All' is not present in the request."
      } }, 403);
      if (init.method !== 'POST') return json({}, 405);
      const message = JSON.parse(init.body);
      if (!Object.hasOwn(message, 'id')) return new Response(null, { status: 202 });
      if (message.method === 'tools/list' && rejectTools) return json({}, 403);
      return json({ jsonrpc: '2.0', id: message.id, result: message.method === 'initialize' ?
        { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'stepup-fixture', version: '1' } } :
        { tools: [{ name: 'readonlySearch', inputSchema: { type: 'object' } }] } });
    });
    const operation = authenticateBackend(f.config, f.stateDir, {
      azureCliResolver: async () => launch, azureCliRunner: f.provider.options.azureCliRunner
    });
    if (rejectTools) {
      await assert.rejects(operation);
      assert.equal(JSON.parse(await readFile(f.provider.path, 'utf8')).azureCli, undefined);
    } else {
      assert.equal((await operation).authenticated, true);
      assert.deepEqual(JSON.parse(await readFile(f.provider.path, 'utf8')).azureCli.scopes, required);
    }
    assert.equal(logins, 1);
  });
}

test('owned CLI child timeout and safe failure diagnostics', async () => {
  await assert.rejects(runAzureCli({ command: process.execPath, prefix: [], env: {} },
    ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 50 }), { code: 'oauth_cancelled' });
  await assert.rejects(runAzureCli({ command: process.execPath, prefix: [], env: {} },
    ['-e', 'process.stderr.write("private-secret AADSTS65001 tenant@example");process.exit(1)']),
  error => error.code === 'auth_required' && /AADSTS65001/.test(error.message) && !/private-secret|tenant@example/.test(error.message));
});

test('AADSTS65002 is a provider mismatch, not a retryable login/admin-consent failure', async t => {
  let calls = 0;
  const f = await fixture(t, { interactive: true, azureCliRunner: async (_launch, args) => {
    calls++;
    assert.equal(args[1], 'get-access-token', 'provider mismatch must not start login');
    return runAzureCli({ command: process.execPath, prefix: [], env: {} }, ['-e',
      'process.stderr.write("private-token AADSTS65002 account@example.invalid https://private.example/tenant");process.exit(1)']);
  } });
  await assert.rejects((await f.provider.microsoftCredential(discovery)).silent(), error =>
    error.code === 'oauth_provider_not_preauthorized' && /not preauthorized/.test(error.message) &&
    /AADSTS65002/.test(error.message) && !/private-token|account@example|https:|admin grant|create.*app/i.test(error.message));
  assert.equal(calls, 1);
  assert.equal(f.provider.pendingTokens, undefined);
  assert.equal(f.provider.azureCliLoginPerformed, undefined);
});

test('explicit login environment is local to the owned child; cancellation is bounded', async () => {
  const before = process.env.AZURE_CORE_ENABLE_BROKER_ON_WINDOWS;
  const result = await runAzureCli({ command: process.execPath, prefix: [], env: {} },
    ['-e', 'console.log(JSON.stringify({broker:process.env.AZURE_CORE_ENABLE_BROKER_ON_WINDOWS,v2:process.env.AZURE_CORE_LOGIN_EXPERIENCE_V2}))'],
    { login: true });
  assert.deepEqual(JSON.parse(result), { broker: 'false', v2: 'off' });
  assert.equal(process.env.AZURE_CORE_ENABLE_BROKER_ON_WINDOWS, before);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(runAzureCli({ command: process.execPath, prefix: [], env: {} },
      ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal }), { code: 'oauth_cancelled' });
  } finally { clearTimeout(timer); }
});

test('actual SDK initialize, schema validation, readonly tool and reconnect use CLI, never DCR/MSAL', async t => {
  let acquisitions = 0;
  const f = await fixture(t, { azureCliRunner: async (_launch, args) => {
    if (args[1] === 'show') return account();
    acquisitions++; return token();
  } });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = String(input);
    requests.push(url);
    const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body),
      { status, headers: { 'content-type': 'application/json', ...headers } });
    if (url.includes('oauth-protected-resource')) return json(discovery.resourceMetadata);
    if (url.includes('.well-known/')) return json(discovery.authorizationServerMetadata);
    assert.equal(url, f.config.url);
    if (new Headers(init.headers).get('authorization') !== 'Bearer private-fixture-token') {
      return json({}, 401, { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"' });
    }
    if (init.method !== 'POST') return json({}, 405);
    const message = JSON.parse(init.body);
    if (!Object.hasOwn(message, 'id')) return new Response(null, { status: 202 });
    const result = message.method === 'initialize' ? { protocolVersion: '2025-11-25',
      capabilities: { tools: {} }, serverInfo: { name: 'mail-fixture', version: '1' } } :
      message.method === 'tools/list' ? { tools: [{ name: 'readonlySearch', inputSchema: {
        type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] } :
        { content: [{ type: 'text', text: 'readonly-result' }] };
    return json({ jsonrpc: '2.0', id: message.id, result });
  });
  assert.equal((await authenticateBackend(f.config, f.stateDir, {
    azureCliRunner: f.provider.options.azureCliRunner, azureCliResolver: async () => launch,
    onAuthorization: () => assert.fail('cached CLI must not open UI')
  })).discoveredTools, 1);
  t.mock.method(BackendOAuthProvider.prototype, 'microsoftCredential', async function (info, scope) {
    this.options.azureCliRunner = f.provider.options.azureCliRunner;
    return new AzureCliCredential(this, info, scope, launch);
  });
  const registry = new BackendRegistry(new Map([['mail', f.config]]), { stateDir: f.stateDir });
  try {
    assert.ok((await registry.callTool('mail', 'readonlySearch', { query: 'fixture' })).content);
    await assert.rejects(registry.callTool('mail', 'readonlySearch', { query: 1 }));
    await registry.close();
    const reconnect = new BackendRegistry(new Map([['mail', f.config]]), { stateDir: f.stateDir });
    try { assert.ok((await reconnect.callTool('mail', 'readonlySearch', { query: 'fixture' })).content); }
    finally { await reconnect.close(); }
  } finally { await registry.close(); }
  assert.equal(acquisitions, 3);
  assert.equal(requests.some(url => /register|\/token$/.test(url)), false);
});
