import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { access, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { pluginSetup } from '../tools/plugin-setup.mjs';

const sourceRoot = resolve(import.meta.dirname, '..');
const baselineVersion = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8')).version;
const backendFixture = join(sourceRoot, 'test', 'fixtures', 'lifecycle-backend.mjs');
const expectedGatewayTools = ['call_tool', 'claim_server', 'get_tool_schema', 'list_servers', 'release_server', 'search_tools'];
const expectedServers = ['M365-Profile', 'credential-http', 'fake'];
const operationTimeoutMs = 15_000;
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function candidateVersion(offset) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(baselineVersion);
  if (!match) throw new Error(`Unsupported lifecycle baseline version: ${baselineVersion}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + offset}-test.1`;
}
let npmCliPromise;

function bounded(promise, label, timeoutMs = operationTimeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function resolveNpmCli() {
  if (npmCliPromise) return npmCliPromise;
  npmCliPromise = (async () => {
    const candidates = [];
    try { candidates.push(require.resolve('npm/bin/npm-cli.js')); } catch {}
    candidates.push(join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    candidates.push(resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    for (const candidate of candidates) {
      try { await access(candidate); return candidate; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    throw new Error('Cannot locate npm-cli.js for the lifecycle test');
  })();
  return npmCliPromise;
}

function childExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForChildExit(child) {
  if (childExited(child)) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

async function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}

async function observedProcessMarker(pid) {
  if (process.platform === 'win32') {
    const script = `$process = Get-Process -Id ${pid} -ErrorAction Stop; $process.StartTime.ToUniversalTime().ToString('o')`;
    let lastError;
    for (const shell of ['pwsh.exe', 'powershell.exe']) {
      try {
        const { stdout } = await bounded(execFileAsync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
          windowsHide: true, timeout: 3000,
        }), `observe process ${pid}`, 5000);
        return stdout.trim();
      } catch (error) {
        lastError = error;
        if (shell === 'pwsh.exe' && error.code === 'ENOENT') continue;
        throw error;
      }
    }
    throw lastError;
  }
  const value = await bounded(readFile(`/proc/${pid}/stat`, 'utf8'), `observe process ${pid}`, 5000);
  return value.slice(value.lastIndexOf(') ') + 2).split(' ')[19];
}

async function waitForProcessExit(pid, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (await processAlive(pid)) {
    if (Date.now() >= deadline) throw new Error(`${label} process ${pid} did not exit within ${timeoutMs}ms`);
    await delay(Math.min(50, deadline - Date.now()));
  }
}

async function terminateOwnedChild(child, label) {
  if (!child?.pid || childExited(child)) return;
  const pid = child.pid;
  child.kill('SIGTERM');
  try {
    await bounded(waitForChildExit(child), `${label} graceful shutdown`, 1000);
    return;
  } catch (error) {
    if (!await processAlive(pid)) return;
    if (!/exceeded/.test(error.message)) throw error;
  }
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 3000 });
    } catch (error) {
      if (await processAlive(pid)) throw new Error(`${label} process-tree termination failed: ${error.message}`, { cause: error });
    }
  } else {
    process.kill(pid, 'SIGKILL');
  }
  await waitForProcessExit(pid, label, 3000);
}

async function waitForRenameReady(path, timeoutMs = 5000) {
  const probe = `${path}.rename-ready`;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await rename(path, probe);
      await rename(probe, path);
      return;
    } catch (error) {
      if (!['EBUSY', 'EACCES', 'EPERM'].includes(error.code) || Date.now() >= deadline) throw error;
      await delay(Math.min(100, deadline - Date.now()));
    }
  }
}

