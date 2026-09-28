import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { DEFAULT_STARTUP_TIMEOUT_MS, ensureGateway, stopOwnedGateway } from '../src/ensure-gateway.js';
import { loadOrCreateToken } from '../src/token.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const fixtures = [];
const owned = [];

afterEach(async () => {
  const stopped = await Promise.allSettled(owned.splice(0).map(item => stopOwnedGateway(item)));
  const failures = stopped.filter(result => result.status === 'rejected');
  const directories = fixtures.splice(0);
  if (failures.length) throw new AggregateError(failures.map(result => result.reason),
    `Owned gateway cleanup failed; evidence retained at ${directories.join(', ')}`);
  await Promise.all(directories.map(path => rm(path, { recursive: true, force: true })));
});

async function unusedPort() {
  const listener = createNetServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function fixture(config = { mcpServers: {} }) {
  const directory = await mkdtemp(join(tmpdir(), 'ensure-gateway-'));
  fixtures.push(directory);
  const stateDir = join(directory, 'state');
  const configPath = join(directory, 'mcp-config.json');
  await writeFile(configPath, JSON.stringify(config));
  return { directory, stateDir, configPath, port: await unusedPort() };
}

function options(item, overrides = {}) {
  return { configPath: item.configPath, adaptersPath: null, stateDir: item.stateDir, port: item.port, startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS, ...overrides };
}

async function ensureInSeparateProcess(ensureOptions) {
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src', 'ensure-gateway.js')).href;
  const script = `import { ensureGateway } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await ensureGateway(JSON.parse(process.argv[1]))));`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script, JSON.stringify(ensureOptions)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  let timer;
  const result = await Promise.race([
    new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error('ensure child exceeded test bound')); }, (ensureOptions.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS) + 10_000); })
  ]).finally(() => clearTimeout(timer));
  assert.equal(result.code, 0, stderr || `ensure child exited by ${result.signal}`);
  return JSON.parse(stdout.trim());
}

async function gatewayProcessIdsForStateDir(stateDir) {
  const cliPath = join(process.cwd(), 'src', 'cli.js');
  if (process.platform === 'win32') {
    const payload = Buffer.from(JSON.stringify({ cliPath, stateDir, pid: process.pid }), 'utf8').toString('base64');
    const script = `$payload=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')));$ids=@(Get-CimInstance Win32_Process|Where-Object{$_.ProcessId -ne $payload.pid -and $_.CommandLine -and $_.CommandLine.Contains([string]$payload.cliPath) -and $_.CommandLine.Contains('--state-dir') -and $_.CommandLine.Contains([string]$payload.stateDir)}|ForEach-Object{[int]$_.ProcessId});ConvertTo-Json -InputObject @($ids) -Compress`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    let lastError;
    for (const shell of ['pwsh.exe', 'powershell.exe']) {
      try {
        const { stdout } = await execFileAsync(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 5000 });
        return JSON.parse(stdout.trim());
      } catch (error) {
        lastError = error;
        if (error.code === 'ENOENT' && shell === 'pwsh.exe') continue;
        throw error;
      }
    }
    throw lastError;
  }
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,args='], { timeout: 5000 });
  return stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match && match[2].includes(cliPath) && match[2].includes('--state-dir') && match[2].includes(stateDir) ? [Number(match[1])] : [];
  });
}

for (let round = 1; round <= 3; round += 1) {
  test(`concurrent callers start exactly one persistent gateway (round ${round})`, { timeout: 90_000 }, async () => {
    const item = await fixture();
    owned.push({ stateDir: item.stateDir, port: item.port, timeoutMs: 5000 });

    const results = await Promise.all(Array.from({ length: 4 }, () => ensureInSeparateProcess(options(item))));
    const pids = new Set(results.map(result => result.pid));
    assert.equal(pids.size, 1);
    assert.equal([...pids][0] > 0, true);
    assert.equal(results.filter(result => result.reused === false).length, 1);
    assert.equal(results.filter(result => result.reused === true).length, 3);

    const subsequent = await ensureGateway(options(item));
    assert.deepEqual(subsequent, { pid: results[0].pid, reused: true });
    const stdout = await readFile(join(item.stateDir, 'gateway.stdout.log'), 'utf8');
    assert.equal(stdout.match(/Shared MCP gateway listening/g)?.length, 1);
  });
}

