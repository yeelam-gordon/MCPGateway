import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { connectClient } from '../tools/connect-client.mjs';

const connectorScript = fileURLToPath(new URL('../tools/connector.mjs', import.meta.url));
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))));

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function backend(index, extra = {}) {
  return { type: 'stdio', command: 'node', args: [`server-${index}.mjs`], cwd: process.cwd(), disabled: false,
    tools: [`tool-${index}`], requiresExclusiveAccess: index % 2 === 0, ...extra };
}

async function fixture({ privateServers, clientServers, clientTop = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'client-sync-'));
  roots.push(root);
  const stateDir = join(root, 'state');
  const privatePath = join(stateDir, 'backends.json');
  const gatewayPath = join(root, 'copilot.json');
  const configPath = join(root, 'claude.json');
  const connector = { command: process.execPath, args: [connectorScript, '--auto-start',
    '--config', privatePath, '--port', '7319', '--state-dir', stateDir], timeout: 210000 };
  await writeJson(privatePath, { catalog: { preserved: true }, mcpServers: privateServers ?? {} });
  await writeJson(gatewayPath, { selected: true, mcpServers: { 'shared-mcp-gateway': connector } });
  await writeJson(configPath, { theme: 'preserved', ...clientTop, mcpServers: clientServers ?? {} });
  return { root, stateDir, privatePath, gatewayPath, configPath, connector,
    privateBytes: await readFile(privatePath), gatewayBytes: await readFile(gatewayPath), clientBytes: await readFile(configPath) };
}

async function fastToken(stateDir) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, 'owner.token'), 'token\n', { flag: 'wx' }).catch(error => {
    if (error.code !== 'EEXIST') throw error;
  });
}

const options = item => ({ client: 'claude', config: item.configPath, 'gateway-config': item.gatewayPath, migrate: true });

test('preview and apply merge two new aliases into ten existing backends with exact dual backups', async () => {
  const existing = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`backend-${index + 1}`, backend(index + 1)]));
  const duplicateOne = { tools: existing['backend-1'].tools, args: existing['backend-1'].args, command: existing['backend-1'].command,
    type: existing['backend-1'].type, cwd: existing['backend-1'].cwd, disabled: false, requiresExclusiveAccess: false };
  const clientServers = { 'backend-1': duplicateOne, 'backend-2': existing['backend-2'],
    'backend-11': backend(11, { disabled: true, tools: ['allowed-eleven'] }), 'backend-12': backend(12) };
  const item = await fixture({ privateServers: existing, clientServers, clientTop: { unrelated: { keep: true } } });
  const preview = await connectClient(options(item));
  assert.equal(preview.status, 'planned-sync');
  assert.deepEqual(preview.addedAliases, ['backend-11', 'backend-12']);
  assert.deepEqual(preview.identicalDuplicates, ['backend-1', 'backend-2']);
  assert.equal(preview.resultingBackendCount, 12);
  assert.equal(preview.restartRequired, true);
  assert.deepEqual(await readFile(item.privatePath), item.privateBytes);
  assert.deepEqual(await readFile(item.configPath), item.clientBytes);

  const applied = await connectClient({ ...options(item), apply: true, tokenLoader: fastToken });
  assert.equal(applied.status, 'synchronized');
  assert.equal(applied.backendCount, 12);
  const catalog = JSON.parse(await readFile(item.privatePath, 'utf8'));
  assert.equal(Object.keys(catalog.mcpServers).length, 12);
  assert.deepEqual(catalog.mcpServers['backend-11'], clientServers['backend-11']);
  assert.equal(catalog.mcpServers['backend-11'].disabled, true);
  assert.deepEqual(catalog.mcpServers['backend-11'].tools, ['allowed-eleven']);
  const client = JSON.parse(await readFile(item.configPath, 'utf8'));
  assert.deepEqual(Object.keys(client.mcpServers), ['shared-mcp-gateway']);
  assert.equal(client.theme, 'preserved');
  assert.deepEqual(client.unrelated, { keep: true });
  assert.deepEqual(await readFile(applied.sourceBackupPath), item.clientBytes);
  assert.deepEqual(await readFile(applied.backendBackupPath), item.privateBytes);
});

