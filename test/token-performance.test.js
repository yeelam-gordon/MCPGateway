import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

test('warm token loading batches directory and token ACL checks into one subprocess', { skip: process.platform !== 'win32', timeout: 30_000 }, async () => {
  const childProcess = require('node:child_process');
  const originalExecFile = childProcess.execFile;
  let invocations = 0;
  childProcess.execFile = function countedExecFile(...args) {
    invocations += 1;
    return originalExecFile.apply(this, args);
  };
  syncBuiltinESMExports();

  const stateDir = await mkdtemp(join(tmpdir(), 'mcp-gateway-token-performance-'));
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
