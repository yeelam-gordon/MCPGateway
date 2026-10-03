import { spawn, execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { GatewayError } from './errors.js';
import { microsoftResourceScopes, requiredMicrosoftScopes } from './microsoft-resource-scopes.js';
import { microsoftHostEnv } from './microsoft-host-env.js';
import { validateAccessToken } from './oauth-access-token.js';

export async function resolveAzureCli({ platform = process.platform, env = process.env, read = readFile, exists = access } = {}) {
  const paths = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  if (platform === 'win32') {
    const path = win32;
    const candidates = paths.map(directory => path.join(directory, 'az.cmd'));
    if (env['ProgramFiles(x86)']) candidates.push(path.join(env['ProgramFiles(x86)'], 'Microsoft SDKs', 'Azure', 'CLI2', 'wbin', 'az.cmd'));
    for (const candidate of candidates) {
      let shim;
      try { shim = await read(candidate, 'utf8'); }
      catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue; throw new GatewayError('azure_cli_unavailable', 'Cannot inspect Azure CLI installation'); }
      if (!/Microsoft Azure CLI - Windows Installer/.test(shim) ||
          !/"%~dp0\\\.\.\\python\.exe"\s+-IBm azure\.cli %\*/.test(shim) ||
          !/SET AZ_INSTALLER=MSI/.test(shim)) continue;
      const command = path.resolve(path.dirname(candidate), '..', 'python.exe');
      try { await exists(command, constants.F_OK); }
      catch (error) { if (error.code === 'ENOENT') continue; throw new GatewayError('azure_cli_unavailable', 'Cannot access Azure CLI installation'); }
      return { command, prefix: ['-IBm', 'azure.cli'], env: { AZ_INSTALLER: 'MSI' } };
    }
  } else {
    for (const directory of paths) {
      const command = posix.join(directory, 'az');
      try { await exists(command, constants.X_OK); }
      catch (error) { if (['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) continue; throw new GatewayError('azure_cli_unavailable', 'Cannot access Azure CLI installation'); }
      return { command, prefix: [], env: {} };
    }
  }
  return undefined;
}

// Only fixed Azure CLI operations reach this runner; no shell or user command text.
export function runAzureCli(launch, args, { signal, timeoutMs = 25_000, login = false, deviceCode = false, onDeviceCode } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(launch.command, [...launch.prefix, ...args], {
      shell: false, windowsHide: true,
      env: microsoftHostEnv(process.env, { azureCli: true, overrides: { ...launch.env, ...(login ? {
        AZURE_CORE_ENABLE_BROKER_ON_WINDOWS: 'false', AZURE_CORE_LOGIN_EXPERIENCE_V2: 'off'
      } : {}) } }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let diagnostics = '';
    let stopped = false;
    let forceTimer;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => {
        if (process.platform === 'win32' && child.pid) {
          execFile('taskkill.exe', ['/PID', String(child.pid), '/F'],
            { timeout: 3000, windowsHide: true }, () => {});
        } else child.kill('SIGKILL');
      }, 500);
    };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.length > 1_048_576) stop();
    });
    let prompted = false;
    child.stderr.on('data', chunk => {
      diagnostics = (diagnostics + chunk.toString()).slice(-8192);
      const prompt = diagnostics.match(/https:\/\/(?:microsoft\.com\/devicelogin|login\.microsoftonline\.com\/[^ \r\n]*)[^\r\n]*\bcode\s+([A-Z0-9-]{4,32})\b/i);
      if (deviceCode && prompt && !prompted) {
        prompted = true;
        const value = { verificationUri: 'https://microsoft.com/devicelogin', userCode: prompt[1] };
        if (onDeviceCode) onDeviceCode(value);
        else console.log(`Open ${value.verificationUri} and enter code ${value.userCode}.`);
      }
    });
    const cleanup = () => { clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', stop); };
    child.once('error', () => { cleanup(); reject(new GatewayError('azure_cli_unavailable', 'Cannot start Azure CLI')); });
    child.once('close', code => {
      cleanup();
      if (stopped) return reject(new GatewayError('oauth_cancelled', 'Azure CLI acquisition cancelled or timed out'));
      if (code !== 0) {
        const aadsts = diagnostics.match(/\bAADSTS\d{5,9}\b/)?.[0];
        if (aadsts === 'AADSTS65002') {
          return reject(new GatewayError('oauth_provider_not_preauthorized',
            'The selected Microsoft Azure CLI credential provider is not preauthorized for this API/scope (AADSTS65002). Use a supported host provider authorized for this resource; signing in again or user consent cannot resolve this provider mismatch.'));
        }
        return reject(new GatewayError('auth_required', `Azure CLI sign-in or consent is required${aadsts ? ` (${aadsts})` : ''}`));
      }
      resolve(output);
    });
  });
}

