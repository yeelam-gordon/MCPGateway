import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BackendOAuthProvider } from '../src/backend-oauth.js';
import { AzureCliCredential, azureCliToken } from '../src/azure-cli-credential.js';
import { acquireServiceTokens } from '../src/oauth-client-auth.js';
import { acquireDeviceTokens, DEVICE_GRANT } from '../src/oauth-device.js';
import { isValidAccessToken, validateAccessToken } from '../src/oauth-access-token.js';

const invalid = ['', 'TOKEN_CANARY space', 'TOKEN_CANARY\t', 'TOKEN_CANARY\0',
  'TOKEN_CANARY\r\n', 'TOKEN_CANARY\x7f', 'TOKEN_CANARY\x85', 'TOKEN_CANARY\u00a0',
  'TOKEN_CANARY\u0100', undefined, null, 123, {}];
const opaque = 'opaque.token+/=_-';
const rejected = error => error.code === 'oauth_invalid_token' && !error.message.includes('TOKEN_CANARY');
const issuer = 'https://issuer.example';
const resource = 'https://resource.example/mcp';
const discovery = { authorizationServerUrl: issuer,
  authorizationServerMetadata: { issuer, token_endpoint: `${issuer}/token`,
    device_authorization_endpoint: `${issuer}/device`, grant_types_supported: [DEVICE_GRANT, 'client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post'] },
  resourceMetadata: { resource, authorization_servers: [issuer], scopes_supported: ['read'] } };
const response = access_token => new Response(JSON.stringify({ access_token, token_type: 'Bearer', expires_in: 3600 }),
  { headers: { 'content-type': 'application/json' } });

function provider(interactive = false, service = false) {
  const oauth = service ? { clientId: 'fixture', issuer, grantType: 'client_credentials',
    tokenEndpointAuthMethod: 'client_secret_post', secretEnv: 'UNUSED_FIXTURE_SECRET' } : { clientId: 'fixture' };
  const p = new BackendOAuthProvider({ name: 'fixture', url: resource, oauth }, process.cwd(), { interactive });
  p.saved = { revision: 'original', discovery, tokens: { access_token: opaque, token_type: 'Bearer' },
    expiresAt: Date.now() + 3600_000 };
  p.revision = p.saved.revision;
  p.withLock = operation => operation();
  p.readState = async () => structuredClone(p.saved);
  p.persistCount = 0;
  p.persist = async () => { p.persistCount++; };
  p.addClientAuthentication = async (_headers, params) => { params.set('client_id', 'fixture'); };
  return p;
}

test('shared access-token validation rejects control canaries without trimming, decoding or disclosure', () => {
  for (const value of invalid) {
    assert.equal(isValidAccessToken(value), false);
    assert.throws(() => validateAccessToken(value), rejected);
  }
  for (const value of [opaque, 'non-jwt', 'opaque-é']) assert.equal(validateAccessToken(value), value);
});

test('Azure CLI malformed tokens fail before account lookup, selection mutation or publication', async () => {
  const tenant = '22222222-2222-2222-2222-222222222222';
  const authority = 'https://login.microsoftonline.com/organizations';
  const info = { authorizationServerUrl: `${authority}/v2.0`,
    authorizationServerMetadata: { issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
      authorization_endpoint: `${authority}/oauth2/v2.0/authorize`, token_endpoint: `${authority}/oauth2/v2.0/token` },
    resourceMetadata: { resource, authorization_servers: [`${authority}/v2.0`], scopes_supported: ['api://fixture/Read'] } };
  const p = provider();
  p.config.oauth = { credentialProvider: 'azure-cli', resource: 'api://fixture' };
  const before = JSON.stringify(p.saved);
  for (const value of invalid) {
    const body = JSON.stringify({ accessToken: value, tokenType: 'Bearer', tenant,
      expires_on: Math.floor(Date.now() / 1000) + 3600 });
    assert.throws(() => azureCliToken(body), rejected);
    p.options.azureCliRunner = async (_launch, args) => {
      assert.equal(args[1], 'get-access-token', 'invalid token must fail before account lookup');
      return body;
    };
    await assert.rejects(new AzureCliCredential(p, info, undefined, {}).silent(opaque), rejected);
    assert.equal(JSON.stringify(p.saved), before);
    assert.equal(p.pendingAzureCli, undefined);
    assert.equal(p.persistCount, 0);
  }
  assert.equal(azureCliToken(JSON.stringify({ accessToken: opaque, tokenType: 'Bearer', tenant,
    expires_on: Math.floor(Date.now() / 1000) + 3600 })).tokens.access_token, opaque);
});

