import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BackendOAuthProvider, authenticateBackend, boundedOAuthFetch } from '../src/backend-oauth.js';
import { VSCodeCredential, vscodeCallback, acquireVSCodeToken, stopVSCode, vscodeProfilePath } from '../src/vscode-credential.js';
import { validateBackendConfig } from '../src/config-schema.js';
import { BackendRegistry } from '../src/backend-registry.js';
import { selectedMicrosoftHostScope } from '../src/microsoft-resource-scopes.js';
import { microsoftHostEnv } from '../src/microsoft-host-env.js';

const authority = 'https://login.microsoftonline.com/organizations';
const resource = 'https://mcp.example/mcp';
const discovery = {
  authorizationServerUrl: `${authority}/v2.0`,
  authorizationServerMetadata: {
    issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
    authorization_endpoint: `${authority}/oauth2/v2.0/authorize`,
    token_endpoint: `${authority}/oauth2/v2.0/token`, response_types_supported: ['code']
  },
  resourceMetadata: { resource, authorization_servers: [`${authority}/v2.0`],
    scopes_supported: ['api://mail/.default'] }
};
const accountKey = 'a'.repeat(64);
async function fixture(t, options = {}) {
  const stateDir = await mkdtemp(join(process.cwd(), '.gateway-vscode-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const config = { name: 'mail', url: resource, oauth: { resource: 'api://mail', credentialProvider: 'vscode' } };
  const provider = await BackendOAuthProvider.load(config, stateDir, options);
  return { stateDir, config, provider };
}

test('VS Code selection is explicit, resource-bound and subordinate to registered/static credentials', async t => {
  const f = await fixture(t);
  assert.equal(f.provider.hostCredential, 'vscode');
  validateBackendConfig({ url: resource, oauth: { credentialProvider: 'vscode' } });
  assert.throws(() => new VSCodeCredential(f.provider, { ...discovery, authorizationServerUrl: 'https://other.example/v2.0' }),
    { code: 'oauth_invalid_issuer' });
  assert.throws(() => new VSCodeCredential(f.provider, discovery, 'api://other/Read'), { code: 'entra_invalid_scope' });
  await assert.rejects(f.provider.microsoftCredential({ ...discovery,
    resourceMetadata: { ...discovery.resourceMetadata, resource: 'https://other.example/mcp' } }),
  { code: 'oauth_invalid_resource' });
  assert.deepEqual(new VSCodeCredential(f.provider, discovery).requiredScopes('McpServers.Mail.All'),
    ['api://mail/McpServers.Mail.All']);
  for (const bad of ['Mail.Read', 'McpServers.Mail.All extra']) {
    assert.throws(() => new VSCodeCredential(f.provider, discovery).requiredScopes(bad), { code: 'entra_invalid_scope' });
  }
  const registered = await BackendOAuthProvider.load({ ...f.config, oauth: { ...f.config.oauth,
    clientId: '11111111-1111-1111-1111-111111111111' } }, f.stateDir, { vscode: true });
  assert.equal(registered.vscode, false);
  const previous = process.env.SHARED_MCP_ENTRA_CLIENT_ID;
  try {
    process.env.SHARED_MCP_ENTRA_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
    assert.equal(f.provider.vscode, false);
  } finally {
    if (previous === undefined) delete process.env.SHARED_MCP_ENTRA_CLIENT_ID;
    else process.env.SHARED_MCP_ENTRA_CLIENT_ID = previous;
  }
  await assert.rejects(authenticateBackend({ ...f.config, headers: { Authorization: 'operator' } },
    f.stateDir, { vscode: true }), { code: 'oauth_not_applicable' });
});

test('verified explicit Mail scope survives default challenges, restart and unknown-expiry credentials', async t => {
  const selected = ['api://mail/McpServers.Mail.All'];
  const binding = { config: { oauth: { resource: 'api://mail' } }, options: {}, saved: {} };
  assert.equal(selectedMicrosoftHostScope(discovery, 'api://mail/.default', selected, binding), selected[0]);
  assert.equal(selectedMicrosoftHostScope(discovery, 'api://mail/McpServers.Mail.Read', selected, binding),
    'api://mail/McpServers.Mail.Read');
  assert.throws(() => selectedMicrosoftHostScope(discovery, 'api://other/.default', selected, binding),
    { code: 'entra_invalid_scope' });
  const f = await fixture(t, { interactive: true,
    vscodeAcquire: async (_provider, credential) => {
      assert.deepEqual(credential.scopes, selected);
      return { accessToken: 'opaque-mail-token', accountKey };
    } });
  await f.provider.saveDiscoveryState(discovery);
  await (await f.provider.microsoftCredential(discovery, selected.join(' '))).silent();
  assert.deepEqual((await f.provider.microsoftCredential(discovery, 'api://mail/.default')).scopes, selected);
  await f.provider.commitTokens();
  const restarted = await BackendOAuthProvider.load(f.config, f.stateDir);
  assert.deepEqual((await restarted.microsoftCredential(discovery, 'api://mail/.default')).scopes, selected);
  assert.equal(restarted.expiresAt, undefined);
  assert.equal(restarted.tokens().access_token, 'opaque-mail-token');
});

test('HOST-R3-001 last committed explicit host provider wins both switching directions after restart', async t => {
  const f = await fixture(t);
  const config = { name: 'mail', url: resource, oauth: { resource: 'api://mail' } };
  const launch = { command: 'fixture-azure-cli', prefix: [], env: {} };
  const tenant = '22222222-2222-2222-2222-222222222222';
  let cliAcquisitions = 0;
  const azureCliRunner = async (_launch, args) => {
    if (args[1] === 'show') return JSON.stringify({ tenantId: tenant, environmentName: 'AzureCloud',
      user: { name: 'fixture@example.invalid', type: 'user' } });
    assert.equal(args[1], 'get-access-token');
    cliAcquisitions++;
    return JSON.stringify({ accessToken: 'opaque-cli-token', tokenType: 'Bearer',
      tenant, expires_on: Math.floor(Date.now() / 1000) + 3600 });
  };
  const dependencies = { azureCliResolver: async () => launch, azureCliRunner,
    vscodeAcquire: async () => ({ accessToken: 'opaque-vscode-token', accountKey }) };
  for (const mode of ['vscode', 'azure-cli', 'vscode']) {
    const provider = await BackendOAuthProvider.load(config, f.stateDir,
      { ...dependencies, interactive: true, vscode: mode === 'vscode', azureCli: mode === 'azure-cli' });
    await provider.saveDiscoveryState(discovery);
    await (await provider.microsoftCredential(discovery)).silent();
    await provider.commitTokens();
    const state = JSON.parse(await readFile(provider.path, 'utf8'));
    assert.equal(Boolean(state.vscode), mode === 'vscode');
    assert.equal(Boolean(state.azureCli), mode === 'azure-cli');
    if (mode === 'azure-cli') assert.equal(state.tokens, undefined);
    const restarted = await BackendOAuthProvider.load(config, f.stateDir, {
      ...dependencies, vscodeAcquire: () => assert.fail('ordinary reload must not open VS Code')
    });
    assert.equal(restarted.hostCredential, mode);
    await restarted.fetch(async (_input, init) => {
      assert.equal(new Headers(init.headers).get('authorization'),
        `Bearer opaque-${mode === 'vscode' ? 'vscode' : 'cli'}-token`);
      return new Response('{}');
    })(resource);
  }
  assert.equal(cliAcquisitions, 2, 'explicit CLI acquisition plus ordinary silent acquisition after restart');
});

test('opaque expiry is not invented; publication waits for commit and ordinary calls never launch a host', async t => {
  let acquisitions = 0;
  const f = await fixture(t, { interactive: true, vscodeAcquire: async () => {
    acquisitions++; return { accessToken: 'opaque-private-token', accountKey };
  } });
  await f.provider.saveDiscoveryState(discovery);
  const credential = await f.provider.microsoftCredential(discovery);
  await Promise.all([credential.silent(), credential.silent()]);
  assert.equal(acquisitions, 1);
  assert.equal(f.provider.expiresAt, undefined);
  assert.equal((await readFile(f.provider.path, 'utf8')).includes('opaque-private-token'), false);
  await f.provider.commitTokens();
  const cached = JSON.parse(await readFile(f.provider.path, 'utf8'));
  assert.equal(cached.expiresAt, undefined);
  assert.equal(cached.tokens.refresh_token, undefined);
  const ordinary = await BackendOAuthProvider.load(f.config, f.stateDir, {
    vscodeAcquire: () => assert.fail('ordinary calls cannot acquire a host token'),
    vscodeSpawn: () => assert.fail('ordinary calls cannot launch Code')
  });
  await ordinary.fetch(async (_input, init) => {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer opaque-private-token');
    return new Response('{}');
  })(resource);
  await assert.rejects(ordinary.fetch(async () => new Response('{}', { status: 401,
    headers: { 'www-authenticate': 'Bearer' } }))(resource),
  error => error.code === 'auth_required' && error.message.includes('--vscode'));
  assert.equal(JSON.parse(await readFile(f.provider.path, 'utf8')).tokens, undefined);
  assert.equal(acquisitions, 1);
});

test('callback validates nonce, Origin, Host, clock, resource, length and one-time consumption', async t => {
  const nonce = randomBytes(32).toString('base64url');
  const startedAt = Date.now();
  let results = 0;
  let ready = 0;
  const server = createServer(vscodeCallback({ nonce, binding: 'resource-bound', startedAt,
    deadline: startedAt + 30_000, isClosing: () => false, onReady: () => ready++, onResult: () => results++ }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/host-token`;
  const body = { binding: 'resource-bound', issuedAt: Date.now(), accessToken: 'opaque-token',
    accountId: 'opaque-account', sessionId: 'opaque-session' };
  const post = (value = body, headers = {}, suffix = '') => new Promise((resolve, reject) => {
    const data = JSON.stringify(value);
    const request = httpRequest(url + suffix, {
      method: 'POST', headers: { authorization: `Bearer ${nonce}`, 'content-type': 'application/json',
        'content-length': Buffer.byteLength(data), ...headers }
    }, response => { response.resume(); response.once('end', () => resolve({ status: response.statusCode })); });
    request.on('error', reject);
    request.end(data);
  });

  test('packaged extension calls only the public Microsoft getSession API and returns its opaque token', async t => {
    const nonce = randomBytes(32).toString('base64url');
    const startedAt = Date.now();
    const binding = 'verified-resource';
    let received;
    const server = createServer(vscodeCallback({ nonce, binding, startedAt, deadline: startedAt + 30_000,
      isClosing: () => false, onReady: () => {}, onResult: body => { received = body; } }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const scopes = ['api://mail/McpServers.Mail.All'];
    const exports = {};
    const subscriptions = [];
    const require = createRequire(import.meta.url);
    runInNewContext(await readFile(new URL('../src/vscode-helper/extension.cjs', import.meta.url), 'utf8'), {
      exports, Buffer, setInterval, clearInterval,
      process: { env: { SHARED_MCP_VSCODE_CALLBACK: `http://127.0.0.1:${server.address().port}/host-token`,
        SHARED_MCP_VSCODE_NONCE: nonce, SHARED_MCP_VSCODE_REQUEST: JSON.stringify({ binding, scopes }) } },
      require: name => name === 'vscode' ? {
        authentication: { getSession: async (provider, requested, options) => {
          assert.equal(provider, 'microsoft');
          assert.equal(JSON.stringify(requested), JSON.stringify(scopes));
          assert.equal(options.createIfNone, true);
          return { accessToken: 'public-api-token', id: 'session', account: { id: 'opaque-account' } };
        } },
        commands: { executeCommand: async () => {} }
      } : require(name)
    });
    try { await exports.activate({ subscriptions }); }
    finally { for (const item of subscriptions) item.dispose(); }
    assert.equal(received.accessToken, 'public-api-token');
    assert.equal(received.binding, binding);
    assert.equal(received.accountId, 'opaque-account');
  });
  for (const headers of [{ authorization: 'Bearer wrong' }, { origin: 'https://browser.example' },
    { host: 'localhost' }, { 'sec-fetch-site': 'same-origin' }]) {
    assert.equal((await post(body, headers)).status, 400);
  }
  for (const value of [{ ...body, binding: 'other-resource' }, { ...body, issuedAt: startedAt - 1 },
    { ...body, issuedAt: Date.now() + 60_000 }, { ...body, accessToken: 'bad\r\ntoken' },
    { ...body, accessToken: 'x'.repeat(66_000) }]) {
    assert.equal((await post(value)).status, 400);
  }
  assert.equal((await post({ binding: 'resource-bound' }, {}, '/ready')).status, 204);
  assert.equal(ready, 1);
  assert.equal((await post()).status, 204);
  assert.equal((await post()).status, 400);
  assert.equal(results, 1);
});

