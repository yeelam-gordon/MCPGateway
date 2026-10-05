import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

test('token ACL cancellation terminates its exact subprocess without a fallback shell', { skip: process.platform !== 'win32', timeout: 10_000 }, async () => {
  const childProcess = require('node:child_process');
  const originalExecFile = childProcess.execFile;
  const controller = new AbortController();
  const stateDir = await mkdtemp(join(process.cwd(), '.gateway-cancel-acl-'));
  await writeFile(join(stateDir, 'owner.token'), 'neutral-fixture-token');
  const launched = Promise.withResolvers();
  const exited = Promise.withResolvers();
  let invocations = 0;
  childProcess.execFile = (_shell, _args, options, callback) => {
    invocations += 1;
    assert.equal(options.signal, controller.signal);
    const child = originalExecFile(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], options, callback);
    child.once('spawn', () => launched.resolve(child.pid));
    child.once('exit', () => exited.resolve());
    return child;
  };
  syncBuiltinESMExports();
  try {
    const { loadOrCreateToken } = await import(`../src/token.js?cancel=${Date.now()}`);
    const operation = loadOrCreateToken(stateDir, { signal: controller.signal });
    const rejected = assert.rejects(operation, error => error.name === 'AbortError');
    const pid = await launched.promise;
    const started = Date.now();
    controller.abort();
    await rejected;
    await exited.promise;
    assert.ok(Date.now() - started < 1500);
    assert.equal(invocations, 1);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    controller.abort();
    childProcess.execFile = originalExecFile;
    syncBuiltinESMExports();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('warm token loading batches directory and token ACL checks into one subprocess', { skip: process.platform !== 'win32', timeout: 30_000 }, async () => {
  const childProcess = require('node:child_process');
  const originalExecFile = childProcess.execFile;
  let invocations = 0;
  childProcess.execFile = function countedExecFile(...args) {
    invocations += 1;
    return originalExecFile.apply(this, args);
  };
  syncBuiltinESMExports();

  const stateDir = await mkdtemp(join(process.cwd(), '.mcp-gateway-token-performance-'));
  try {
    const { loadOrCreateToken } = await import(`../src/token.js?performance=${Date.now()}`);
    const coldStartedAt = performance.now();
    const cold = await loadOrCreateToken(stateDir);
    const coldMs = performance.now() - coldStartedAt;
    assert.equal(invocations, 2, 'cold creation must secure the directory before creating and securing the token');

    invocations = 0;
    const warmStartedAt = performance.now();
    const warm = await loadOrCreateToken(stateDir);
    const warmMs = performance.now() - warmStartedAt;
    assert.equal(invocations, 1, 'warm loading must batch both ACL checks into one PowerShell process');
    assert.deepEqual(warm, cold);
    console.log(`Token ACL timing: cold ${coldMs.toFixed(1)} ms; warm ${warmMs.toFixed(1)} ms`);
  } finally {
    childProcess.execFile = originalExecFile;
    syncBuiltinESMExports();
    await rm(stateDir, { recursive: true, force: true });
  }
});