async function runRealNpmCi(runtimePath) {
  const npmCli = await resolveNpmCli();
  const child = spawn(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: runtimePath,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let outcome;
  try {
    outcome = await bounded(waitForChildExit(child), 'Lifecycle npm ci', 120_000);
  } catch (error) {
    await terminateOwnedChild(child, 'Lifecycle npm ci');
    throw error;
  }
  if (outcome.code !== 0) {
    throw new Error(outcome.signal
      ? `Lifecycle npm ci was terminated (${outcome.signal})`
      : `Lifecycle npm ci failed with exit code ${outcome.code}`);
  }
  await waitForRenameReady(runtimePath);
}

function decode(result) {
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

async function missing(path) {
  await assert.rejects(() => stat(path), error => error.code === 'ENOENT');
}

async function unusedPort() {
  const listener = createNetServer();
  await new Promise((resolveListen, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolveListen);
  });
  const { port } = listener.address();
  await new Promise(resolveClose => listener.close(resolveClose));
  return port;
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'mcp gateway lifecycle '));
  const copilotHome = join(root, 'Copilot Home With Spaces');
  const stateDir = join(root, 'Gateway State With Spaces');
  const sourceConfig = join(copilotHome, 'mcp config.json');
  const backendCounter = join(root, 'backend starts.txt');
  await mkdir(copilotHome, { recursive: true });
  const source = {
    theme: 'preserved',
    approvalPolicy: { mode: 'prompt', approvedBy: 'synthetic-lifecycle-fixture' },
    mcpServers: {
      fake: {
        command: process.execPath,
        args: [backendFixture],
        env: { SYNTHETIC_BACKEND_TOKEN: 'fixture-only-secret', COUNTER_FILE: backendCounter },
        tools: ['echo'],
        requiresExclusiveAccess: true,
      },
      'credential-http': {
        url: 'http://127.0.0.1:1/unused-credential-backend',
        headers: { Authorization: 'Bearer fixture-only-header-secret' },
        tools: ['unused'],
      },
      'M365-Profile': {
        url: 'http://127.0.0.1:1/unused-adapter-backend',
        tools: ['GetMyDetails'],
      },
    },
  };
  const sourceBytes = Buffer.from(JSON.stringify(source));
  await writeFile(sourceConfig, sourceBytes);
  return {
    root,
    stateDir,
    sourceConfig,
    sourceBytes,
    backendCounter,
    privatePath: join(stateDir, 'backends.json'),
    tokenPath: join(stateDir, 'owner.token'),
    port: await unusedPort(),
  };
}

async function connectGenerated(sourceConfig, name) {
  const config = JSON.parse(await readFile(sourceConfig, 'utf8'));
  const entry = config.mcpServers?.['shared-mcp-gateway'];
  assert.equal(entry?.command, process.execPath);
  assert.ok(Array.isArray(entry.args));
  const transport = new StdioClientTransport({ command: entry.command, args: entry.args, stderr: 'pipe' });
  const client = new Client({ name, version: '1' });
  try {
    await bounded(client.connect(transport), `${name} connector initialization`);
    assert.equal(Number.isInteger(transport.pid), true);
    client.lifecycleTransport = transport;
    client.lifecycleConnectorPid = transport.pid;
    return client;
  } catch (error) {
    try { await bounded(transport.close(), `${name} failed connector cleanup`, 5000); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], `${name} connection and cleanup failed`); }
    throw error;
  }
}

async function closeClient(client, clients) {
  if (!client) return;
  clients.delete(client);
  const pid = client.lifecycleConnectorPid;
  await bounded(client.close(), 'SDK client close', 5000);
  await waitForProcessExit(pid, 'SDK connector', 5000);
  assert.equal(client.lifecycleTransport.pid, null);
}

async function gatewayManifest(stateDir) {
  return JSON.parse(await readFile(join(stateDir, 'gateway-instance.json'), 'utf8'));
}

async function manifestOrNull(stateDir) {
  try { return await gatewayManifest(stateDir); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function stopOwnedAndVerify(runtimePath, stateDir, port) {
  const manifest = await gatewayManifest(stateDir);
  assert.equal(resolve(manifest.cliPath), resolve(join(runtimePath, 'src', 'cli.js')));
  assert.equal(await processAlive(manifest.pid), true);
  assert.equal(await observedProcessMarker(manifest.pid), manifest.processMarker);
  const moduleUrl = `${pathToFileURL(join(runtimePath, 'src', 'ensure-gateway.js')).href}?lifecycle=${Date.now()}-${Math.random()}`;
  const { stopOwnedGateway } = await import(moduleUrl);
  assert.equal(await bounded(stopOwnedGateway({ stateDir, port, timeoutMs: 5000 }), 'owned gateway shutdown', 15_000), true);
  await waitForProcessExit(manifest.pid, 'owned gateway', 5000);
  await missing(join(stateDir, 'gateway-instance.json'));
}

async function startSentinel() {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore', shell: false, windowsHide: true,
  });
  await bounded(new Promise((resolveSpawn, reject) => {
    child.once('spawn', resolveSpawn);
    child.once('error', reject);
  }), 'sentinel startup', 5000);
  return child;
}