test('launcher uses packaged public API helper, private profile and bounded owned cleanup, without starting Code', async t => {
  const canaries = { PRIVACY_CREDENTIAL_CANARY: 'excluded-credential',
    HARMLESS_UNUSED_USER_SETTING: 'excluded-setting', ELECTRON_RUN_AS_NODE: '1',
    SHARED_MCP_VSCODE_NONCE: 'stale-nonce', SHARED_MCP_VSCODE_REQUEST: 'stale-request' };
  const previous = Object.fromEntries(Object.keys(canaries).map(name => [name, process.env[name]]));
  Object.assign(process.env, canaries);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  let stopped = false;
  const f = await fixture(t, { interactive: true, deadline: Date.now() + 20_000,
    vscodeResolver: async () => 'C:\\fixture\\Code.exe',
    vscodeSpawn: (command, args, options) => {
      assert.equal(command, 'C:\\fixture\\Code.exe');
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, false, 'the explicit GUI authentication host must show its permission window');
      assert.equal(options.stdio, 'ignore');
      assert.ok(args.includes('--extensionDevelopmentPath'));
      assert.ok(args[args.indexOf('--extensionDevelopmentPath') + 1].endsWith('vscode-helper'));
      assert.ok(args[args.indexOf('--user-data-dir') + 1].startsWith(f.provider.directory));
      const env = options.env;
      assert.equal(env.PRIVACY_CREDENTIAL_CANARY, undefined);
      assert.equal(env.HARMLESS_UNUSED_USER_SETTING, undefined);
      assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
      assert.notEqual(env.SHARED_MCP_VSCODE_NONCE, 'stale-nonce');
      assert.notEqual(env.SHARED_MCP_VSCODE_REQUEST, 'stale-request');
      assert.ok(env.SystemRoot ?? env.SYSTEMROOT);
      assert.ok(env.Path ?? env.PATH);
      const request = JSON.parse(env.SHARED_MCP_VSCODE_REQUEST);
      void fetch(env.SHARED_MCP_VSCODE_CALLBACK, { method: 'POST',
        headers: { authorization: `Bearer ${env.SHARED_MCP_VSCODE_NONCE}`, 'content-type': 'application/json' },
        body: JSON.stringify({ binding: request.binding, issuedAt: Date.now(), accessToken: 'host-token',
          accountId: 'opaque-account', sessionId: 'opaque-session' }) });
      return new EventEmitter();
    },
    vscodeStop: async (command, profile, startedAt) => {
      stopped = true;
      assert.equal(command, 'C:\\fixture\\Code.exe');
      assert.ok(Number.isFinite(startedAt));
      const settings = JSON.parse(await readFile(join(profile, 'User', 'settings.json'), 'utf8'));
      assert.equal(settings['microsoft-authentication.implementation'], 'msal-no-broker');
    }
  });
  const result = await acquireVSCodeToken(f.provider, new VSCodeCredential(f.provider, discovery));
  assert.equal(result.accessToken, 'host-token');
  assert.equal(stopped, true);
  assert.deepEqual([...f.provider.vscodeProfilePaths],
    [vscodeProfilePath(f.provider, new VSCodeCredential(f.provider, discovery))]);
  let script;
  await stopVSCode('C:\\fixture\\Code.exe', 'C:\\private\\profile', Date.now(), async (_command, args, options) => {
    assert.equal(options.windowsHide, true, 'cleanup PowerShell remains non-GUI');
    script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    return { stdout: '{"verified":true,"remaining":0}' };
  });
  assert.match(script, /Stop-Process -Id \$id/);
  assert.match(script, /CreationDate -eq \$original.CreationDate/);
  assert.match(script, /ContainsKey\(\[int\]\$item.ParentProcessId\)/);
  assert.match(script, /CloseMainWindow/);
  assert.doesNotMatch(script, /Stop-Process -Name|taskkill/);
  await assert.rejects(stopVSCode('owned', 'profile', Date.now(), async () => { throw new Error('private diagnostics'); }),
    { code: 'vscode_cleanup_failed' });
});

