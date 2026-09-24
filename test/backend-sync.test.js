import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { synchronizeBackends } from '../src/backend-sync.js';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))));

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'backend-sync-'));
  roots.push(root);
  return root;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function connector(privatePath, stateDir) {
  return {
    command: process.execPath,
    args: ['connector.mjs', '--auto-start', '--config', privatePath, '--port', '7319', '--state-dir', stateDir],
    timeout: 210000,
    type: 'stdio',
    tools: ['preserved-connector-field']
  };
}

function backend(index, extra = {}) {
  return {
    command: 'node',
    args: [`server-${index}.js`, '--index', String(index)],
    env: { TOKEN: `secret-${index}` },
    tools: [`tool-${index}`],
    requiresExclusiveAccess: index % 2 === 0,
    disabled: false,
    ...extra
  };
}

async function fixture({ sourceExtras = {}, privateServers = {}, sourceTop = {}, privateTop = {} } = {}) {
  const root = await temporary();
  const stateDir = join(root, 'state');
  const sourcePath = join(root, 'mcp-config.json');
  const privatePath = join(stateDir, 'backends.json');
  const source = { theme: 'source-preserved', ...sourceTop, mcpServers: { 'shared-mcp-gateway': connector(privatePath, stateDir), ...sourceExtras } };
  const privateConfig = { catalogVersion: 7, ...privateTop, mcpServers: privateServers };
  await writeJson(sourcePath, source);
  await writeJson(privatePath, privateConfig);
  return { root, stateDir, sourcePath, privatePath, source, privateConfig,
    sourceBytes: await readFile(sourcePath), privateBytes: await readFile(privatePath) };
}

async function fastToken(stateDir) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, 'owner.token'), 'test-token\n', { flag: 'wx' }).catch(error => {
    if (error.code !== 'EEXIST') throw error;
  });
}

test('preview reports additions, duplicates, conflicts, and writes nothing without disclosing settings', async () => {
  const duplicate = backend(2);
  const item = await fixture({
    sourceExtras: { added: backend(1), duplicate: { tools: duplicate.tools, env: duplicate.env, args: duplicate.args, command: duplicate.command,
      disabled: duplicate.disabled, requiresExclusiveAccess: duplicate.requiresExclusiveAccess }, conflict: backend(3) },
    privateServers: { duplicate, conflict: backend(4), preserved: backend(5) }
  });
  const beforeState = (await readdir(item.stateDir)).sort();
  const result = await synchronizeBackends({ sourcePath: item.sourcePath, privatePath: item.privatePath, stateDir: item.stateDir });
  assert.equal(result.status, 'planned-sync');
  assert.deepEqual(result.addedAliases, ['added']);
  assert.deepEqual(result.identicalDuplicates, ['duplicate']);
  assert.deepEqual(result.conflicts, ['conflict']);
  assert.equal(result.addedCount, 1);
  assert.equal(result.identicalDuplicateCount, 1);
  assert.equal(result.conflictCount, 1);
  assert.equal(result.restartRequired, false);
  assert.equal(JSON.stringify(result).includes('secret-'), false);
  assert.deepEqual(await readFile(item.sourcePath), item.sourceBytes);
  assert.deepEqual(await readFile(item.privatePath), item.privateBytes);
  assert.deepEqual((await readdir(item.stateDir)).sort(), beforeState);
});

