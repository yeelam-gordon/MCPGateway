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
  for (const command of ['worker.mjs', 'server.py']) {
    assert.throws(() => assertPortableBackendPaths(config({ command, args: [] })), /relative command paths/);
    assert.doesNotThrow(() => assertPortableBackendPaths(config({ command, args: [], cwd: '/srv/project' })));
  }
  for (const cwd of [undefined, 'C:\\project', 'D:\\project']) {
    assert.throws(() => assertPortableBackendPaths(config({ command: 'C:worker.exe', args: [], cwd })), /drive-relative commands/);
  }
  for (const cwd of [undefined, 'C:\\project', 'D:\\project']) {
    for (const argument of ['C:worker.mjs', '--config=C:settings.json']) {
      assert.throws(() => assertPortableBackendPaths(config({ command: 'node', args: [argument], cwd })), /drive-relative/);
    }
  }
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

test('rejects bare script files independently of launcher but permits scoped packages', () => {
  for (const entry of [
    { command: 'npx', args: ['worker.mjs'] },
    { command: 'uv', args: ['run', 'worker.py'] },
    { command: 'custom-launcher', args: ['script.rb'] }
  ]) assert.throws(() => assertPortableBackendPaths(config(entry)), /script or relative path arguments/);

  for (const entry of [
    { command: 'npx', args: ['worker.mjs'], cwd: 'C:\\project' },
    { command: 'uv', args: ['run', 'worker.py'], cwd: '/srv/project' },
    { command: 'custom-launcher', args: ['script.rb'], cwd: 'C:\\project' },
    { command: 'npx', args: ['@scope/pkg'] },
    { command: 'npx', args: ['-y', '@scope/pkg@1.2.3'] }
  ]) assert.doesNotThrow(() => assertPortableBackendPaths(config(entry)));
});