export function azureCliToken(text) {
  let result;
  try { result = JSON.parse(text); }
  catch { throw new GatewayError('oauth_invalid_token', 'Azure CLI returned invalid token JSON'); }
  const expiresAt = result?.expires_on !== undefined ? Number(result.expires_on) * 1000 :
    typeof result?.expiresOn === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(result.expiresOn) ? Date.parse(result.expiresOn) : NaN;
  validateAccessToken(result?.accessToken);
  if (typeof result.tokenType !== 'string' || result.tokenType.toLowerCase() !== 'bearer' ||
      !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000 ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(result.tenant ?? '')) {
    throw new GatewayError('oauth_invalid_token', 'Azure CLI returned an invalid token, tenant or expiry');
  }
  return { tokens: { access_token: result.accessToken, token_type: 'Bearer' }, expiresAt, tenant: result.tenant.toLowerCase() };
}

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function cliAccount(text) {
  let account;
  try { account = JSON.parse(text); }
  catch { throw new GatewayError('oauth_invalid_token', 'Azure CLI returned invalid account metadata'); }
  if (account?.environmentName !== 'AzureCloud' || account.user?.type !== 'user' ||
      typeof account.user.name !== 'string' || !account.user.name || !uuid.test(account.tenantId ?? '')) {
    throw new GatewayError('oauth_invalid_token', 'Azure CLI requires a delegated account in the verified Microsoft public cloud');
  }
  return { ...account, tenantId: account.tenantId.toLowerCase() };
}

function cliAuthority(value) {
  return typeof value === 'string' ? value.replace(/\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i,
    (_match, tenant) => `/${tenant.toLowerCase()}`) : value;
}

function cliAccountKey(account, tenant) {
  return createHash('sha256').update(JSON.stringify([account.user.type, account.user.name, tenant])).digest('hex');
}

export class AzureCliCredential {
  constructor(provider, discovery, scope, launch) {
    this.provider = provider;
    this.launch = launch;
    Object.assign(this, microsoftResourceScopes(discovery, scope, provider));
    this.authority = cliAuthority(this.authority);
    this.binding = JSON.stringify(['azure-cli', provider.path, this.authority, discovery.resourceMetadata.resource, this.trustedResource, this.scopes]);
    this.resource = discovery.resourceMetadata.resource;
    this.advertisedScopes = discovery.resourceMetadata.scopes_supported ?? [];
  }

  requiredScopes(name) {
    return requiredMicrosoftScopes(this.advertisedScopes, this.scopes, name);
  }