test('a resumed terminal burst connects twelve independent clients to one cold gateway', { timeout: 90_000 }, async () => {
  const item = await fixture();
  owned.push({ stateDir: item.stateDir, port: item.port, timeoutMs: 5000 });
  await loadOrCreateToken(item.stateDir, { aclTimeoutMs: 15_000 });
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => ensureInSeparateProcess(options(item, { startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS }))));
  const failures = results.filter(result => result.status === 'rejected');
  assert.equal(failures.length, 0, failures.map(result => result.reason.message).join('\n'));
  const started = results.map(result => result.value);
  assert.equal(new Set(started.map(result => result.pid)).size, 1);
  assert.equal(started.filter(result => !result.reused).length, 1);
  const output = await readFile(join(item.stateDir, 'gateway.stdout.log'), 'utf8');
  assert.equal(output.match(/Shared MCP gateway listening/g)?.length, 1);
});

test('live startup-lock waiters do not spawn process-inspection shells', { timeout: 5000 }, async () => {
  const item = await fixture();
  await mkdir(item.stateDir);
  const lockPath = `${item.stateDir}.token-init.lock`;
  const record = JSON.stringify({ nonce: 'live-test-owner', pid: process.pid, processMarker: 'not-used-to-take-ownership' });
  await writeFile(lockPath, record);
  const childProcess = require('node:child_process');
  const original = childProcess.execFile;
  let inspectionCount = 0;
  childProcess.execFile = (...args) => { inspectionCount += 1; return original(...args); };
  syncBuiltinESMExports();
  try {
    const { ensureGateway: isolatedEnsure } = await import(`../src/ensure-gateway.js?waiters=${Date.now()}`);
    const startedAt = Date.now();
    await assert.rejects(() => isolatedEnsure(options(item, { startupTimeoutMs: 200 })), /startup lock.*deadline/);
    assert.equal(inspectionCount, 0);
    assert.ok(Date.now() - startedAt < 2000, 'lock waiting must remain bounded');
    assert.equal(await readFile(lockPath, 'utf8'), record, 'a live lock must never be stolen');
  } finally {
    childProcess.execFile = original;
    syncBuiltinESMExports();
  }
});

test('a client can recover a lock whose owner exited while recording provenance', { timeout: 30_000 }, async () => {
  const item = await fixture();
  owned.push({ stateDir: item.stateDir, port: item.port, timeoutMs: 5000 });
  await mkdir(item.stateDir);
  const child = spawn(process.execPath, ['--eval', ''], { stdio: 'ignore', windowsHide: true });
  const pid = child.pid;
  let timer;
  await new Promise((resolveExit, reject) => {
    timer = setTimeout(() => { child.kill(); reject(new Error('Lock-owner fixture exceeded 5 seconds')); }, 5000);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveExit() : reject(new Error(`Lock-owner fixture exited ${code}`)));
  }).finally(() => clearTimeout(timer));
  await writeFile(`${item.stateDir}.token-init.lock`, JSON.stringify({ nonce: 'interrupted-provenance', pid }));
  const result = await ensureGateway(options(item));
  assert.equal(result.reused, false);
  assert.ok(result.pid > 0);
});

test('a stale lock with a reused live PID is recovered without terminating that process', { timeout: 60_000 }, async () => {
  const item = await fixture();
  owned.push({ stateDir: item.stateDir, port: item.port, timeoutMs: 5000 });
  await mkdir(item.stateDir);
  await writeFile(`${item.stateDir}.token-init.lock`, JSON.stringify({
    nonce: 'previous-process-lock', pid: process.pid, processMarker: 'different-process-birth',
    executable: process.execPath, createdAt: new Date(0).toISOString()
  }));
  const started = await ensureGateway(options(item));
  assert.ok(started.pid > 0);
  assert.notEqual(started.pid, process.pid);
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});

test('Windows preliminary locks distinguish reused PIDs from live owners by creation time', {
  skip: process.platform !== 'win32', timeout: 90_000
}, async () => {
  const item = await fixture();
  owned.push({ stateDir: item.stateDir, port: item.port, timeoutMs: 5000 });
  await mkdir(item.stateDir);
  const lockPath = `${item.stateDir}.token-init.lock`;
  await writeFile(lockPath, JSON.stringify({
    nonce: 'abandoned-preliminary-owner', pid: process.pid, createdAt: new Date(0).toISOString()
  }));
  const result = await ensureGateway(options(item));
  assert.ok(result.pid > 0);
  const live = JSON.stringify({ nonce: 'still-live-preliminary-owner', pid: process.pid, createdAt: new Date().toISOString() });
  await writeFile(lockPath, live);
  await assert.rejects(() => ensureGateway(options(item, { startupTimeoutMs: 15_000 })), /startup lock.*deadline/);
  assert.equal(await readFile(lockPath, 'utf8'), live, 'an older live process must keep its preliminary lock');
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});