test('privacy profile identity isolates aliases/config/issuer/scopes and reuses the same binding', async t => {
    const f = await fixture(t);
    const first = new VSCodeCredential(f.provider, discovery);
    const firstPath = vscodeProfilePath(f.provider, first);
    const same = await BackendOAuthProvider.load(f.config, f.stateDir);
    assert.equal(vscodeProfilePath(same, new VSCodeCredential(same, discovery)), firstPath);
    for (const config of [{ ...f.config, name: 'another-private-alias' },
      { ...f.config, oauth: { ...f.config.oauth, redirectPort: 43217 } }]) {
      const other = await BackendOAuthProvider.load(config, f.stateDir);
      assert.notEqual(vscodeProfilePath(other, new VSCodeCredential(other, discovery)), firstPath);
    }
    assert.notEqual(vscodeProfilePath(f.provider,
      new VSCodeCredential(f.provider, discovery, 'api://mail/McpServers.Mail.All')), firstPath);
    const tenantAuthority = 'https://login.microsoftonline.com/22222222-2222-2222-2222-222222222222';
    const tenantDiscovery = { authorizationServerUrl: `${tenantAuthority}/v2.0`,
      authorizationServerMetadata: { ...discovery.authorizationServerMetadata,
        issuer: `${tenantAuthority}/v2.0`, authorization_endpoint: `${tenantAuthority}/oauth2/v2.0/authorize`,
        token_endpoint: `${tenantAuthority}/oauth2/v2.0/token` },
      resourceMetadata: { ...discovery.resourceMetadata, authorization_servers: [`${tenantAuthority}/v2.0`] } };
    assert.notEqual(vscodeProfilePath(f.provider, new VSCodeCredential(f.provider, tenantDiscovery)), firstPath);
    assert.match(firstPath.split(/[\\/]/).at(-1), /^vscode-[a-f0-9]{64}$/);
    assert.equal(firstPath.includes(resource), false);
    assert.equal(firstPath.includes('another-private-alias'), false);
  });

