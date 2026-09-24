import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPortableBackendPaths } from '../src/client-config-paths.js';
import { extractConfiguredBackends } from '../src/client-config.js';

function config(entry) {
  return { mcpServers: { worker: entry } };
}

test('accepts absolute commands and absolute cwd with relative scripts on Windows and POSIX', () => {
  assert.equal(assertPortableBackendPaths(config({ command: 'C:\\tools\\worker.exe', args: [] })).mcpServers.worker.command, 'C:\\tools\\worker.exe');
  assert.equal(assertPortableBackendPaths(config({ command: '/opt/tools/worker', args: [] })).mcpServers.worker.command, '/opt/tools/worker');
  assert.doesNotThrow(() => assertPortableBackendPaths(config({ command: 'node', args: ['worker.mjs'], cwd: 'C:\\project' })));
  assert.doesNotThrow(() => assertPortableBackendPaths(config({ command: 'node', args: ['./worker.mjs'], cwd: '/srv/project' })));
  assert.doesNotThrow(() => assertPortableBackendPaths(config({ command: 'node', args: ['https://example.test/config.json'] })));
});

test('rejects relative cwd, command paths, and script arguments without absolute cwd', () => {
  assert.throws(() => assertPortableBackendPaths(config({ command: 'node', args: [], cwd: './project' })), /cwd to be an explicit absolute/);
  assert.throws(() => assertPortableBackendPaths(config({ command: './bin/server', args: [] })), /relative command paths/);
  assert.throws(() => assertPortableBackendPaths(config({ command: 'node', args: ['./worker.mjs'] })), /script or relative path arguments/);
  assert.throws(() => assertPortableBackendPaths(config({ command: 'node', args: ['worker.mjs'] })), /script or relative path arguments/);
  assert.throws(() => assertPortableBackendPaths(config({ command: 'node', args: ['--config=./settings.json'] })), /script or relative path arguments/);
});

test('dispatcher applies path guard to extracted canonical backends', () => {
  assert.throws(
    () => extractConfiguredBackends({ client: 'claude', configText: JSON.stringify({ mcpServers: {
      worker: { command: 'node', args: ['worker.mjs'] }
    } }) }),
    /explicit absolute cwd or absolute paths/
  );
  assert.deepEqual(extractConfiguredBackends({ client: 'claude', configText: JSON.stringify({ mcpServers: {
    worker: { command: 'node', args: ['worker.mjs'], cwd: 'C:\\project' }
  } }) }), config({ command: 'node', args: ['worker.mjs'], cwd: 'C:\\project' }));
});