test('same alias conflict blocks additions and reports no restart or writes', async () => {
  const item = await fixture({ privateServers: { shared: backend(1) }, clientServers: { shared: backend(2), added: backend(3) } });
  const preview = await connectClient(options(item));
  assert.deepEqual(preview.addedAliases, ['added']);
  assert.deepEqual(preview.conflicts, ['shared']);
  assert.equal(preview.restartRequired, false);
  await assert.rejects(() => connectClient({ ...options(item), apply: true, tokenLoader: fastToken }), error => {
    assert.equal(error.setupResult.status, 'conflict');
    assert.equal(error.setupResult.restartRequired, false);
    assert.deepEqual(error.setupResult.conflicts, ['shared']);
    return true;
  });
  assert.deepEqual(await readFile(item.privatePath), item.privateBytes);
  assert.deepEqual(await readFile(item.configPath), item.clientBytes);
  await assert.rejects(() => stat(join(item.stateDir, 'backups')), error => error.code === 'ENOENT');
});

test('client config cannot be the private catalog by exact path or symlink identity', async t => {
  const exact = await fixture({ privateServers: { existing: backend(1) } });
  await assert.rejects(() => connectClient({ client: 'claude', config: exact.privatePath,
    'gateway-config': exact.gatewayPath, migrate: true, apply: true, tokenLoader: async () => assert.fail('identity rejection must precede token') }),
  /Client configuration must differ from private backend catalog/);
  assert.deepEqual(await readFile(exact.privatePath), exact.privateBytes);
  await assert.rejects(() => stat(join(exact.stateDir, 'backups')), error => error.code === 'ENOENT');

  const linked = await fixture({ privateServers: { existing: backend(2) } });
  const aliasPath = join(linked.root, 'catalog-link.json');
  try { await symlink(linked.privatePath, aliasPath, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.diagnostic(`symlink unavailable: ${error.code}`); return; }
    throw error;
  }
  await assert.rejects(() => connectClient({ client: 'claude', config: aliasPath,
    'gateway-config': linked.gatewayPath, migrate: true, apply: true, tokenLoader: async () => assert.fail('identity rejection must precede token') }),
  /must not resolve to the same file as private backend catalog/);
  assert.deepEqual(await readFile(linked.privatePath), linked.privateBytes);
});

test('reserved alias names migrate as own properties without prototype pollution', async () => {
  const clientServers = JSON.parse(`{"__proto__":${JSON.stringify(backend(1))},"constructor":${JSON.stringify(backend(2))},"prototype":${JSON.stringify(backend(3))}}`);
  const item = await fixture({ clientServers });
  await connectClient({ ...options(item), apply: true, tokenLoader: fastToken });
  const catalog = JSON.parse(await readFile(item.privatePath, 'utf8'));
  for (const name of ['__proto__', 'constructor', 'prototype']) {
    assert.equal(Object.hasOwn(catalog.mcpServers, name), true);
    assert.deepEqual(catalog.mcpServers[name], clientServers[name]);
  }
  assert.equal({}.polluted, undefined);
});

test('Codex CLI preview and apply surface TOML reserialization warnings', async () => {
  const item = await fixture();
  const original = `theme = "keep"\n# preserved by backup, regenerated in output\n[mcp_servers.native]\ncommand = "node"\nargs = ["native.mjs"]\ncwd = ${JSON.stringify(process.cwd())}\n`;
  await writeFile(item.configPath, original);
  const codexOptions = { client: 'codex', config: item.configPath, 'gateway-config': item.gatewayPath, migrate: true };
  const preview = await connectClient(codexOptions);
  assert.equal(preview.status, 'planned-sync');
  assert.equal(preview.warnings.length, 1);
  assert.match(preview.warnings[0], /comments and formatting are regenerated/);
  assert.equal(await readFile(item.configPath, 'utf8'), original);
  const applied = await connectClient({ ...codexOptions, apply: true, tokenLoader: fastToken });
  assert.equal(applied.status, 'synchronized');
  assert.deepEqual(applied.warnings, preview.warnings);
  assert.equal(await readFile(applied.sourceBackupPath, 'utf8'), original);
  assert.match(await readFile(item.configPath, 'utf8'), /theme = "keep"/);
});

test('unsupported native auth and variable fields are rejected without writes', async () => {
  for (const entry of [{ command: 'node', args: ['x'], auth: { type: 'oauth' } }, { command: 'node', args: ['x'], env: { TOKEN: '${secret}' } }]) {
    const item = await fixture({ clientServers: { unsafe: entry } });
    await assert.rejects(() => connectClient(options(item)), /authentication|literal values|not an approved field/);
    assert.deepEqual(await readFile(item.privatePath), item.privateBytes);
    assert.deepEqual(await readFile(item.configPath), item.clientBytes);
  }
});