test('privacy account selection cannot carry over from another alias binding', async t => {
    const f = await fixture(t, { interactive: true,
      vscodeAcquire: async () => ({ accessToken: 'host-token', accountKey }) });
    const other = await BackendOAuthProvider.load({ ...f.config, name: 'another-alias' }, f.stateDir);
    const foreign = new VSCodeCredential(other, discovery);
    f.provider.saved.vscode = { binding: foreign.binding, providerIdentity: foreign.providerIdentity,
      authority: foreign.authority, resource, accountKey: 'b'.repeat(64) };
    // Account-selection logic is independent of filesystem ACL integration.
    f.provider.withLock = operation => operation();
    f.provider.saveTokens = async tokens => { f.provider.pendingTokens = tokens; };
    await new VSCodeCredential(f.provider, discovery).silent();
    assert.equal(f.provider.pendingVSCode.accountKey, accountKey);
    f.provider.options.vscodeAcquire = async () => ({ accessToken: 'changed-token', accountKey: 'b'.repeat(64) });
    await assert.rejects(new VSCodeCredential(f.provider, discovery).silent('host-token'),
      { code: 'oauth_invalid_token' });
  });

test('privacy Code host environment excludes unrelated credentials and retains Windows launch variables', async () => {
  const env = microsoftHostEnv({ PATH: 'required-path', SystemRoot: 'required-root', COMSPEC: 'required-shell',
    HOME: 'required-home', USERPROFILE: 'required-profile', APPDATA: 'required-appdata',
    LOCALAPPDATA: 'required-local', TEMP: 'required-temp', TMP: 'required-tmp',
    REGISTERED_CLIENT_SECRET: 'excluded-secret', AZURE_CLIENT_SECRET: 'excluded-azure-secret',
    MSAL_UNRELATED_SECRET: 'excluded-msal-secret', HARMLESS_UNUSED: 'excluded-setting',
    ELECTRON_RUN_AS_NODE: '1', SHARED_MCP_VSCODE_NONCE: 'stale-nonce' });
  assert.deepEqual(Object.keys(env).sort(),
    ['PATH', 'SystemRoot', 'COMSPEC', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP'].sort());
  const launchEnv = microsoftHostEnv({ ...process.env,
    REGISTERED_CLIENT_SECRET: 'excluded-secret', AZURE_CLIENT_SECRET: 'excluded-azure-secret',
    MSAL_UNRELATED_SECRET: 'excluded-msal-secret', HARMLESS_UNUSED: 'excluded-setting',
    ELECTRON_RUN_AS_NODE: '1', SHARED_MCP_VSCODE_NONCE: 'stale-nonce' });
  const result = await promisify(execFile)(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
    { env: launchEnv, windowsHide: true });
  const child = JSON.parse(result.stdout);
  for (const name of ['REGISTERED_CLIENT_SECRET', 'AZURE_CLIENT_SECRET', 'MSAL_UNRELATED_SECRET',
    'HARMLESS_UNUSED', 'ELECTRON_RUN_AS_NODE', 'SHARED_MCP_VSCODE_NONCE']) assert.equal(child[name], undefined);
  assert.equal(child.Path ?? child.PATH, process.env.Path ?? process.env.PATH);
  if (process.platform === 'win32') assert.equal(child.SystemRoot ?? child.SYSTEMROOT,
    process.env.SystemRoot ?? process.env.SYSTEMROOT);
});

test('actual PowerShell verifies empty owned-process cleanup without launching an editor', { skip: process.platform !== 'win32' }, async () => {
  const started = Date.now();
  await stopVSCode('C:\\gateway-cleanup-fixture\\Code.exe',
    `C:\\gateway-cleanup-fixture\\nonexistent-profile-${randomBytes(16).toString('hex')}`, started);
  assert.ok(Date.now() - started < 15_000);
});

test('actual PowerShell selector handles versioned bootstrap descendants and preserves unrelated processes', { skip: process.platform !== 'win32' }, async () => {
  const startedAt = Date.now() - 2000;
  const rows = [
    { ProcessId: 0, ParentProcessId: 1, ExecutablePath: 'C:\\fixture\\Code.exe',
      CommandLine: '--user-data-dir "C:\\private\\profile"', offset: 500 },
    { ProcessId: 10, ParentProcessId: 1, ExecutablePath: 'C:\\fixture\\Code.exe',
      CommandLine: '"C:\\fixture\\Code.exe" --user-data-dir "C:\\private\\profile"', offset: 500 },
    { ProcessId: 11, ParentProcessId: 10, ExecutablePath: 'C:\\fixture\\7debcd0e2a\\Code.exe',
      CommandLine: '"C:\\fixture\\7debcd0e2a\\Code.exe" --user-data-dir="C:\\private\\profile"', offset: 600 },
    { ProcessId: 12, ParentProcessId: 11, ExecutablePath: 'C:\\fixture\\7debcd0e2a\\Code.exe',
      CommandLine: '--type=renderer', offset: 700 },
    { ProcessId: 20, ParentProcessId: 1, ExecutablePath: 'C:\\fixture\\7debcd0e2a\\Code.exe',
      CommandLine: '--user-data-dir "C:\\private\\profile-other"', offset: 500 },
    { ProcessId: 21, ParentProcessId: 11, ExecutablePath: 'C:\\browser\\browser.exe',
      CommandLine: '--user-data-dir "C:\\private\\profile"', offset: 500 },
    { ProcessId: 22, ParentProcessId: 1, ExecutablePath: 'C:\\elsewhere\\Code.exe',
      CommandLine: '--user-data-dir "C:\\private\\profile"', offset: 500 },
    { ProcessId: 23, ParentProcessId: 1, ExecutablePath: 'C:\\fixture\\Code.exe',
      CommandLine: '--user-data-dir "C:\\private\\profile"', offset: -500 }
  ];
  const prefix = `$fixture=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(rows)).toString('base64')}')))
$script:live=@($fixture | ForEach-Object { $_ | Add-Member CreationDate ([DateTimeOffset]::FromUnixTimeMilliseconds(${startedAt}+$_.offset).UtcDateTime) -PassThru })
$script:closed=@()
$script:stopped=@()
function Get-CimInstance { param($ClassName,$Filter) return $script:live }
function Get-Process {
 param([int]$Id,$ErrorAction)
 $row=$script:live | Where-Object ProcessId -eq $Id
 if (-not $row) { return $null }
 $process=[PSCustomObject]@{ Id=$Id; Path=$row.ExecutablePath; StartTime=$row.CreationDate; HasExited=$false }
 $process | Add-Member -MemberType ScriptMethod -Name CloseMainWindow -Value { $script:closed+= $this.Id; return $false }
 return $process
}
function Stop-Process {
 param([int]$Id,[switch]$Force,$ErrorAction)
 $script:stopped+=$Id
 $script:live=@($script:live | Where-Object ProcessId -ne $Id)
}
`;
  const suffix = `
if (($script:closed | Sort-Object) -join ',' -ne '10,11,12') { throw 'Wrong graceful targets' }
if (($script:stopped | Sort-Object) -join ',' -ne '10,11,12') { throw 'Wrong termination targets' }
`;
  await stopVSCode('C:\\fixture\\Code.exe', 'C:\\private\\profile', startedAt, async (command, args, options) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    const encoded = Buffer.from(prefix + script + suffix, 'utf16le').toString('base64');
    return promisify(execFile)(command, [...args.slice(0, -1), encoded], options);
  }, { pid: 10, deadline: Date.now() + 15_000 });
});

test('cleanup requires explicit verified output and obeys the remaining deadline', async () => {
  await assert.rejects(stopVSCode('C:\\fixture\\Code.exe', 'C:\\private\\profile', Date.now(),
    async () => ({ stdout: '{}' })), { code: 'vscode_cleanup_failed' });
  await assert.rejects(stopVSCode('C:\\fixture\\Code.exe', 'C:\\private\\profile', Date.now(),
    async () => assert.fail('expired cleanup cannot launch'), { deadline: Date.now() - 1 }),
  { code: 'vscode_cleanup_failed' });
  await stopVSCode('C:\\fixture\\Code.exe', 'C:\\private\\profile', Date.now(),
    async (_command, _args, options) => {
      assert.ok(options.timeout > 0 && options.timeout <= 12_000);
      return { stdout: '{"verified":true,"remaining":0}' };
    }, { deadline: Date.now() + 12_000 });
});

test('owned helper timeout closes callback and performs cleanup', async t => {
  let stopped = false;
  const f = await fixture(t, { interactive: true,
    vscodeResolver: async () => 'C:\\fixture\\Code.exe',
    vscodeSpawn: () => new EventEmitter(), vscodeStop: async () => { stopped = true; }
  });
  // Set the deadline after private ACL work so the launch itself reaches timeout.
  f.provider.options.vscodeSpawn = () => {
    f.provider.options.signalController?.abort();
    return new EventEmitter();
  };
  const controller = new AbortController();
  f.provider.options.signal = controller.signal;
  f.provider.options.signalController = controller;
  await assert.rejects(acquireVSCodeToken(f.provider, new VSCodeCredential(f.provider, discovery)),
    { code: 'oauth_cancelled' });
  assert.equal(stopped, true);
});

for (const rejectTools of [false, true]) {
  test(`SDK helper verifies step-up and publishes only after initialize/list: rejectTools=${rejectTools}`, async t => {
    let scopes;
    let acquisitions = 0;
    const f = await fixture(t);
    t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
      const url = String(input);
      const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value),
        { status, headers: { 'content-type': 'application/json', ...headers } });
      if (url.includes('oauth-protected-resource')) return json(discovery.resourceMetadata);
      if (url.includes('.well-known/')) return json(discovery.authorizationServerMetadata);
      if (!new Headers(init.headers).has('authorization')) return json({}, 401,
        { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"' });
      if (!scopes.includes('api://mail/McpServers.Mail.All')) return json({ error: {
        message: "Access denied: Scope 'McpServers.Mail.All' is not present in the request."
      } }, 403);
      if (init.method !== 'POST') return json({}, 405);
      const message = JSON.parse(init.body);
      if (!Object.hasOwn(message, 'id')) return new Response(null, { status: 202 });
      if (message.method === 'tools/list' && rejectTools) return json({}, 403);
      return json({ jsonrpc: '2.0', id: message.id, result: message.method === 'initialize' ?
        { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } :
        { tools: [{ name: 'readonlySearch', inputSchema: { type: 'object' } }] } });
    });
    const operation = authenticateBackend(f.config, f.stateDir, { vscode: true,
      vscodeAcquire: async (_provider, credential) => {
        acquisitions++; scopes = credential.scopes; return { accessToken: `opaque-token-${acquisitions}`, accountKey };
      }
    });
    if (rejectTools) {
      await assert.rejects(operation);
      assert.equal(JSON.parse(await readFile(f.provider.path, 'utf8')).tokens, undefined);
    } else {
      assert.equal((await operation).authenticated, true);
      assert.deepEqual(JSON.parse(await readFile(f.provider.path, 'utf8')).vscode.scopes, ['api://mail/McpServers.Mail.All']);
    }
    assert.equal(acquisitions, 2);
  });
}

