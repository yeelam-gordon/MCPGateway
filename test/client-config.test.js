import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, link, symlink } from 'node:fs/promises';
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

test('registration rejects gateway edits after bootstrap verification and during token preparation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gateway-registration-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'opencode.json');
  const gatewayPath = join(root, 'gateway.json');
  const stateDir = join(root, 'state');
  const privatePath = join(stateDir, 'backends.json');
  const original = JSON.stringify({ theme: 'unchanged', mcp: {} });
  const connector = { command: process.execPath, args: [connectorScript, '--auto-start', '--config', privatePath,
    '--port', '7319', '--state-dir', stateDir] };
  const validGateway = { mcpServers: { 'shared-mcp-gateway': connector } };
  const changedGateway = { mcpServers: { 'shared-mcp-gateway': { ...connector, args: [...connector.args.slice(0, -1), `${stateDir}-changed`] } } };
  await writeFile(target, original);
  await writeFile(gatewayPath, JSON.stringify(validGateway));
  const base = { client: 'opencode', config: target, 'gateway-config': gatewayPath };

  await assert.rejects(() => connectClient({ ...base,
    beforeRuntimeOperation: () => writeFile(gatewayPath, JSON.stringify(changedGateway)) }), /changed after bootstrap verification/);
  assert.equal(await readFile(target, 'utf8'), original);

  await writeFile(gatewayPath, JSON.stringify(validGateway));
  await assert.rejects(() => connectClient({ ...base, apply: true,
    tokenLoader: async () => writeFile(gatewayPath, JSON.stringify(changedGateway)) }), /changed after bootstrap verification/);
  assert.equal(await readFile(target, 'utf8'), original);
  await assert.rejects(() => access(join(stateDir, 'backups')), { code: 'ENOENT' });
});

test('registration rejects private catalog and gateway aliases before state preparation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gateway-registration-alias-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDir = join(root, 'state');
  const privatePath = join(stateDir, 'backends.json');
  const gatewayPath = join(root, 'copilot.json');
  await mkdir(stateDir);
  const catalog = JSON.stringify({ mcpServers: { existing: { command: process.execPath, args: ['--version'] } } });
  const connector = { command: process.execPath, args: [
    connectorScript, '--auto-start', '--config', privatePath, '--state-dir', stateDir, '--port', '7319'
  ] };
  await writeFile(privatePath, catalog);
  await writeFile(gatewayPath, JSON.stringify({ mcpServers: { 'shared-mcp-gateway': connector } }));
  const gatewayBytes = await readFile(gatewayPath);
  const targets = [privatePath];
  for (const [name, source] of [['catalog', privatePath], ['gateway', gatewayPath]]) {
    const hard = join(root, `${name}-hardlink.json`);
    await link(source, hard);
    targets.push(hard);
    const symbolic = join(root, `${name}-symlink.json`);
    try {
      await symlink(source, symbolic, 'file');
      targets.push(symbolic);
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error;
      t.diagnostic(`${name} symlink creation unavailable; exact-path and hardlink checks remain active`);
    }
  }
  for (const client of ['claude', 'vscode', 'opencode', 'qwen', 'kimi', 'antigravity', 'codex']) {
    for (const config of targets) {
      for (const apply of [false, true]) {
        await assert.rejects(() => connectClient({ client, config, 'gateway-config': gatewayPath, apply,
          tokenLoader: async () => assert.fail('Aliased input must be rejected before token preparation')
        }), /Client configuration must (?:differ|not resolve)/);
        assert.equal(await readFile(privatePath, 'utf8'), catalog);
        assert.deepEqual(await readFile(gatewayPath), gatewayBytes);
      }
    }
  }
  await assert.rejects(access(join(stateDir, 'owner.token')), { code: 'ENOENT' });
  await assert.rejects(access(join(stateDir, 'backups')), { code: 'ENOENT' });
});

test('Codex uses an explicit native registration plan, not a fabricated TOML writer', async () => {
  const connector = { command: 'node', args: ['connector.mjs', '--state-dir', 'private state'] };
  const plan = await prepareConnectorRegistration({ client: 'codex', configText: '', connector });
  assert.equal(plan.requiresNativeCli, true);
  assert.equal(plan.registrationCommand.command, 'codex');
  assert.ok(Array.isArray(plan.registrationCommand.args));
});