test('apply adds two aliases exactly, preserves top-level fields, backs up both files, and leaves only the connector in source', async () => {
  const first = backend(1, { cwd: 'C:\\one', headers: { Authorization: 'Bearer exact' }, timeout: 4567 });
  const second = { type: 'http', url: 'https://example.test/mcp', headers: { 'X-Key': 'credential' }, tools: ['one', 'two'], disabled: true };
  const item = await fixture({ sourceExtras: { first, second }, privateServers: { existing: backend(9) },
    sourceTop: { unrelated: { source: true } }, privateTop: { mapping: { private: true } } });
  const result = await synchronizeBackends({ sourcePath: item.sourcePath, privatePath: item.privatePath, stateDir: item.stateDir,
    apply: true, tokenLoader: fastToken, now: new Date('2026-09-24T03:01:00.000Z') });
  assert.equal(result.status, 'synchronized');
  assert.deepEqual(result.addedAliases, ['first', 'second']);
  assert.equal(result.restartRequired, true);
  const source = JSON.parse(await readFile(item.sourcePath, 'utf8'));
  const catalog = JSON.parse(await readFile(item.privatePath, 'utf8'));
  assert.deepEqual(Object.keys(source.mcpServers), ['shared-mcp-gateway']);
  assert.equal(source.theme, 'source-preserved');
  assert.deepEqual(source.unrelated, { source: true });
  assert.equal(catalog.catalogVersion, 7);
  assert.deepEqual(catalog.mapping, { private: true });
  assert.deepEqual(catalog.mcpServers.first, first);
  assert.deepEqual(catalog.mcpServers.second, second);
  assert.deepEqual(await readFile(result.sourceBackupPath), item.sourceBytes);
  assert.deepEqual(await readFile(result.backendBackupPath), item.privateBytes);
  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
  assert.equal(manifest.operation, 'backend-sync');
  assert.equal(manifest.files.source.backupPath, result.sourceBackupPath);
  assert.equal(manifest.files.backend.backupPath, result.backendBackupPath);
  assert.deepEqual(result.rollbackCommands, [result.backendRollbackCommand, result.rollbackCommand]);
});

test('reserved object property names are preserved as aliases without prototype mutation', async () => {
  const sourceExtras = JSON.parse(`{"__proto__":${JSON.stringify(backend(1))},"constructor":${JSON.stringify(backend(2))},"prototype":${JSON.stringify(backend(3))}}`);
  const item = await fixture({ sourceExtras });
  const result = await synchronizeBackends({ sourcePath: item.sourcePath, privatePath: item.privatePath, stateDir: item.stateDir,
    apply: true, tokenLoader: fastToken });
  assert.deepEqual(result.addedAliases, ['__proto__', 'constructor', 'prototype']);
  const catalog = JSON.parse(await readFile(item.privatePath, 'utf8'));
  for (const name of ['__proto__', 'constructor', 'prototype']) {
    assert.equal(Object.hasOwn(catalog.mcpServers, name), true);
    assert.deepEqual(catalog.mcpServers[name], sourceExtras[name]);
  }
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(item.sourcePath, 'utf8')).mcpServers), ['shared-mcp-gateway']);
});

test('semantic duplicates ignore object key order, deduplicate source, and repeated apply is a no-op', async () => {
  const stored = backend(2);
  const reordered = { tools: stored.tools, requiresExclusiveAccess: stored.requiresExclusiveAccess, disabled: stored.disabled,
    env: stored.env, args: stored.args, command: stored.command };
  const item = await fixture({ sourceExtras: { duplicate: reordered }, privateServers: { duplicate: stored } });
  const first = await synchronizeBackends({ sourcePath: item.sourcePath, privatePath: item.privatePath, stateDir: item.stateDir,
    apply: true, tokenLoader: fastToken });
  assert.deepEqual(first.identicalDuplicates, ['duplicate']);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(item.sourcePath, 'utf8')).mcpServers), ['shared-mcp-gateway']);
  const sourceAfter = await readFile(item.sourcePath);
  const privateAfter = await readFile(item.privatePath);
  const backupDirectories = await readdir(join(item.stateDir, 'backups'));
  const second = await synchronizeBackends({ sourcePath: item.sourcePath, privatePath: item.privatePath, stateDir: item.stateDir,
    apply: true, tokenLoader: async () => assert.fail('idempotent apply should not initialize state') });
  assert.equal(second.status, 'already-configured');
  assert.equal(second.restartRequired, false);
  assert.deepEqual(await readFile(item.sourcePath), sourceAfter);
  assert.deepEqual(await readFile(item.privatePath), privateAfter);
  assert.deepEqual(await readdir(join(item.stateDir, 'backups')), backupDirectories);
});

