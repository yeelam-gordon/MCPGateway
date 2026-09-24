import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clientCapabilities, prepareConnectorRegistration, extractConfiguredBackends, prepareClientMigration } from '../src/client-config.js';
import { connectClient } from '../tools/connect-client.mjs';

const connectorScript = fileURLToPath(new URL('../tools/connector.mjs', import.meta.url));

test('one adapter boundary describes supported client formats explicitly', () => {
  for (const client of ['claude', 'vscode', 'opencode', 'qwen', 'kimi', 'antigravity']) {
    assert.deepEqual(clientCapabilities(client), {
      client, format: 'json', connectorRegistration: true, backendExtraction: true
    });
  }
  assert.equal(clientCapabilities('codex').format, 'toml');
  assert.equal(clientCapabilities('codex').backendExtraction, true);
  assert.throws(() => clientCapabilities('unknown'), /Unsupported client/);
  assert.deepEqual(extractConfiguredBackends({ client: 'codex', configText: '' }), { mcpServers: {} });
});

test('client migration adapter returns canonical backends and preserves non-MCP fields', () => {
  const connector = { command: process.execPath, args: ['connector.mjs', '--auto-start', '--config', 'state/backends.json', '--port', '7319', '--state-dir', 'state'] };
  const existing = { command: 'node', args: ['existing.mjs'], cwd: tmpdir(), tools: ['allowed'], disabled: true };
  const configText = JSON.stringify({ theme: 'keep', mcpServers: {
    existing
  } });
  const prepared = prepareClientMigration({ client: 'claude', configText, connector });
  assert.equal(prepared.client, 'claude');
  assert.equal(prepared.changed, true);
  assert.deepEqual(prepared.backends.mcpServers.existing, existing);
  const updated = JSON.parse(prepared.updatedText);
  assert.equal(updated.theme, 'keep');
  assert.deepEqual(Object.keys(updated.mcpServers), ['shared-mcp-gateway']);
});

test('client registration previews without writes then backs up only the selected client configuration', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gateway-client-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'opencode.json');
  const source = join(root, 'copilot.json');
  const state = join(root, 'private-state');
  const original = JSON.stringify({ theme: 'original', mcp: {
    existing: { type: 'local', command: ['node', 'server.mjs'], enabled: true }
  } });
  const connector = { command: process.execPath, args: [
    connectorScript,
    '--auto-start', '--config', join(state, 'backends.json'),
    '--port', '7319', '--state-dir', state
  ], tools: ['*'], timeout: 210000 };
  await writeFile(target, original);
  await writeFile(source, JSON.stringify({ mcpServers: { 'shared-mcp-gateway': connector } }));
  const sourceBytes = await readFile(source);
  const options = { client: 'opencode', config: target, 'gateway-config': source };
  const preview = await connectClient(options);
  assert.equal(preview.status, 'planned');
  assert.equal(await readFile(target, 'utf8'), original);
  await assert.rejects(access(state), { code: 'ENOENT' });
  const applied = await connectClient({ ...options, apply: true });
  assert.equal(applied.status, 'configured');
  assert.equal(await readFile(applied.backupPath, 'utf8'), original);
  assert.deepEqual(await readFile(source), sourceBytes);
  const result = JSON.parse(await readFile(target, 'utf8'));
  assert.deepEqual(result.mcp.existing, JSON.parse(original).mcp.existing);
  assert.deepEqual(result.mcp['shared-mcp-gateway'].command, [connector.command, ...connector.args]);
  const repeated = await connectClient({ ...options, apply: true });
  assert.equal(repeated.status, 'already-configured');
});

test('Codex uses an explicit native registration plan, not a fabricated TOML writer', async () => {
  const connector = { command: 'node', args: ['connector.mjs', '--state-dir', 'private state'] };
  const plan = await prepareConnectorRegistration({ client: 'codex', configText: '', connector });
  assert.equal(plan.requiresNativeCli, true);
  assert.equal(plan.registrationCommand.command, 'codex');
  assert.ok(Array.isArray(plan.registrationCommand.args));
});
