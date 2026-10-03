import { spawn, execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { GatewayError } from './errors.js';
import { secureOwnerOnly } from './token.js';
import { microsoftResourceScopes, requiredMicrosoftScopes } from './microsoft-resource-scopes.js';
import { microsoftHostEnv } from './microsoft-host-env.js';

export function vscodeProfilePath(provider, credential) {
  return join(provider.directory, `vscode-${createHash('sha256')
    .update(JSON.stringify([provider.path, credential.binding])).digest('hex')}`);
}

export async function resolveVSCode({ env = process.env, exists = access } = {}) {
  if (process.platform !== 'win32') throw new GatewayError('vscode_unavailable', 'This bounded VS Code helper currently supports Windows only');
  for (const base of [env.ProgramFiles, env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean)) {
    const command = join(base, 'Microsoft VS Code', 'Code.exe');
    try { await exists(command); return command; }
    catch (error) { if (error.code !== 'ENOENT') throw new GatewayError('vscode_unavailable', 'Cannot access Microsoft VS Code'); }
  }
  throw new GatewayError('vscode_unavailable', 'Install Microsoft VS Code to use the explicit --vscode helper');
}

export function vscodeCallback({ nonce, binding, startedAt, deadline, onReady, onResult, isClosing }) {
  let consumed = false;
  return async (request, response) => {
    const reject = () => response.writeHead(400).end('Invalid host callback');
    const authorization = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${nonce}`);
    const path = '/host-token';
    if (request.headers.host !== `127.0.0.1:${request.socket.localPort}` || request.headers.origin ||
        request.headers['sec-fetch-site'] || authorization.length !== expected.length ||
        !timingSafeEqual(authorization, expected) || Date.now() > deadline && !isClosing()) return reject();
    if (request.method === 'GET' && request.url === `${path}/status`) {
      response.writeHead(isClosing() ? 410 : 204).end(); return;
    }
    if (request.method !== 'POST' || ![path, `${path}/ready`].includes(request.url) || isClosing() || consumed ||
        request.headers['content-type'] !== 'application/json' ||
        !/^\d+$/.test(request.headers['content-length'] ?? '') ||
        Number(request.headers['content-length']) > 65_536) return reject();
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 65_536) return reject();
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (body.binding !== binding) return reject();
      if (request.url.endsWith('/ready')) {
        response.writeHead(204).end(); onReady(); return;
      }
      if (!Number.isFinite(body.issuedAt) || body.issuedAt < startedAt || body.issuedAt > Date.now() + 1000 ||
          body.error !== undefined && body.error !== 'auth_required' ||
          !body.error && (typeof body.accessToken !== 'string' || !body.accessToken ||
            /[\s\x00-\x1f\x7f]/.test(body.accessToken) || typeof body.sessionId !== 'string' || !body.sessionId ||
            typeof body.accountId !== 'string' || !body.accountId)) return reject();
      response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      consumed = true;
      onResult(body);
    } catch { if (!response.headersSent) reject(); }
  };
}

export async function stopVSCode(command, profile, startedAt, run = promisify(execFile), options = {}) {
  const timeout = Math.min(15_000, (options.deadline ?? Date.now() + 15_000) - Date.now());
  if (timeout <= 0) throw new GatewayError('vscode_cleanup_failed', 'No time remains to verify isolated VS Code cleanup');
  const payload = Buffer.from(JSON.stringify({ command, profile, startedAt, pid: options.pid })).toString('base64');
  const script = `$ErrorActionPreference='Stop'
$p=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')))
$base=[IO.Path]::GetDirectoryName($p.command)
$start=[DateTimeOffset]::FromUnixTimeMilliseconds($p.startedAt).UtcDateTime
$marker='(?:^|\\s)--user-data-dir(?:=|\\s+)(?:"'+[regex]::Escape($p.profile)+'"|'+[regex]::Escape($p.profile)+')(?=\\s|$)'
$versioned='^'+[regex]::Escape($base)+'\\\\[0-9a-f]{7,40}\\\\Code\\.exe$'
$known=@{}
function Is-Editor($item) {
 return $item -and $item.ExecutablePath -and ($item.ExecutablePath -eq $p.command -or $item.ExecutablePath -match $versioned) -and $item.CreationDate -and $item.CreationDate.ToUniversalTime() -ge $start
}
function Same-Identity($item,$original) {
 return $item -and $original -and $item.CreationDate -eq $original.CreationDate -and $item.ExecutablePath -eq $original.ExecutablePath
}
function Find-Owned($snapshot) {
 $owned=@{}
 foreach ($item in $snapshot) {
  $id=[int]$item.ProcessId
  if ($id -le 0) { continue }
  if ((Is-Editor $item) -and (($item.CommandLine -and $item.CommandLine -match $marker) -or (Same-Identity $item $known[$id]))) {
   $owned[$id]=$item
  }
 }
 do {
  $added=$false
  foreach ($item in $snapshot) {
   $id=[int]$item.ProcessId
   if ($id -le 0 -or [int]$item.ParentProcessId -le 0) { continue }
   if (-not $owned.ContainsKey($id) -and $owned.ContainsKey([int]$item.ParentProcessId) -and (Is-Editor $item) -and $item.CreationDate -ge $owned[[int]$item.ParentProcessId].CreationDate) {
    $owned[$id]=$item
    $added=$true
   }
  }
 } while ($added)
 foreach ($id in @($owned.Keys)) { $known[$id]=$owned[$id] }
 return @($owned.Values)
}
function Get-VerifiedProcess($item) {
 if (-not $item -or [int]$item.ProcessId -le 0) { throw 'Invalid editor process identity' }
 $process=Get-Process -Id ([int]$item.ProcessId) -ErrorAction SilentlyContinue
 if (-not $process) { return $null }
 try {
  if ($process.HasExited) { return $null }
  if ($process.Path -ne $item.ExecutablePath -or [Math]::Abs(($process.StartTime.ToUniversalTime()-$item.CreationDate.ToUniversalTime()).TotalMilliseconds) -gt 1) { throw 'Editor process identity changed' }
 } catch { if ($process.HasExited) { return $null }; throw }
 return $process
}
$owned=@(Find-Owned @(Get-CimInstance Win32_Process -Filter "Name='Code.exe'"))
foreach ($item in @($owned | Sort-Object @{Expression={ if ($_.ProcessId -eq $p.pid) { 0 } else { 1 } }})) {
 $process=Get-VerifiedProcess $item
 if ($process) { [void]$process.CloseMainWindow() }
}
if ($owned.Count -gt 0) { Start-Sleep -Milliseconds 1500 }
$owned=@(Find-Owned @(Get-CimInstance Win32_Process -Filter "Name='Code.exe'"))
foreach ($item in $owned) {
 $id=[int]$item.ProcessId
 $process=Get-VerifiedProcess $item
 if ($process) {
  try { Stop-Process -Id $id -Force -ErrorAction Stop }
  catch { if (-not $process.HasExited) { throw } }
 }
}
$remaining=@(Find-Owned @(Get-CimInstance Win32_Process -Filter "Name='Code.exe'"))
if ($remaining.Count -ne 0) { throw 'Isolated editor processes remain' }
ConvertTo-Json -Compress @{ verified=$true; remaining=0 }`;
  try {
    const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { timeout, windowsHide: true });
    const report = JSON.parse(result.stdout);
    if (report.verified !== true || report.remaining !== 0) throw new Error('Cleanup verification missing');
  } catch { throw new GatewayError('vscode_cleanup_failed', 'Cannot verify cleanup of the isolated VS Code helper; close only its authentication window explicitly'); }
}

export async function acquireVSCodeToken(provider, credential) {
  const options = provider.options;
  if (!options.interactive) throw new GatewayError('auth_required', 'VS Code sign-in requires the explicit --vscode helper');
  if (options.deviceCode || options.noBrowser) throw new GatewayError('oauth_unsupported_flow', 'VS Code host sign-in requires its explicit permission and browser flow');
  const command = await (options.vscodeResolver ?? resolveVSCode)();
  const profile = vscodeProfilePath(provider, credential);
  (provider.vscodeProfilePaths ??= new Set()).add(profile);
  await mkdir(join(profile, 'User'), { recursive: true, mode: 0o700 });
  await mkdir(join(profile, 'extensions'), { recursive: true, mode: 0o700 });
  await secureOwnerOnly([{ path: profile, directory: true }], options);
  await writeFile(join(profile, 'User', 'settings.json'), JSON.stringify({
    'microsoft-authentication.implementation': 'msal-no-broker',
    'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off',
    'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false
  }), { mode: 0o600 });
  const startedAt = Date.now();
  // Leave room for owned-window shutdown and bounded process verification.
  const cleanupDeadline = Math.min(options.deadline ?? startedAt + 180_000, startedAt + 180_000);
  const deadline = cleanupDeadline - 17_000;
  const nonce = randomBytes(32).toString('base64url');
  let closing = false;
  let resolveResult;
  let rejectResult;
  let settled = false;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  result.catch(() => {});
  const fail = error => { if (!settled) { settled = true; rejectResult(error); } };
  const server = createServer(vscodeCallback({ nonce, binding: credential.binding, startedAt, deadline,
    isClosing: () => closing, onReady: () => clearTimeout(startup),
    onResult: body => { if (!settled) { settled = true; resolveResult(body); } } }));
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  let startup;
  let timer;
  let child;
  const cancel = () => fail(new GatewayError('oauth_cancelled', 'VS Code host sign-in cancelled or timed out'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new GatewayError('oauth_cancelled', 'VS Code host sign-in deadline has expired');
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    options.signal?.throwIfAborted();
    startup = setTimeout(cancel, Math.min(60_000, deadline - Date.now()));
    timer = setTimeout(cancel, Math.max(1, deadline - Date.now()));
    const args = ['--user-data-dir', profile, '--extensions-dir', join(profile, 'extensions'),
      '--extensionDevelopmentPath', fileURLToPath(new URL('./vscode-helper', import.meta.url)),
      '--new-window', '--skip-welcome', '--skip-release-notes'];
    child = (options.vscodeSpawn ?? spawn)(command, args, {
      shell: false, windowsHide: false, stdio: 'ignore',
      env: { ...microsoftHostEnv(), SHARED_MCP_VSCODE_CALLBACK: `http://127.0.0.1:${server.address().port}/host-token`,
        SHARED_MCP_VSCODE_NONCE: nonce, SHARED_MCP_VSCODE_REQUEST: JSON.stringify({ binding: credential.binding, scopes: credential.scopes }) }
    });
    child.once('error', () => fail(new GatewayError('vscode_unavailable', 'Cannot start the isolated VS Code authentication host')));
    const body = await result;
    if (body.error) throw new GatewayError('auth_required', 'VS Code Microsoft sign-in or extension permission was not completed');
    return { accessToken: body.accessToken,
      accountKey: createHash('sha256').update(body.accountId).digest('hex') };
  } finally {
    clearTimeout(startup);
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    closing = true;
    try {
      if (child) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        await (options.vscodeStop ?? stopVSCode)(command, profile, startedAt, undefined,
          { pid: child.pid, deadline: cleanupDeadline });
      }
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
  }
}