test('apply rejects any conflicting alias and leaves both files untouched', async () => {
  const item = await fixture({ sourceExtras: { conflict: backend(1) }, privateServers: { conflict: backend(2) } });
  await assert.rejects(() => synchronizeBackends({ sourcePath: item.sourcePath, privatePath: item.privatePath, stateDir: item.stateDir,
    apply: true, tokenLoader: async () => assert.fail('conflict must fail before state preparation') }), error => {
    assert.match(error.message, /conflict/);
    assert.equal(error.setupResult.status, 'conflict');
    assert.deepEqual(error.setupResult.conflicts, ['conflict']);
    return true;
  });
  assert.deepEqual(await readFile(item.sourcePath), item.sourceBytes);
  assert.deepEqual(await readFile(item.privatePath), item.privateBytes);
  await assert.rejects(() => stat(join(item.stateDir, 'backups')), error => error.code === 'ENOENT');
});

test('invalid credential values abort before writes without leaking the credential', async () => {
  const item = await fixture();
  const secret = 'never-print-invalid-secret';
  const invalid = { ...item.source, mcpServers: { ...item.source.mcpServers, bad: { command: 'node', env: { TOKEN: { secret } } } } };
  await writeJson(item.sourcePath, invalid);
  const invalidBytes = await readFile(item.sourcePath);
  await assert.rejects(() => synchronizeBackends({ sourcePath: item.sourcePath, privatePath: item.privatePath, stateDir: item.stateDir,
    apply: true }), error => /env\.TOKEN/.test(error.message) && !error.message.includes(secret));
  assert.deepEqual(await readFile(item.sourcePath), invalidBytes);
  assert.deepEqual(await readFile(item.privatePath), item.privateBytes);
  await assert.rejects(() => stat(join(item.stateDir, 'backups')), error => error.code === 'ENOENT');
});

test('connector changes during token preparation are rejected without modifying either catalog', async () => {
  const item = await fixture({ sourceExtras: { pending: backend(1) }, privateServers: { existing: backend(2) } });
  const alternatePath = join(item.stateDir, 'alternate-backends.json');
  const alternate = { mcpServers: { alternate: backend(3) } };
  await writeJson(alternatePath, alternate);
  const alternateBytes = await readFile(alternatePath);
  const switched = JSON.parse(item.sourceBytes.toString('utf8'));
  const args = switched.mcpServers['shared-mcp-gateway'].args;
  args[args.indexOf('--config') + 1] = alternatePath;
  const switchedBytes = Buffer.from(`${JSON.stringify(switched, null, 2)}\n`);

  await assert.rejects(() => synchronizeBackends({
    sourcePath: item.sourcePath, privatePath: item.privatePath, stateDir: item.stateDir, apply: true,
    expectedSourceBytes: item.sourceBytes, expectedPrivateBytes: item.privateBytes,
    tokenLoader: async () => writeFile(item.sourcePath, switchedBytes)
  }), error => {
    assert.match(error.message, /changed during synchronization preparation/);
    assert.equal(error.setupResult.status, 'failed');
    return true;
  });
  const retained = JSON.parse(await readFile(item.sourcePath, 'utf8'));
  assert.equal(Object.hasOwn(retained.mcpServers, 'pending'), true);
  assert.equal(retained.mcpServers['shared-mcp-gateway'].args.includes(alternatePath), true);
  assert.deepEqual(await readFile(item.privatePath), item.privateBytes);
  assert.deepEqual(await readFile(alternatePath), alternateBytes);
  await assert.rejects(() => stat(join(item.stateDir, 'backups')), error => error.code === 'ENOENT');
});