test('generic saveTokens and refresh reject malformed tokens without changing valid saved or pending credentials', async () => {
  for (const interactive of [false, true]) {
    const p = provider(interactive);
    const before = JSON.stringify(p.saved);
    for (const value of invalid) {
      await assert.rejects(p.saveTokens({ access_token: value, token_type: 'Bearer' }), rejected);
      await assert.rejects(p.fetch(async () => response(value))(`${issuer}/token`,
        { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token' }) }), rejected);
      assert.equal(JSON.stringify(p.saved), before);
      assert.equal(p.pendingTokens, undefined);
      assert.equal(p.persistCount, 0);
    }
    p.pendingTokens = { access_token: 'TOKEN_CANARY\t', token_type: 'Bearer' };
    await assert.rejects(p.commitTokens(), rejected);
    assert.equal(JSON.stringify(p.saved), before);
    assert.equal(p.persistCount, 0);
  }
});

test('service renewal rejects malformed SDK token responses before mutating or persisting the prior valid selection', async () => {
  const p = provider(false, true);
  p.saved.service = { binding: 'previous-selection', scope: 'previous' };
  const before = JSON.stringify(p.saved);
  for (const value of invalid) {
    await assert.rejects(acquireServiceTokens(p, discovery, 'read', async () => response(value), opaque), rejected);
    assert.equal(JSON.stringify(p.saved), before);
    assert.equal(p.persistCount, 0);
    assert.equal(p.pendingTokens, undefined);
  }
});

test('obsolete service response cannot overwrite newer tokens or MSAL/host selection metadata', async () => {
  const p = provider(false, true);
  const obsolete = p.generation;
  p.saved.tokens = { access_token: 'newer-opaque-token', token_type: 'Bearer' };
  p.saved.service = { binding: 'newer-service-owner', scope: 'newer' };
  p.saved.entra = { binding: 'newer-msal-owner' };
  p.saved.vscode = { binding: 'newer-host-owner' };
  const before = JSON.stringify(p.saved);
  await p.context.run({ generation: obsolete }, () =>
    acquireServiceTokens(p, discovery, 'obsolete', async () => response(opaque)));
  assert.equal(JSON.stringify(p.saved), before);
  assert.equal(p.persistCount, 0);
});

test('device grants reject malformed SDK token responses before creating any pending selection or tokens', async () => {
  const p = provider(true);
  let clock = Date.now();
  Object.assign(p.options, { deadline: clock + 600_000, onDeviceCode: () => {},
    deviceClock: { now: () => clock, sleep: async ms => { clock += ms; } } });
  const before = JSON.stringify(p.saved);
  for (const value of invalid) {
    await assert.rejects(acquireDeviceTokens(p, discovery, 'read', async url => String(url).endsWith('/device') ?
      new Response(JSON.stringify({ device_code: 'synthetic', user_code: 'SYNTHETIC', verification_uri: `${issuer}/verify`,
        expires_in: 120, interval: 1 })) : response(value)), rejected);
    assert.equal(JSON.stringify(p.saved), before);
    assert.equal(p.pendingDevice, undefined);
    assert.equal(p.pendingTokens, undefined);
    assert.equal(p.persistCount, 0);
  }
});

test('valid opaque service and device tokens retain existing publication behavior', async () => {
  const service = provider(false, true);
  await acquireServiceTokens(service, discovery, 'read', async () => response(opaque), opaque);
  assert.equal(service.tokens().access_token, opaque);
  assert.equal(service.persistCount, 1);
  const device = provider(true);
  let clock = Date.now();
  Object.assign(device.options, { deadline: clock + 60_000, onDeviceCode: () => {},
    deviceClock: { now: () => clock, sleep: async ms => { clock += ms; } } });
  await acquireDeviceTokens(device, discovery, 'read', async url => String(url).endsWith('/device') ?
    new Response(JSON.stringify({ device_code: 'synthetic', user_code: 'SYNTHETIC', verification_uri: `${issuer}/verify`,
      expires_in: 120, interval: 1 })) : response(opaque));
  assert.equal(device.pendingTokens.access_token, opaque);
  assert.ok(device.pendingDevice);
  assert.equal(device.persistCount, 0);
});