test('gateway retarget during token preparation fails closed before either catalog write', async () => {
  const item = await fixture({ clientServers: { added: backend(1) } });
  const alternatePath = join(item.stateDir, 'alternate.json');
  await writeJson(alternatePath, { mcpServers: { alternate: backend(9) } });
  const alternateBytes = await readFile(alternatePath);
  const retargeted = JSON.parse(item.gatewayBytes.toString('utf8'));
  const args = retargeted.mcpServers['shared-mcp-gateway'].args;
  args[args.indexOf('--config') + 1] = alternatePath;
  await assert.rejects(() => connectClient({ ...options(item), apply: true,
    tokenLoader: async () => writeJson(item.gatewayPath, retargeted) }), /Gateway source configuration changed/);
  assert.deepEqual(await readFile(item.privatePath), item.privateBytes);
  assert.deepEqual(await readFile(item.configPath), item.clientBytes);
  assert.deepEqual(await readFile(alternatePath), alternateBytes);
});

test('client and catalog concurrent changes are preserved and abort publication', async () => {
  for (const target of ['client', 'catalog']) {
    const item = await fixture({ privateServers: { existing: backend(1) }, clientServers: { added: backend(2) } });
    const changed = Buffer.from(`{"changed":"${target}"}`);
    await assert.rejects(() => connectClient({ ...options(item), apply: true, tokenLoader: fastToken,
      beforeBackendWrite: () => writeFile(target === 'client' ? item.configPath : item.privatePath, changed) }), /changed during backend synchronization/);
    assert.deepEqual(await readFile(target === 'client' ? item.configPath : item.privatePath), changed);
    assert.deepEqual(await readFile(target === 'client' ? item.privatePath : item.configPath), target === 'client' ? item.privateBytes : item.clientBytes);
  }
});

test('second write failure reports partial state with exact usable backups', async () => {
  const item = await fixture({ privateServers: { existing: backend(1) }, clientServers: { added: backend(2) } });
  await assert.rejects(() => connectClient({ ...options(item), apply: true, tokenLoader: fastToken,
    sourceWriter: async () => { throw new Error('client write failed'); } }), error => {
    assert.equal(error.setupResult.status, 'partial-failure');
    assert.equal(error.setupResult.rollbackCommands.length, 2);
    assert.deepEqual(error.setupResult.client, 'claude');
    return true;
  });
  assert.deepEqual(await readFile(item.configPath), item.clientBytes);
  assert.deepEqual(JSON.parse(await readFile(item.privatePath, 'utf8')).mcpServers.added, backend(2));
  const backupDir = join(item.stateDir, 'backups', (await readdir(join(item.stateDir, 'backups')))[0]);
  assert.deepEqual(await readFile(join(backupDir, 'client-config.json')), item.clientBytes);
  assert.deepEqual(await readFile(join(backupDir, 'backends.json')), item.privateBytes);
});

test('repeated migration is a no-op with no additional backup or restart', async () => {
  const item = await fixture({ privateServers: { existing: backend(1) }, clientServers: { added: backend(2) } });
  await connectClient({ ...options(item), apply: true, tokenLoader: fastToken });
  const clientAfter = await readFile(item.configPath);
  const privateAfter = await readFile(item.privatePath);
  const backups = await readdir(join(item.stateDir, 'backups'));
  const repeated = await connectClient({ ...options(item), apply: true, tokenLoader: async () => assert.fail('no-op must not initialize state') });
  assert.equal(repeated.status, 'already-configured');
  assert.equal(repeated.restartRequired, false);
  assert.deepEqual(await readFile(item.configPath), clientAfter);
  assert.deepEqual(await readFile(item.privatePath), privateAfter);
  assert.deepEqual(await readdir(join(item.stateDir, 'backups')), backups);
  await writeFile(item.configPath, JSON.stringify({ mcpServers: {} }));
  const empty = await connectClient({ ...options(item), apply: true, tokenLoader: fastToken });
  assert.equal(empty.addedCount, 0);
  assert.equal(empty.identicalDuplicateCount, 0);
  assert.equal(empty.restartRequired, false);
  assert.match(empty.message, /Client configuration completed/);
  assert.doesNotMatch(empty.message, /duplicate native entries were removed/);
});