async function cleanupFixture({ clients, fixture, sentinel }) {
  const errors = [];
  for (const client of [...clients]) {
    try { await closeClient(client, clients); } catch (error) { errors.push(error); }
  }
  try {
    const manifest = await manifestOrNull(fixture.stateDir);
    if (manifest) await stopOwnedAndVerify(dirname(dirname(manifest.cliPath)), fixture.stateDir, fixture.port);
  } catch (error) { errors.push(error); }
  try { await terminateOwnedChild(sentinel, 'sentinel'); } catch (error) { errors.push(error); }
  try { await rm(fixture.root, { recursive: true, force: true }); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'Lifecycle fixture cleanup failed');
}

async function claimAndEcho(client, text) {
  assert.deepEqual(decode(await bounded(client.callTool({
    name: 'claim_server', arguments: { server: 'fake' },
  }), 'claim fake backend')), { claimed: true, server: 'fake' });
  try {
    return decode(await bounded(client.callTool({
      name: 'call_tool', arguments: { server: 'fake', tool: 'echo', arguments: { text } },
    }), 'call fake.echo'));
  } finally {
    assert.deepEqual(decode(await bounded(client.callTool({
      name: 'release_server', arguments: { server: 'fake' },
    }), 'release fake backend')), { released: true, server: 'fake' });
  }
}

async function backendStarts(path) {
  const lines = (await readFile(path, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.every(value => Number.isInteger(Number(value))));
  return lines.map(Number);
}

async function assertGatewaySurface(client) {
  const tools = await bounded(client.listTools(), 'list gateway tools');
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), expectedGatewayTools);
  const inventory = decode(await bounded(client.callTool({ name: 'list_servers', arguments: {} }), 'list configured servers'));
  assert.deepEqual(inventory.servers.map(server => server.name).sort(), expectedServers);
  assert.equal(inventory.servers.find(server => server.name === 'fake').requiresExclusiveAccess, true);
  const schema = decode(await bounded(client.callTool({
    name: 'get_tool_schema', arguments: { server: 'fake', tool: 'echo' },
  }), 'get fake.echo schema'));
  assert.equal(schema.requiresExclusiveAccess, true);
  assert.equal(schema.tool.name, 'echo');
  assert.equal(schema.tool.inputSchema.properties.text.type, 'string');
}