test('complete lock provenance is published without truncating the preliminary record', { timeout: 30_000 }, async () => {
  const item = await fixture();
  owned.push({ stateDir: item.stateDir, port: item.port, timeoutMs: 5000 });
  const fs = require('node:fs/promises');
  const original = fs.rename;
  const originalLink = fs.link;
  let inspected = 0;
  let openFailures = process.platform === 'win32' ? 2 : 0;
  let publishFailures = process.platform === 'win32' ? 2 : 0;
  fs.link = async (source, target) => {
    if (String(target).endsWith('.token-init.lock') && openFailures > 0) {
      openFailures -= 1;
      throw Object.assign(new Error('Injected Windows lock contention'), { code: 'EPERM' });
    }
    const preliminary = JSON.parse(await readFile(source, 'utf8'));
    assert.ok(preliminary.pid && preliminary.nonce, 'only a complete record can become the lock');
    return originalLink(source, target);
  };
  fs.rename = async (source, target) => {
    if (String(target).endsWith('.token-init.lock') || String(target).endsWith('gateway-start.lock')) {
      const before = JSON.parse(await readFile(target, 'utf8'));
      const replacement = JSON.parse(await readFile(source, 'utf8'));
      assert.equal(before.nonce, replacement.nonce);
      assert.equal(before.pid, replacement.pid);
      if (process.platform === 'win32') assert.equal(before.processMarker, undefined);
      else assert.equal(before.processMarker, replacement.processMarker);
      assert.ok(replacement.processMarker);
      if (publishFailures > 0) {
        publishFailures -= 1;
        throw Object.assign(new Error('Injected Windows publication contention'), { code: 'EPERM' });
      }
      inspected += 1;
    }
    return original(source, target);
  };
  syncBuiltinESMExports();
  try {
    await ensureGateway(options(item));
    assert.equal(inspected, 2);
  } finally {
    fs.rename = original;
    fs.link = originalLink;
    syncBuiltinESMExports();
  }
});

test('interrupted preparation never publishes a malformed startup lock', { timeout: 5000 }, async () => {
  const item = await fixture();
  const fs = require('node:fs/promises');
  const original = fs.writeFile;
  fs.writeFile = async (path, content, options) => {
    if (String(path).endsWith('.prepared')) {
      await original(path, '{"nonce":', options);
      throw new Error('Interrupted preliminary record write');
    }
    return original(path, content, options);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => ensureGateway(options(item)), /Interrupted preliminary record/);
    await assert.rejects(access(`${item.stateDir}.token-init.lock`), { code: 'ENOENT' });
  } finally {
    fs.writeFile = original;
    syncBuiltinESMExports();
  }
});

test('failed prepared-record cleanup releases ownership before reporting failure', { timeout: 30_000 }, async () => {
  const item = await fixture();
  const fs = require('node:fs/promises');
  const original = fs.unlink;
  let preparedPath;
  fs.unlink = async path => {
    if (String(path).endsWith('.prepared')) {
      preparedPath = path;
      throw Object.assign(new Error('Injected prepared-record cleanup failure'), { code: 'EPERM' });
    }
    return original(path);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => ensureGateway(options(item)), /prepared-record cleanup failure/);
    await assert.rejects(access(`${item.stateDir}.token-init.lock`), { code: 'ENOENT' });
    await assert.rejects(access(join(item.stateDir, 'owner.token')), { code: 'ENOENT' });
    assert.doesNotThrow(() => process.kill(process.pid, 0));
  } finally {
    fs.unlink = original;
    syncBuiltinESMExports();
    if (preparedPath) await original(preparedPath);
  }
});