export class VSCodeCredential {
  constructor(provider, discovery, scope) {
    this.provider = provider;
    Object.assign(this, microsoftResourceScopes(discovery, scope, provider));
    this.resource = discovery.resourceMetadata.resource;
    this.advertisedScopes = discovery.resourceMetadata.scopes_supported ?? [];
    this.providerIdentity = createHash('sha256').update(provider.path).digest('hex');
    this.binding = JSON.stringify(['vscode', this.providerIdentity, this.authority, this.resource, this.trustedResource, this.scopes]);
  }
  requiredScopes(name) { return requiredMicrosoftScopes(this.advertisedScopes, this.scopes, name); }
  async silent(rejectedToken, { requireLogin = false } = {}) {
    const provider = this.provider;
    const current = provider.pendingVSCode ?? provider.saved.vscode;
    const token = provider.tokens()?.access_token;
    if (!requireLogin && !(provider.options.forceLogin && !provider.vscodeAcquisitions) && current?.binding === this.binding &&
        token && token !== rejectedToken && (provider.expiresAt === undefined || provider.expiresAt > Date.now() + 30_000)) return;
    if (!provider.options.interactive || provider.vscodeAcquisitions >= 2) {
      if (token && (token === rejectedToken || provider.expiresAt !== undefined && provider.expiresAt <= Date.now() + 30_000)) {
        await provider.withLock(async () => {
          delete provider.saved.tokens;
          delete provider.saved.expiresAt;
          await provider.persist();
        });
      }
      throw new GatewayError('auth_required', 'VS Code host credentials require explicit sign-in with --vscode');
    }
    if (provider.vscodeFlight) return provider.vscodeFlight;
    const operation = provider.withLock(async () => {
      provider.vscodeAcquisitions = (provider.vscodeAcquisitions ?? 0) + 1;
      const result = await (provider.options.vscodeAcquire ?? acquireVSCodeToken)(provider, this);
      provider.options.signal?.throwIfAborted();
      if (!result?.accessToken || typeof result.accessToken !== 'string' || /[\s\x00-\x1f\x7f]/.test(result.accessToken) ||
          !/^[a-f0-9]{64}$/.test(result.accountKey ?? '')) throw new GatewayError('oauth_invalid_token', 'VS Code host returned an invalid credential');
      if (current?.providerIdentity === this.providerIdentity && current.authority === this.authority &&
          current.resource === this.resource && current.accountKey && current.accountKey !== result.accountKey) {
        throw new GatewayError('oauth_invalid_token', 'VS Code host account changed; explicitly select the intended identity');
      }
      await provider.saveTokens({ access_token: result.accessToken, token_type: 'Bearer' }, true);
      provider.pendingVSCode = { credentialProvider: 'vscode', providerIdentity: this.providerIdentity, binding: this.binding, authority: this.authority,
        resource: this.resource, scopes: this.scopes, accountKey: result.accountKey };
    });
    provider.vscodeFlight = operation;
    try { await operation; }
    finally { if (provider.vscodeFlight === operation) provider.vscodeFlight = undefined; }
  }
}