async function createCandidate(root, marker, version) {
  const candidate = join(root, `Immutable Candidate ${marker}`);
  await mkdir(candidate, { recursive: true });
  for (const file of ['LICENSE', 'package.json', 'package-lock.json']) await copyFile(join(sourceRoot, file), join(candidate, file));
  for (const directory of ['src', 'tools', 'adapters']) await cp(join(sourceRoot, directory), join(candidate, directory), { recursive: true });
  const packagePath = join(candidate, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  packageJson.version = version;
  packageJson.lifecycleTestCandidate = marker;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  const lockPath = join(candidate, 'package-lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.version = version;
  lock.packages[''].version = version;
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return candidate;
}

function addExternalAdapter(sourceBytes, adapterPath) {
  const config = JSON.parse(sourceBytes.toString('utf8'));
  config.mcpServers['shared-mcp-gateway'].args.push('--adapters', adapterPath);
  return Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
}

async function assertApprovalPreserved(sourceConfig, originalBytes) {
  const original = JSON.parse(originalBytes.toString('utf8'));
  const active = JSON.parse(await readFile(sourceConfig, 'utf8'));
  assert.deepEqual(active.approvalPolicy, original.approvalPolicy);
}

function assertFreshManifest(manifest, sourceBytes, replacementBytes) {
  assert.equal(manifest.originalSha256, sha256(sourceBytes));
  assert.equal(manifest.replacementSha256, sha256(replacementBytes));
}

function assertAdoptionManifest(manifest, sourceBytes, replacementBytes, backendBytes, adapterBytes) {
  assert.equal(manifest.operation, 'adopt-existing');
  assert.equal(manifest.files.source.originalSha256, sha256(sourceBytes));
  assert.equal(manifest.files.source.replacementSha256, sha256(replacementBytes));
  assert.equal(manifest.files.backend.originalSha256, sha256(backendBytes));
  assert.equal(manifest.files.adapter.originalSha256, sha256(adapterBytes));
}

function lifecycleTest(name, fn) {
  test(name, { timeout: 320_000 }, fn);
}

lifecycleTest('fresh setup deploys a private runtime and serves two real SDK clients', async t => {
  const fixture = await createFixture();
  const clients = new Set();
  const sentinel = await startSentinel();
  t.after(() => cleanupFixture({ clients, fixture, sentinel }));

  const preview = await pluginSetup({ sourceRoot, sourceConfig: fixture.sourceConfig, stateDir: fixture.stateDir, port: fixture.port });
  assert.equal(preview.status, 'planned');
  assert.deepEqual(await readFile(fixture.sourceConfig), fixture.sourceBytes);
  await missing(fixture.privatePath);
  await missing(fixture.tokenPath);

  const applied = await pluginSetup({
    sourceRoot, sourceConfig: fixture.sourceConfig, stateDir: fixture.stateDir, port: fixture.port,
    apply: true, now: new Date('2026-09-24T02:00:00.000Z'), npmRunner: runRealNpmCi,
  });
  assert.equal(applied.status, 'configured');
  assert.equal(applied.migrationStatus, 'migrated');
  const replacementBytes = await readFile(fixture.sourceConfig);
  assert.deepEqual(await readFile(applied.backupPath), fixture.sourceBytes);
  assert.deepEqual(await readFile(fixture.privatePath), fixture.sourceBytes);
  assertFreshManifest(JSON.parse(await readFile(applied.manifestPath, 'utf8')), fixture.sourceBytes, replacementBytes);
  await assertApprovalPreserved(fixture.sourceConfig, fixture.sourceBytes);
  assert.equal(relative(join(fixture.stateDir, 'runtime'), applied.runtimePath).startsWith('..'), false);
  assert.notEqual(resolve(applied.runtimePath), sourceRoot);
  assert.equal((await stat(join(applied.runtimePath, 'node_modules', '@modelcontextprotocol', 'sdk'))).isDirectory(), true);

  const clientA = await connectGenerated(fixture.sourceConfig, 'lifecycle-fresh-A');
  clients.add(clientA);
  const manifestA = await gatewayManifest(fixture.stateDir);
  const clientB = await connectGenerated(fixture.sourceConfig, 'lifecycle-fresh-B');
  clients.add(clientB);
  const manifestB = await gatewayManifest(fixture.stateDir);
  assert.equal(manifestB.pid, manifestA.pid);
  assert.equal(clientA.getServerVersion().version, baselineVersion);
  assert.equal(clientB.getServerVersion().version, baselineVersion);
  await assertGatewaySurface(clientA);
  assert.deepEqual((await bounded(clientB.listTools(), 'client B list gateway tools')).tools.map(tool => tool.name).sort(), expectedGatewayTools);

  const first = await claimAndEcho(clientA, 'fresh-A');
  await closeClient(clientA, clients);
  assert.equal((await gatewayManifest(fixture.stateDir)).pid, manifestA.pid);
  const second = await claimAndEcho(clientB, 'fresh-B-after-A-close');
  assert.deepEqual(second, { text: 'fresh-B-after-A-close', pid: first.pid });
  assert.deepEqual(await backendStarts(fixture.backendCounter), [first.pid]);
  await closeClient(clientB, clients);

  await stopOwnedAndVerify(applied.runtimePath, fixture.stateDir, fixture.port);
  await waitForProcessExit(first.pid, 'fresh backend', 5000);
  assert.equal(await processAlive(sentinel.pid), true);
});

lifecycleTest('upgrade preserves data, switches runtimes, rolls back, and survives candidate install failure', async t => {
  const fixture = await createFixture();
  const clients = new Set();
  const sentinel = await startSentinel();
  t.after(() => cleanupFixture({ clients, fixture, sentinel }));

  const baseline = await pluginSetup({
    sourceRoot, sourceConfig: fixture.sourceConfig, stateDir: fixture.stateDir, port: fixture.port,
    apply: true, now: new Date('2026-09-24T02:10:00.000Z'), npmRunner: runRealNpmCi,
  });
  const externalAdapter = join(fixture.root, 'External Checkout With Spaces', 'agency adapters.json');
  const adapterBytes = Buffer.from('{"M365-Profile":"m365-user"}\n');
  await mkdir(dirname(externalAdapter), { recursive: true });
  await writeFile(externalAdapter, adapterBytes);
  const baselineConnectorBytes = addExternalAdapter(await readFile(fixture.sourceConfig), externalAdapter);
  await writeFile(fixture.sourceConfig, baselineConnectorBytes);
  const backendBytes = await readFile(fixture.privatePath);
  const tokenBytes = await readFile(fixture.tokenPath);

  const oldClient = await connectGenerated(fixture.sourceConfig, 'lifecycle-upgrade-old');
  clients.add(oldClient);
  assert.equal(oldClient.getServerVersion().version, baselineVersion);
  const oldCall = await claimAndEcho(oldClient, 'before-upgrade');
  const oldManifest = await gatewayManifest(fixture.stateDir);
  assert.equal(resolve(oldManifest.cliPath), resolve(join(baseline.runtimePath, 'src', 'cli.js')));

  const upgradedVersion = candidateVersion(1);
  const candidate = await createCandidate(fixture.root, 'upgrade-success', upgradedVersion);
  const preview = await pluginSetup({
    sourceRoot: candidate, sourceConfig: fixture.sourceConfig, stateDir: fixture.stateDir, port: fixture.port,
    agencyAdapters: true, adoptExisting: true,
  });
  assert.equal(preview.status, 'planned-adoption');
  assert.deepEqual(await readFile(fixture.sourceConfig), baselineConnectorBytes);
  assert.deepEqual(await readFile(externalAdapter), adapterBytes);

  const upgraded = await pluginSetup({
    sourceRoot: candidate, sourceConfig: fixture.sourceConfig, stateDir: fixture.stateDir, port: fixture.port,
    agencyAdapters: true, adoptExisting: true, apply: true,
    now: new Date('2026-09-24T02:20:00.000Z'), npmRunner: runRealNpmCi,
  });
  const upgradedConnectorBytes = await readFile(fixture.sourceConfig);
  assert.equal(upgraded.status, 'adopted');
  assert.notEqual(upgraded.runtimePath, baseline.runtimePath);
  assert.equal((await stat(baseline.runtimePath)).isDirectory(), true);
  assert.equal((await stat(upgraded.runtimePath)).isDirectory(), true);
  assert.equal(JSON.parse(await readFile(join(upgraded.runtimePath, 'package.json'), 'utf8')).version, upgradedVersion);
  const installedLock = JSON.parse(await readFile(join(upgraded.runtimePath, 'package-lock.json'), 'utf8'));
  assert.equal(installedLock.version, upgradedVersion);
  assert.equal(installedLock.packages[''].version, upgradedVersion);
  assert.deepEqual(await readFile(upgraded.sourceBackupPath), baselineConnectorBytes);
  assert.deepEqual(await readFile(upgraded.backendBackupPath), backendBytes);
  assert.deepEqual(await readFile(upgraded.adapterBackupPath), adapterBytes);
  assert.deepEqual(await readFile(upgraded.adaptersPath), adapterBytes);
  assert.notEqual(resolve(upgraded.adaptersPath), resolve(externalAdapter));
  assert.equal(relative(fixture.stateDir, upgraded.adaptersPath).startsWith('..'), false);
  assert.deepEqual(await readFile(fixture.privatePath), backendBytes);
  assert.deepEqual(await readFile(fixture.tokenPath), tokenBytes);
  assertAdoptionManifest(
    JSON.parse(await readFile(upgraded.manifestPath, 'utf8')),
    baselineConnectorBytes, upgradedConnectorBytes, backendBytes, adapterBytes,
  );
  await assertApprovalPreserved(fixture.sourceConfig, fixture.sourceBytes);

  const oldStillLive = await claimAndEcho(oldClient, 'old-runtime-still-live');
  assert.deepEqual(oldStillLive, { text: 'old-runtime-still-live', pid: oldCall.pid });
  assert.deepEqual(await backendStarts(fixture.backendCounter), [oldCall.pid]);
  assert.equal((await gatewayManifest(fixture.stateDir)).pid, oldManifest.pid);
  await closeClient(oldClient, clients);
  await stopOwnedAndVerify(baseline.runtimePath, fixture.stateDir, fixture.port);
  await waitForProcessExit(oldCall.pid, 'old backend', 5000);
  assert.equal(await processAlive(sentinel.pid), true);

  const newClient = await connectGenerated(fixture.sourceConfig, 'lifecycle-upgrade-new');
  clients.add(newClient);
  assert.equal(newClient.getServerVersion().version, upgradedVersion);
  const newCall = await claimAndEcho(newClient, 'after-upgrade');
  assert.notEqual(newCall.pid, oldCall.pid);
  const newManifest = await gatewayManifest(fixture.stateDir);
  assert.equal(resolve(newManifest.cliPath), resolve(join(upgraded.runtimePath, 'src', 'cli.js')));
  assert.deepEqual(await readFile(fixture.privatePath), backendBytes);
  assert.deepEqual(await readFile(fixture.tokenPath), tokenBytes);

  await copyFile(upgraded.sourceBackupPath, fixture.sourceConfig);
  assert.deepEqual(await readFile(fixture.sourceConfig), baselineConnectorBytes);
  await closeClient(newClient, clients);
  await stopOwnedAndVerify(upgraded.runtimePath, fixture.stateDir, fixture.port);
  await waitForProcessExit(newCall.pid, 'upgraded backend', 5000);

  const rolledBackClient = await connectGenerated(fixture.sourceConfig, 'lifecycle-upgrade-rolled-back');
  clients.add(rolledBackClient);
  assert.equal(rolledBackClient.getServerVersion().version, baselineVersion);
  const rolledBackCall = await claimAndEcho(rolledBackClient, 'after-rollback');
  assert.notEqual(rolledBackCall.pid, newCall.pid);
  const rolledBackManifest = await gatewayManifest(fixture.stateDir);
  assert.equal(resolve(rolledBackManifest.cliPath), resolve(join(baseline.runtimePath, 'src', 'cli.js')));
  assert.deepEqual(await readFile(fixture.privatePath), backendBytes);
  assert.deepEqual(await readFile(fixture.tokenPath), tokenBytes);
  await assertApprovalPreserved(fixture.sourceConfig, fixture.sourceBytes);

  const backupsBeforeFailure = (await readdir(join(fixture.stateDir, 'backups'))).sort();
  const failedCandidate = await createCandidate(fixture.root, 'upgrade-install-failure', candidateVersion(2));
  await assert.rejects(() => pluginSetup({
    sourceRoot: failedCandidate, sourceConfig: fixture.sourceConfig, stateDir: fixture.stateDir, port: fixture.port,
    agencyAdapters: true, adoptExisting: true, apply: true,
    now: new Date('2026-09-24T02:30:00.000Z'),
    npmRunner: async () => { throw new Error('intentional lifecycle dependency failure'); },
  }), error => {
    assert.match(error.message, /intentional lifecycle dependency failure/);
    assert.equal(error.setupResult.backupPath, null);
    assert.equal(error.setupResult.manifestPath, null);
    return true;
  });
  assert.deepEqual(await readFile(fixture.sourceConfig), baselineConnectorBytes);
  assert.notDeepEqual(await readFile(fixture.sourceConfig), upgradedConnectorBytes);
  assert.deepEqual(await readFile(fixture.privatePath), backendBytes);
  assert.deepEqual(await readFile(fixture.tokenPath), tokenBytes);
  assert.deepEqual((await readdir(join(fixture.stateDir, 'backups'))).sort(), backupsBeforeFailure);
  await assertApprovalPreserved(fixture.sourceConfig, fixture.sourceBytes);
  const afterFailure = await claimAndEcho(rolledBackClient, 'rollback-survives-failed-upgrade');
  assert.deepEqual(afterFailure, { text: 'rollback-survives-failed-upgrade', pid: rolledBackCall.pid });
  assert.deepEqual(await backendStarts(fixture.backendCounter), [oldCall.pid, newCall.pid, rolledBackCall.pid]);

  await closeClient(rolledBackClient, clients);
  await stopOwnedAndVerify(baseline.runtimePath, fixture.stateDir, fixture.port);
  await waitForProcessExit(rolledBackCall.pid, 'rolled-back backend', 5000);
  assert.equal(await processAlive(sentinel.pid), true);
});