test('Windows shutdown inspections share one deadline', { skip: process.platform !== 'win32', timeout: 5000 }, async t => {
  const item = await fixture();
  await mkdir(item.stateDir);
  const metadata = { pid: process.pid, nonce: 'shutdown-budget', processMarker: 'synthetic-birth',
    executable: process.execPath, port: item.port };
  await writeFile(join(item.stateDir, 'gateway-instance.json'), JSON.stringify(metadata));
  const childProcess = require('node:child_process');
  const original = childProcess.execFile;
  let now = 1000;
  const clock = t.mock.method(Date, 'now', () => now);
  const kill = t.mock.method(process, 'kill', () => true);
  const budgets = [];
  childProcess.execFile = (file, args, options, callback) => {
    budgets.push(options.timeout);
    now += Math.min(600, options.timeout);
    queueMicrotask(() => options.timeout < 600
      ? callback(Object.assign(new Error('inspection timeout'), { killed: true }))
      : callback(null, JSON.stringify({ creation: metadata.processMarker, executable: process.execPath }), ''));
  };
  childProcess.execFile[promisify.custom] = (...args) => new Promise((resolveResult, reject) => {
    childProcess.execFile(...args, (error, stdout, stderr) => error ? reject(error) : resolveResult({ stdout, stderr }));
  });
  syncBuiltinESMExports();
  try {
    const { stopOwnedGateway: isolatedStop } = await import('../src/ensure-gateway.js?shutdown-budget');
    await assert.rejects(() => isolatedStop({ stateDir: item.stateDir, port: item.port, timeoutMs: 1000 }),
      /Timed out checking process/);
    assert.deepEqual(budgets, [1000, 400]);
    assert.equal(kill.mock.calls.filter(call => call.arguments[1] === 'SIGTERM').length, 1);
    assert.deepEqual(JSON.parse(await readFile(join(item.stateDir, 'gateway-instance.json'), 'utf8')), metadata);
  } finally {
    childProcess.execFile = original;
    syncBuiltinESMExports();
    clock.mock.restore();
    kill.mock.restore();
  }
});

test('twelve real connectors resume against stale previous-instance metadata', { timeout: 120_000 }, async () => {
  const item = await fixture();
  owned.push({ stateDir: item.stateDir, port: item.port, timeoutMs: 5000 });
  await ensureGateway(options(item));
  const manifestPath = join(item.stateDir, 'gateway-instance.json');
  const oldManifest = await readFile(manifestPath);
  assert.equal(await stopOwnedGateway({ stateDir: item.stateDir, port: item.port, timeoutMs: 5000 }), true);
  await writeFile(manifestPath, oldManifest);
  const args = [
    join(process.cwd(), 'tools', 'connector.mjs'), '--auto-start',
    '--config', item.configPath, '--state-dir', item.stateDir, '--port', String(item.port), '--check'
  ];
  const results = await Promise.allSettled(Array.from({ length: 12 }, () =>
    execFileAsync(process.execPath, args, { windowsHide: true, timeout: DEFAULT_STARTUP_TIMEOUT_MS + 15_000 })));
  const failures = results.filter(result => result.status === 'rejected');
  assert.equal(failures.length, 0, failures.map(result => result.reason.message).join('\n'));
  for (const result of results) assert.match(result.value.stdout, /Gateway ready/);
  const output = await readFile(join(item.stateDir, 'gateway.stdout.log'), 'utf8');
  assert.equal(output.match(/Shared MCP gateway listening/g)?.length, 2, 'one baseline launch and one shared restart');
  const current = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.notEqual(current.nonce, JSON.parse(oldManifest).nonce);
  assert.deepEqual(await ensureGateway(options(item)), { pid: current.pid, reused: true });
});

async function inspectWindowsAcl(path, directory) {
  const payload = Buffer.from(JSON.stringify({ path, directory }), 'utf8').toString('base64');
  const script = `$payload=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')));$item=if($payload.directory){[IO.DirectoryInfo]::new([string]$payload.path)}else{[IO.FileInfo]::new([string]$payload.path)};$acl=[IO.FileSystemAclExtensions]::GetAccessControl($item);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|ForEach-Object{[pscustomobject]@{sid=$_.IdentityReference.Value;type=[int]$_.AccessControlType;rights=[int]$_.FileSystemRights;inheritance=[int]$_.InheritanceFlags;propagation=[int]$_.PropagationFlags}});[pscustomobject]@{owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;current=$sid.Value;protected=$acl.AreAccessRulesProtected;rules=$rules}|ConvertTo-Json -Compress -Depth 4`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  let lastError;
  for (const shell of ['pwsh.exe', 'powershell.exe']) {
    try {
      const { stdout } = await execFileAsync(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 5000 });
      return JSON.parse(stdout.trim());
    } catch (error) {
      lastError = error;
      if (error.code === 'ENOENT' && shell === 'pwsh.exe') continue;
      throw error;
    }
  }
  throw lastError;
}

async function hardenTokenInSeparateProcess(stateDir, repetitions) {
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src', 'token.js')).href;
  const script = `import { loadOrCreateToken } from ${JSON.stringify(moduleUrl)}; for (let index = 0; index < Number(process.argv[2]); index += 1) await loadOrCreateToken(process.argv[1]);`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script, stateDir, String(repetitions)], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const result = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  assert.equal(result.code, 0, stderr || `token hardener exited by ${result.signal}`);
}

