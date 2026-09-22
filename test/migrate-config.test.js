import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { migrateConfig } from '../tools/migrate-config.mjs';

const fixtures = [];
afterEach(async () => Promise.all(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true }))));
async function fixture(config) {
  const root = await mkdtemp(join(tmpdir(), 'migrate-config-')); fixtures.push(root);
  const sourceConfig = join(root, 'mcp-config.json'); const stateDir = join(root, 'state');
  const bytes = Buffer.from(JSON.stringify(config)); await writeFile(sourceConfig, bytes);
  return { root, sourceConfig, stateDir, bytes };
}
const source = { theme: 'preserved', mcpServers: {
  alpha: { command: 'node', args: ['server.js', '--org', 'example'], env: { TOKEN: 'top-secret' }, tools: ['one'] },
  remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer hidden' }, tools: ['two'] },
  disabled: { disabled: true, command: 'node', args: ['off.js'] }
} };

test('dry run writes nothing', async () => {
  const item = await fixture(source); const value = await migrateConfig({ sourceConfig: item.sourceConfig, stateDir: item.stateDir });
  assert.equal(value.status, 'planned'); assert.deepEqual(await readFile(item.sourceConfig), item.bytes);
  await assert.rejects(() => stat(item.stateDir), error => error.code === 'ENOENT');
});
test('first apply makes exact copies and preserves backend details', async () => {
  const item = await fixture(source); const value = await migrateConfig({ sourceConfig: item.sourceConfig, stateDir: item.stateDir, apply: true, now: new Date('2026-09-22T04:00:00Z') });
  assert.deepEqual(await readFile(value.privatePath), item.bytes); assert.deepEqual(await readFile(value.backupPath), item.bytes);
  const raw = JSON.parse(await readFile(value.privatePath, 'utf8')); assert.deepEqual(raw.mcpServers.alpha.args, ['server.js', '--org', 'example']);
  assert.deepEqual(raw.mcpServers.alpha.tools, ['one']); assert.equal(raw.mcpServers.remote.headers.Authorization, 'Bearer hidden');
  const migrated = JSON.parse(await readFile(item.sourceConfig, 'utf8')); assert.equal(migrated.theme, 'preserved'); assert.deepEqual(Object.keys(migrated.mcpServers), ['shared-mcp-gateway']);
  assert.equal(migrated.mcpServers['shared-mcp-gateway'].timeout, 210000);
  const args = migrated.mcpServers['shared-mcp-gateway'].args; assert.ok(args.includes('--auto-start')); assert.equal(args[args.indexOf('--config') + 1], value.privatePath);
  const manifest = JSON.parse(await readFile(value.manifestPath, 'utf8')); assert.equal(manifest.backupLocation, value.backupPath); assert.equal(JSON.stringify(manifest).includes('top-secret'), false);
});
test('rerun verifies state without overwriting', async () => {
  const item = await fixture(source); await migrateConfig({ sourceConfig: item.sourceConfig, stateDir: item.stateDir, apply: true });
  const before = await readFile(join(item.stateDir, 'backends.json')); const value = await migrateConfig({ sourceConfig: item.sourceConfig, stateDir: item.stateDir, apply: true });
  assert.equal(value.status, 'already-migrated'); assert.deepEqual(await readFile(join(item.stateDir, 'backends.json')), before); assert.equal((await readdir(join(item.stateDir, 'backups'))).length, 1);
});
test('conflicting private config refuses before writes', async () => {
  const item = await fixture(source); await mkdir(item.stateDir); await writeFile(join(item.stateDir, 'backends.json'), JSON.stringify({ mcpServers: { other: { command: 'node' } } }));
  await assert.rejects(() => migrateConfig({ sourceConfig: item.sourceConfig, stateDir: item.stateDir, apply: true }), /differs/);
  assert.deepEqual(await readFile(item.sourceConfig), item.bytes); assert.deepEqual(await readdir(item.stateDir), ['backends.json']);
});
test('invalid source aborts before writes', async () => {
  const item = await fixture({ mcpServers: { broken: { command: 'node', url: 'https://example.test' } } });
  await assert.rejects(() => migrateConfig({ sourceConfig: item.sourceConfig, stateDir: item.stateDir, apply: true }), /Invalid MCP config/);
  await assert.rejects(() => stat(item.stateDir), error => error.code === 'ENOENT');
});
test('Agency subset includes only present eligible aliases', async () => {
  const item = await fixture({ mcpServers: { 'M365-Profile': { url: 'https://profile.example/mcp', headers: {}, tools: ['GetMyDetails'] }, ICM: { disabled: true, url: 'https://icm.example/mcp' }, webiq: { url: 'https://webiq.example/mcp' } } });
  const value = await migrateConfig({ sourceConfig: item.sourceConfig, stateDir: item.stateDir, apply: true, agencyAdapters: true, agencyAvailable: true });
  assert.deepEqual(JSON.parse(await readFile(value.adaptersPath, 'utf8')), { 'M365-Profile': 'm365-user' });
  assert.equal(JSON.parse(await readFile(value.privatePath, 'utf8')).mcpServers['M365-Profile'].url, 'https://profile.example/mcp');
  assert.ok(value.skippedAdapters.some(item => item.name === 'ICM' && item.reason === 'disabled')); assert.ok(value.skippedAdapters.some(item => item.name === 'M365_Mail' && item.reason === 'not present'));
});
test('results and errors do not expose secrets', async () => {
  const item = await fixture(source); const value = await migrateConfig({ sourceConfig: item.sourceConfig, stateDir: item.stateDir });
  assert.equal(JSON.stringify(value).includes('top-secret'), false); assert.equal(JSON.stringify(value).includes('Bearer hidden'), false);
  const credential = await fixture({ mcpServers: { Enghub: { url: 'https://docs.example.test/mcp', headers: { Authorization: 'secret-value' } } } });
  await assert.rejects(() => migrateConfig({ sourceConfig: credential.sourceConfig, stateDir: credential.stateDir, agencyAdapters: true, agencyAvailable: true }), error => !error.message.includes('secret-value') && /credential headers/.test(error.message));
});