  async silent(rejectedToken, { requireLogin = false } = {}) {
    const provider = this.provider;
    if (requireLogin && !provider.options.interactive) {
      throw new GatewayError('auth_required', 'Additional Microsoft consent requires the explicit helper');
    }
    if (provider.azureCliFlight) return provider.azureCliFlight;
    const operation = provider.withLock(async () => {
      const forceLogin = requireLogin || provider.options.interactive && provider.options.forceLogin && !provider.azureCliLoginPerformed;
      const current = provider.pendingAzureCli ?? provider.saved.azureCli;
      if (!forceLogin && current?.binding === this.binding && provider.tokens()?.access_token !== rejectedToken &&
          provider.expiresAt > Date.now() + 30_000) return;
      let sameBackend = false;
      try {
        const identity = JSON.parse(current?.binding);
        sameBackend = Array.isArray(identity) && identity[0] === 'azure-cli' && identity[1] === provider.path;
      } catch {}
      const sameAuthority = cliAuthority(current?.authority) === this.authority && current?.resource === this.resource;
      if (current && sameAuthority && !sameBackend) {
        throw new GatewayError('oauth_invalid_token', 'Azure CLI selection belongs to a different backend identity');
      }
      const selection = current?.binding === this.binding || sameBackend && sameAuthority ? current : undefined;
      const advertisedTenant = new URL(this.authority).pathname.slice(1);
      if (selection && !uuid.test(selection.tenant ?? '')) throw new GatewayError('oauth_invalid_token', 'Azure CLI selection has an invalid tenant');
      const tenant = selection?.tenant?.toLowerCase() ?? (advertisedTenant !== 'organizations' ? advertisedTenant : undefined);
      const runner = provider.options.azureCliRunner ?? runAzureCli;
      let silentDeadline = Date.now() + 25_000;
      const silentOptions = () => ({ signal: provider.options.signal, timeoutMs: Math.max(1, silentDeadline - Date.now()) });
      const args = ['account', 'get-access-token', '--scope', this.scopes.join(' '),
        ...(tenant ? ['--tenant', tenant] : []), '--output', 'json', '--only-show-errors'];
      const acquire = () => runner(this.launch, args, silentOptions());
      const login = async () => {
        if (!provider.options.interactive) throw new GatewayError('auth_required', 'Azure CLI login requires the explicit helper');
        if (provider.options.noBrowser && !provider.options.deviceCode) {
          throw new GatewayError('oauth_unsupported_flow', 'Azure CLI --no-browser requires explicit --device-code');
        }
        let existing;
        try {
          existing = cliAccount(await runner(this.launch, ['account', 'show', '--output', 'json', '--only-show-errors'], silentOptions()));
        } catch (error) {
          if (error.code !== 'auth_required') throw error;
        }
        if (existing && (existing.isDefault !== true || !uuid.test(existing.id ?? ''))) {
          throw new GatewayError('oauth_invalid_flow', 'Cannot preserve the existing Azure CLI default context safely');
        }
        const loginTenant = tenant ?? existing?.tenantId;
        try {
          await runner(this.launch, ['login', '--scope', this.scopes.join(' '), '--allow-no-subscriptions',
            ...(loginTenant ? ['--tenant', loginTenant] : []), ...(provider.options.deviceCode ? ['--use-device-code'] : []),
            '--output', 'none', '--only-show-errors'], {
            signal: provider.options.signal, login: true, deviceCode: provider.options.deviceCode,
            onDeviceCode: provider.options.onDeviceCode,
            timeoutMs: Math.max(1, (provider.options.deadline ?? Date.now() + 180_000) - Date.now() - (existing ? 5000 : 0))
          });
          provider.azureCliLoginPerformed = true;
        } finally {
          if (existing) {
            // Restore only the exact validated default; never clear accounts or
            // write global configuration. Cleanup also runs after cancellation.
            try {
              await runner(this.launch, ['account', 'set', '--subscription', existing.id, '--output', 'none', '--only-show-errors'],
                { timeoutMs: 5000 });
            } catch {
              throw new GatewayError('azure_cli_context_restore_failed', 'Cannot restore the previous Azure CLI default subscription; restore your CLI context explicitly');
            }
          }
        }
        silentDeadline = Date.now() + 25_000;
      };
      let text;
      if (forceLogin) await login();
      try { text = await acquire(); }
      catch (error) {
        if (error.code !== 'auth_required' || !provider.options.interactive) throw error;
        if (provider.azureCliLoginPerformed) throw error;
        await login();
        text = await acquire();
      }
      provider.options.signal?.throwIfAborted();
      const result = azureCliToken(text);
      const account = cliAccount(await runner(this.launch, ['account', 'show', '--output', 'json', '--only-show-errors'],
        silentOptions()));
      if (account.tenantId.toLowerCase() !== result.tenant.toLowerCase()) {
        throw new GatewayError('oauth_invalid_token', 'Azure CLI requires a delegated account matching the returned token tenant');
      }
      const accountKey = cliAccountKey(account, result.tenant);
      const legacyKey = selection ? cliAccountKey(account, selection.tenant) : undefined;
      if (selection && selection.tenant.toLowerCase() !== result.tenant ||
          selection?.accountKey && selection.accountKey !== accountKey && selection.accountKey !== legacyKey ||
          /^[0-9a-f-]{36}$/i.test(advertisedTenant) && advertisedTenant.toLowerCase() !== result.tenant.toLowerCase()) {
        throw new GatewayError('oauth_invalid_token', 'Azure CLI token tenant does not match the verified selection');
      }
      provider.options.signal?.throwIfAborted();
      const state = { credentialProvider: 'azure-cli', binding: this.binding, authority: this.authority,
        resource: this.resource, tenant: result.tenant, accountKey, scopes: this.scopes };
      await provider.saveTokens(result.tokens, true, result.expiresAt);
      if (provider.options.interactive) provider.pendingAzureCli = state;
      else { provider.saved.azureCli = state; await provider.persist(); }
    });
    provider.azureCliFlight = operation;
    try { return await operation; }
    finally { if (provider.azureCliFlight === operation) provider.azureCliFlight = undefined; }
  }
}