test('Windows owner-only ACL hardening preserves concurrent runtime access', { skip: process.platform !== 'win32', timeout: 60_000 }, async () => {
  const item = await fixture();
  const { path: tokenPath } = await loadOrCreateToken(item.stateDir);
  let hardeningComplete = false;
  const hardening = Promise.all(Array.from({ length: 4 }, () => hardenTokenInSeparateProcess(item.stateDir, 3)))
    .finally(() => { hardeningComplete = true; });

  let writes = 0;
  while (!hardeningComplete || writes < 50) {
    const temporary = join(item.stateDir, `gateway-instance.json.${process.pid}.${writes}.tmp`);
    const manifest = join(item.stateDir, 'gateway-instance.json');
    const content = `${writes}\n`;
    await writeFile(temporary, content, { flag: 'wx' });
    await rename(temporary, manifest);
    assert.equal(await readFile(manifest, 'utf8'), content);
    writes += 1;
  }
  await hardening;

  for (const [path, directory, inheritance] of [[item.stateDir, true, 3], [tokenPath, false, 0]]) {
    const acl = await inspectWindowsAcl(path, directory);
    assert.equal(acl.owner, acl.current);
    assert.equal(acl.protected, true);
    assert.equal(acl.rules.length, 1);
    assert.deepEqual(acl.rules[0], { sid: acl.current, type: 0, rights: 2032127, inheritance, propagation: 0 });
  }
});

test('rejects an unrelated or wrong-token listener without replacing it', { timeout: 20_000 }, async () => {
  const item = await fixture();
  const listener = createHttpServer((_request, response) => response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}'));
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(item.port, '127.0.0.1', resolve); });
  try {
    await assert.rejects(() => ensureGateway(options(item, { startupTimeoutMs: 10_000 })), /rejected the gateway owner token|refusing to replace/i);
    assert.equal(listener.listening, true);
    await assert.rejects(() => readFile(join(item.stateDir, 'gateway-instance.json'), 'utf8'), error => error.code === 'ENOENT');
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
});

test('rejects reuse when persisted settings do not match', { timeout: 60_000 }, async () => {
  const item = await fixture();
  owned.push({ stateDir: item.stateDir, port: item.port, timeoutMs: 5000 });
  const started = await ensureGateway(options(item));
  assert.equal(started.reused, false);

  const otherConfig = join(item.directory, 'other-config.json');
  await writeFile(otherConfig, JSON.stringify({ mcpServers: { different: { command: process.execPath, args: ['missing.js'] } } }));
  await assert.rejects(
    () => ensureGateway(options(item, { configPath: otherConfig, startupTimeoutMs: 5000 })),
    /different config or adapter settings/i
  );
});

test('launch failure is bounded and cleans up only its owned process', { timeout: 20_000 }, async () => {
  const item = await fixture({ invalid: true });
  const startedAt = Date.now();
  let launchError;
  await assert.rejects(
    () => ensureGateway(options(item, { startupTimeoutMs: 12_000 })),
    error => { launchError = error; return true; },
  );

  assert.match(launchError.message, /^Gateway process exited (?:with code \d+; see .+gateway\.stderr\.log|or its provenance could not be recorded: spawned process is no longer running)$/i);
  const stderr = await readFile(join(item.stateDir, 'gateway.stderr.log'), 'utf8');
  assert.match(stderr, /Invalid MCP config .*config: must contain exactly one of mcpServers or servers/i);
  assert.deepEqual(await gatewayProcessIdsForStateDir(item.stateDir), [], 'owned gateway process remained after launch failure');
  await assert.rejects(
    () => readFile(join(item.stateDir, 'gateway-instance.json'), 'utf8'),
    error => error.code === 'ENOENT',
  );
  assert.equal(await stopOwnedGateway({ stateDir: item.stateDir, port: item.port, timeoutMs: 1000 }), false);
  assert.ok(Date.now() - startedAt < 20_000, 'launch failure and cleanup exceeded the test bound');
});

test('stopping an owned daemon observes process exit and removes its manifest', { timeout: 30_000 }, async () => {
  const item = await fixture();
  const owner = { stateDir: item.stateDir, port: item.port, timeoutMs: 5000 };
  owned.push(owner);
  await ensureGateway(options(item));
  assert.equal(await stopOwnedGateway(owner), true);
  await assert.rejects(
    () => readFile(join(item.stateDir, 'gateway-instance.json'), 'utf8'),
    error => error.code === 'ENOENT',
  );
  assert.equal(await stopOwnedGateway(owner), false);
});