test('ordinary safe HTTP 403 scope hints require explicit consent without UI', async t => {
  const f = await fixture(t, { interactive: true,
    vscodeAcquire: async () => ({ accessToken: 'opaque-token', accountKey }) });
  await f.provider.saveDiscoveryState(discovery);
  await (await f.provider.microsoftCredential(discovery)).silent();
  await f.provider.commitTokens();
  const ordinary = await BackendOAuthProvider.load(f.config, f.stateDir, {
    vscodeAcquire: () => assert.fail('no UI')
  });

  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: {
    message: "Access denied: Scope 'McpServers.Mail.All' is not present in the request."
  } }), { status: 403 }));
  await assert.rejects(ordinary.fetch(boundedOAuthFetch(undefined, 1000, f.config))(resource),
    error => error.code === 'auth_required' && error.requiredScopes[0] === 'api://mail/McpServers.Mail.All');
});

test('actual registry SDK readonly tool and reconnect preserve the complete result without host UI', async t => {
    let acquisitions = 0;
    const f = await fixture(t);
    const expected = { content: [{ type: 'text', text: 'readonly-result' }],
      structuredContent: { fixture: true }, _meta: { trace: 'fixture-trace' }, isError: false };
    const urls = [];
    t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
      const url = String(input);
      urls.push(url);
      const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body),
        { status, headers: { 'content-type': 'application/json', ...headers } });
      if (url.includes('oauth-protected-resource')) return json(discovery.resourceMetadata);
      if (url.includes('.well-known/')) return json(discovery.authorizationServerMetadata);
      assert.equal(url, resource);
      if (new Headers(init.headers).get('authorization') !== 'Bearer opaque-token') return json({}, 401,
        { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"' });
      if (init.method !== 'POST') return json({}, 405);
      const message = JSON.parse(init.body);
      if (!Object.hasOwn(message, 'id')) return new Response(null, { status: 202 });
      const result = message.method === 'initialize' ? { protocolVersion: '2025-11-25',
        capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } :
        message.method === 'tools/list' ? { tools: [{ name: 'readonlySearch', inputSchema: {
          type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] } : expected;
      return json({ jsonrpc: '2.0', id: message.id, result });
    });
    await authenticateBackend(f.config, f.stateDir, { vscode: true, vscodeAcquire: async () => {
      acquisitions++; return { accessToken: 'opaque-token', accountKey };
    } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const registry = new BackendRegistry(new Map([['mail', f.config]]), { stateDir: f.stateDir });
      try {
        assert.deepEqual(await registry.callTool('mail', 'readonlySearch', { query: 'fixture' }), expected);
        await assert.rejects(registry.callTool('mail', 'readonlySearch', { query: 1 }));
      } finally { await registry.close(); }
    }
    assert.equal(acquisitions, 1);
    assert.equal(urls.some(url => /register|\/token$/.test(url)), false);
});
