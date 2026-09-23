import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, test } from 'node:test';
import { ensureGateway, stopOwnedGateway } from '../src/ensure-gateway.js';

const fixtures = [];
const owned = [];

afterEach(async () => {
  const stopped = await Promise.allSettled(owned.splice(0).map(item => stopOwnedGateway(item)));
  await Promise.allSettled(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true })));
  const failures = stopped.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Owned gateway cleanup failed');
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
  return { configPath: item.configPath, adaptersPath: null, stateDir: item.stateDir, port: item.port, startupTimeoutMs: 20_000, ...overrides };
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
    new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error('ensure child exceeded test bound')); }, 30_000); })
  ]).finally(() => clearTimeout(timer));
  assert.equal(result.code, 0, stderr || `ensure child exited by ${result.signal}`);
  return JSON.parse(stdout.trim());
}

test('concurrent callers start exactly one persistent gateway and later calls reuse it', { timeout: 60_000 }, async () => {
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
  // On a busy Windows host, process-provenance checks can exhaust this short budget before spawn.
  await assert.rejects(
    () => ensureGateway(options(item, { startupTimeoutMs: 2500 })),
    /exited|did not become ready|Timed out checking process|startup deadline/i
  );
  assert.ok(Date.now() - startedAt < 10_000, 'launch failure exceeded its bounded deadline');
  assert.equal(await stopOwnedGateway({ stateDir: item.stateDir, port: item.port, timeoutMs: 1000 }), false);
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