test('concurrent source edit after backend publication is preserved and exact backups remain usable', async () => {
  const item = await fixture({ sourceExtras: { added: backend(1) }, privateServers: { existing: backend(2) } });
  const concurrent = Buffer.from(JSON.stringify({ concurrentlyChanged: true }));
  await assert.rejects(() => synchronizeBackends({ sourcePath: item.sourcePath, privatePath: item.privatePath, stateDir: item.stateDir,
    apply: true, tokenLoader: fastToken, beforeSourceWrite: () => writeFile(item.sourcePath, concurrent) }), error => {
    assert.match(error.message, /Source config changed/);
    assert.equal(error.setupResult.status, 'partial-failure');
    assert.deepEqual(error.setupResult.rollbackCommands.length, 2);
    return true;
  });
  assert.deepEqual(await readFile(item.sourcePath), concurrent);
  const merged = JSON.parse(await readFile(item.privatePath, 'utf8'));
  assert.deepEqual(merged.mcpServers.added, backend(1));
  const backupDir = join(item.stateDir, 'backups', (await readdir(join(item.stateDir, 'backups')))[0]);
  assert.deepEqual(await readFile(join(backupDir, 'client-config.json')), item.sourceBytes);
  assert.deepEqual(await readFile(join(backupDir, 'backends.json')), item.privateBytes);
});

test('second write failure reports partial state and both exact backups without rolling back concurrent-safe publication', async () => {
  const item = await fixture({ sourceExtras: { added: backend(1) }, privateServers: { existing: backend(2) } });
  await assert.rejects(() => synchronizeBackends({ sourcePath: item.sourcePath, privatePath: item.privatePath, stateDir: item.stateDir,
    apply: true, tokenLoader: fastToken, sourceWriter: async () => { throw new Error('injected source failure'); } }), error => {
    assert.match(error.message, /injected source failure/);
    assert.equal(error.setupResult.status, 'partial-failure');
    assert.equal(error.setupResult.synchronizationStatus, 'partial-failure');
    assert.equal(error.setupResult.restartRequired, true);
    assert.match(error.setupResult.message, /manually restore both backups/);
    assert.equal(error.setupResult.rollbackCommands.length, 2);
    return true;
  });
  assert.deepEqual(await readFile(item.sourcePath), item.sourceBytes);
  const merged = JSON.parse(await readFile(item.privatePath, 'utf8'));
  assert.deepEqual(merged.mcpServers.added, backend(1));
  const backupDir = join(item.stateDir, 'backups', (await readdir(join(item.stateDir, 'backups')))[0]);
  assert.deepEqual(await readFile(join(backupDir, 'client-config.json')), item.sourceBytes);
  assert.deepEqual(await readFile(join(backupDir, 'backends.json')), item.privateBytes);
});

test('apply uses owner-token ACL preparation and bounded locking while self-loop catalogs are blocked', async () => {
  const item = await fixture({ sourceExtras: { added: backend(1) } });
  const applied = await synchronizeBackends({ sourcePath: item.sourcePath, privatePath: item.privatePath, stateDir: item.stateDir, apply: true });
  assert.equal(applied.status, 'synchronized');
  assert.equal((await readFile(join(item.stateDir, 'owner.token'), 'utf8')).trim().length > 0, true);

  const locked = await fixture({ sourceExtras: { added: backend(2) } });
  await writeFile(join(locked.stateDir, 'backend-sync.lock'), '{"held":true}\n');
  await assert.rejects(() => synchronizeBackends({ sourcePath: locked.sourcePath, privatePath: locked.privatePath, stateDir: locked.stateDir,
    apply: true, tokenLoader: fastToken, lockTimeoutMs: 40 }), /lock did not become available within 40ms/);
  assert.deepEqual(await readFile(locked.sourcePath), locked.sourceBytes);
  assert.deepEqual(await readFile(locked.privatePath), locked.privateBytes);

  const looped = await fixture({ privateServers: { 'shared-mcp-gateway': backend(3) } });
  await assert.rejects(() => synchronizeBackends({ sourcePath: looped.sourcePath, privatePath: looped.privatePath, stateDir: looped.stateDir }), /self-loop is blocked/);
});