test('rejects mixed and colliding self entries without writes', async () => {
  const connectorPath = new URL('../tools/connector.mjs', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
  const mixed = await fixture({ mcpServers: {
    'shared-mcp-gateway': { command: process.execPath, args: [connectorPath, '--auto-start', '--config', 'unused', '--port', '7319', '--state-dir', 'unused'] },
    added: { command: 'node', args: ['added.js'] }
  } });
  await assert.rejects(() => migrateConfig({ sourceConfig: mixed.sourceConfig, stateDir: mixed.stateDir, apply: true }), /mixes/);
  await assert.rejects(() => stat(mixed.stateDir), error => error.code === 'ENOENT');
  const collision = await fixture({ mcpServers: { 'shared-mcp-gateway': { disabled: true, command: 'other-program' } } });
  await assert.rejects(() => migrateConfig({ sourceConfig: collision.sourceConfig, stateDir: collision.stateDir, apply: true }), /different command/);
  await assert.rejects(() => stat(collision.stateDir), error => error.code === 'ENOENT');
});

test('malformed JSON errors never echo secret input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migrate-config-')); fixtures.push(root);
  const sourceConfig = join(root, 'mcp-config.json'); const stateDir = join(root, 'state');
  await writeFile(sourceConfig, '{"mcpServers":{"secret-value":');
  await assert.rejects(() => migrateConfig({ sourceConfig, stateDir, apply: true }), error => /invalid JSON/.test(error.message) && !error.message.includes('secret-value'));
  await assert.rejects(() => stat(stateDir), error => error.code === 'ENOENT');
});

test('concurrent source edits are preserved and abort replacement', async () => {
  const item = await fixture(source); const changed = Buffer.from(JSON.stringify({ ...source, concurrent: 'preserved' }));
  await assert.rejects(() => migrateConfig({ sourceConfig: item.sourceConfig, stateDir: item.stateDir, apply: true,
    beforeSourceReplace: () => writeFile(item.sourceConfig, changed) }), /changed during migration/);
  assert.deepEqual(await readFile(item.sourceConfig), changed);
});

test('timestamp collisions cannot overwrite an existing backup', async () => {
  const item = await fixture(source); const now = new Date('2026-09-22T04:00:00Z');
  const backupDir = join(item.stateDir, 'backups', '2026-09-22T04-00-00.000Z'); await mkdir(backupDir, { recursive: true });
  const backupPath = join(backupDir, 'mcp-config.json'); await writeFile(backupPath, 'previous-backup');
  await assert.rejects(() => migrateConfig({ sourceConfig: item.sourceConfig, stateDir: item.stateDir, apply: true, now }), error => error.code === 'EEXIST');
  assert.equal(await readFile(backupPath, 'utf8'), 'previous-backup'); assert.deepEqual(await readFile(item.sourceConfig), item.bytes);
  await assert.rejects(() => stat(join(item.stateDir, 'owner.token')), error => error.code === 'ENOENT');
});
