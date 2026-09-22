import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { parseSetupArgs, pluginSetup } from '../tools/plugin-setup.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))));

async function temporary(prefix = 'plugin-setup-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function pluginFixture() {
  const root = await temporary();
  await cp(new URL('../LICENSE', import.meta.url), join(root, 'LICENSE'));
  await writeJson(join(root, 'package.json'), { name: 'fixture-runtime', version: '1.0.0', type: 'module' });
  await writeJson(join(root, 'package-lock.json'), { name: 'fixture-runtime', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'fixture-runtime', version: '1.0.0' } } });
  await mkdir(join(root, 'tools'), { recursive: true });
  await cp(new URL('../tools/migrate-config.mjs', import.meta.url), join(root, 'tools', 'migrate-config.mjs'));
  await cp(new URL('../tools/connector.mjs', import.meta.url), join(root, 'tools', 'connector.mjs'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'config.js'), "export async function loadConfig() { return {}; }\n");
  await writeFile(join(root, 'src', 'request-budget.js'), "export const CLIENT_REQUEST_TIMEOUT_MS = 120000;\n");
  await writeFile(join(root, 'src', 'token.js'), `import { mkdir, readFile, writeFile } from 'node:fs/promises';\nimport { join } from 'node:path';\nexport async function loadOrCreateToken(stateDir) { await mkdir(stateDir, { recursive: true }); const path = join(stateDir, 'owner.token'); try { return { token: (await readFile(path, 'utf8')).trim(), path }; } catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(path, 'fixture-token\\n'); return { token: 'fixture-token', path }; } }\n`);
  await mkdir(join(root, 'adapters'), { recursive: true });
  await writeJson(join(root, 'adapters', 'agency.json'), {});
  await mkdir(join(root, 'node_modules', 'excluded-package'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'excluded-package', 'secret.txt'), 'must-not-copy');
  await mkdir(join(root, '.git'), { recursive: true });
  await writeFile(join(root, '.git', 'config'), 'must-not-copy');
  return root;
}

async function sourceFixture(config) {
  const root = await temporary('plugin-setup-config-');
  const sourcePath = join(root, 'mcp-config.json');
  const stateDir = join(root, 'state');
  const bytes = Buffer.from(JSON.stringify(config));
  await writeFile(sourcePath, bytes);
  return { root, sourcePath, stateDir, bytes };
}

async function injectedToken(stateDir) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, 'owner.token'), 'fixture-token\n', { flag: 'wx' });
}

function aliases(count = 13) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`backend-${index + 1}`, {
    command: 'node', args: [`server-${index + 1}.js`, '--index', String(index + 1)],
    env: { [`TOKEN_${index + 1}`]: `secret-${index + 1}` }, tools: [`tool-${index + 1}`], extra: { index }
  }]));
}

test('preview is builtin-only, excludes node_modules, and writes nothing', async () => {
  const sourceRoot = await pluginFixture();
  const item = await sourceFixture({ mcpServers: aliases(2) });
  let npmCalled = false;
  const result = await pluginSetup({ sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
    npmRunner: async () => { npmCalled = true; }, tokenLoader: async () => assert.fail('preview created a token') });
  assert.equal(result.mode, 'preview');
  assert.equal(result.status, 'planned');
  assert.equal(result.sourceExists, true);
  assert.equal(result.backendCount, 2);
  assert.equal(result.outputVersion, 1);
  assert.match(result.pluginInstallBehavior, /only downloads/);
  assert.match(result.setupInvocation, /\/mcp-gateway-setup/);
  assert.equal(result.packageSetupInvocation, 'npm run setup -- --apply performs the same explicit setup from a repository checkout.');
  assert.match(result.copilotMcpAddBehavior, /only registers a command/);
  assert.equal(result.sourcePath, item.sourcePath);
  assert.equal(result.backupPath, null);
  assert.equal(result.manifestPath, null);
  assert.equal(result.rollbackCommand, null);
  assert.equal(result.message, 'Preview complete; no files were changed.');
  assert.equal(npmCalled, false);
  assert.deepEqual(await readFile(item.sourcePath), item.bytes);
  await assert.rejects(() => stat(item.stateDir), error => error.code === 'ENOENT');
});

test('apply publishes a stable runtime then invokes copied migration with exact backup and 13 aliases preserved', async () => {
  const sourceRoot = await pluginFixture();
  const original = { theme: 'preserved', mcpServers: aliases(13) };
  const item = await sourceFixture(original);
  const result = await pluginSetup({ sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir, apply: true, tokenLoader: injectedToken });
  assert.equal(result.status, 'configured');
  assert.equal(result.migrationStatus, 'migrated');
  assert.ok(result.runtimePath.startsWith(join(item.stateDir, 'runtime')));
  assert.equal(await readFile(join(result.runtimePath, 'LICENSE'), 'utf8'), await readFile(join(sourceRoot, 'LICENSE'), 'utf8'));
  assert.equal(result.runtimePath.includes(sourceRoot), false);
  await assert.rejects(() => stat(join(result.runtimePath, 'node_modules', 'excluded-package', 'secret.txt')), error => error.code === 'ENOENT');
  assert.deepEqual(await readFile(result.migration.privatePath), item.bytes);
  assert.deepEqual(await readFile(result.migration.backupPath), item.bytes);
  const privateConfig = JSON.parse(await readFile(result.migration.privatePath, 'utf8'));
  assert.deepEqual(privateConfig, original);
  const migrated = JSON.parse(await readFile(item.sourcePath, 'utf8'));
  const entry = migrated.mcpServers['shared-mcp-gateway'];
  const connectorPath = resolve(entry.args[0]);
  assert.equal(connectorPath, join(result.runtimePath, 'tools', 'connector.mjs'));
  assert.equal(connectorPath.includes(sourceRoot), false);
  assert.deepEqual(result.readinessCommand.args.slice(-1), ['--check']);
  assert.equal(result.sourcePath, item.sourcePath);
  assert.equal(result.backupPath, result.migration.backupPath);
  assert.equal(result.manifestPath, result.migration.manifestPath);
  assert.equal(result.rollbackCommand, `Copy-Item -LiteralPath '${result.backupPath}' -Destination '${item.sourcePath}' -Force`);
  assert.match(result.message, /completed successfully/);
  assert.match(result.recoveryPrompt, /If the migrated MCP setup does not work/);
  assert.match(result.restartNewCli, /start a new Copilot CLI session/);
  assert.match(result.runtimeHealthPowerShell, /--check/);
});

test('dependency failure leaves user config untouched and cleans only staging runtime', async () => {
  const sourceRoot = await pluginFixture();
  const item = await sourceFixture({ mcpServers: aliases(1) });
  await assert.rejects(() => pluginSetup({ sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir, apply: true,
    npmRunner: async () => { throw new Error('Dependency installation failed with exit code 23'); }, tokenLoader: injectedToken }), error => {
    assert.match(error.message, /exit code 23/);
    assert.equal(error.setupResult.backupPath, null);
    assert.equal(error.setupResult.manifestPath, null);
    assert.equal(error.setupResult.rollbackCommand, null);
    assert.equal(error.setupResult.migrationStarted, false);
    assert.match(error.setupResult.message, /source config was unchanged and no restore is needed/);
    return true;
  });
  assert.deepEqual(await readFile(item.sourcePath), item.bytes);
  assert.deepEqual((await readdir(item.stateDir)).sort(), ['owner.token', 'runtime']);
  assert.deepEqual(await readdir(join(item.stateDir, 'runtime')), []);
});

test('migration-stage failure returns the exact backup and copyable manual restore command', async () => {
  const sourceRoot = await pluginFixture();
  const original = { mcpServers: aliases(3) };
  const item = await sourceFixture(original);
  const concurrentlyChanged = Buffer.from(JSON.stringify({ mcpServers: aliases(1), changed: true }));
  await assert.rejects(() => pluginSetup({
    sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir, apply: true, tokenLoader: injectedToken,
    npmRunner: async () => {}, beforeSourceReplace: () => writeFile(item.sourcePath, concurrentlyChanged)
  }), error => {
    const details = error.setupResult;
    assert.equal(details.status, 'failed');
    assert.equal(details.migrationStarted, true);
    assert.equal(details.sourcePath, item.sourcePath);
    assert.ok(details.backupPath);
    assert.ok(details.manifestPath);
    assert.equal(details.rollbackCommand, `Copy-Item -LiteralPath '${details.backupPath}' -Destination '${item.sourcePath}' -Force`);
    assert.match(details.message, /failed after creating an exact backup/);
    assert.match(details.recoveryPrompt, /restore the exact original config/);
    assert.match(details.runtimeHealthPowerShell, /--check/);
    return true;
  });
  const backupRoot = join(item.stateDir, 'backups');
  const timestamp = (await readdir(backupRoot))[0];
  const backupPath = join(backupRoot, timestamp, 'mcp-config.json');
  assert.deepEqual(await readFile(backupPath), item.bytes);
  assert.deepEqual(await readFile(item.sourcePath), concurrentlyChanged);
});

test('existing migrated entry and private config are detected and preserved without deployment', async () => {
  const item = await sourceFixture({ mcpServers: {} });
  const privatePath = join(item.stateDir, 'backends.json');
  const connectorPath = join(item.root, 'old-install', 'tools', 'connector.mjs');
  const backend = { servers: { manual: { type: 'http', url: 'https://example.test/mcp', tools: ['kept'], extra: { keep: true } } } };
  await writeJson(privatePath, backend);
  const current = { mcpServers: { 'shared-mcp-gateway': {
    command: process.execPath,
    args: [connectorPath, '--auto-start', '--config', privatePath, '--port', '7319', '--state-dir', item.stateDir, '--adapters', join(item.stateDir, 'agency-adapters.json')],
    type: 'stdio', tools: ['manual-extra-field'], extra: { keep: true }
  } } };
  await writeJson(item.sourcePath, current);
  const before = await readFile(item.sourcePath);
  const result = await pluginSetup({ sourceRoot: join(item.root, 'missing-plugin'), sourceConfig: item.sourcePath, stateDir: item.stateDir, apply: true });
  assert.equal(result.status, 'already-configured');
  assert.equal(result.backendCount, 1);
  assert.equal(result.sourcePath, item.sourcePath);
  assert.equal(result.backupPath, null);
  assert.equal(result.rollbackCommand, null);
  assert.match(result.message, /already configured/);
  assert.match(result.runtimeHealthPowerShell, /--check/);
  assert.deepEqual(await readFile(item.sourcePath), before);
  assert.deepEqual(await readdir(item.stateDir), ['backends.json']);
});

test('mixed or different shared gateway aliases are rejected explicitly', async () => {
  const item = await sourceFixture({ mcpServers: {
    'shared-mcp-gateway': { command: process.execPath, args: ['connector.mjs', '--auto-start', '--config', 'x', '--port', '7319', '--state-dir', 'y'] },
    other: { command: 'node', args: ['other.js'] }
  } });
  await assert.rejects(() => pluginSetup({ sourceConfig: item.sourcePath, stateDir: item.stateDir }), /mixes/);
  await writeJson(item.sourcePath, { mcpServers: { 'shared-mcp-gateway': { command: 'unrelated', args: ['other.js'] } } });
  await assert.rejects(() => pluginSetup({ sourceConfig: item.sourcePath, stateDir: item.stateDir }), /different gateway command/);
  await assert.rejects(() => stat(item.stateDir), error => error.code === 'ENOENT');
});

test('results and parser errors do not disclose config secrets', async () => {
  const sourceRoot = await pluginFixture();
  const item = await sourceFixture({ mcpServers: { private: { command: 'node', env: { TOKEN: 'never-print-this' }, headers: { Authorization: 'also-secret' } } } });
  const result = await pluginSetup({ sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir });
  assert.equal(JSON.stringify(result).includes('never-print-this'), false);
  assert.equal(JSON.stringify(result).includes('also-secret'), false);
  assert.throws(() => parseSetupArgs(['--unknown']), /Usage:/);
  assert.throws(() => parseSetupArgs(['--port', '7319', 'stray']), /Usage:/);
  assert.throws(() => parseSetupArgs(['--source-config']), /Usage:/);
  await assert.rejects(() => pluginSetup({ sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir, nodeVersion: '23.9.0' }), /Node.js >=24/);
});

test('missing or malformed source config fails without fabricating state', async () => {
  const sourceRoot = await pluginFixture();
  const root = await temporary('plugin-setup-missing-');
  const stateDir = join(root, 'state');
  await assert.rejects(() => pluginSetup({ sourceRoot, sourceConfig: join(root, 'missing.json'), stateDir }), /does not exist/);
  const malformed = join(root, 'malformed.json');
  await writeFile(malformed, '{"mcpServers":{"secret":');
  await assert.rejects(() => pluginSetup({ sourceRoot, sourceConfig: malformed, stateDir }), error => /invalid JSON/.test(error.message) && !error.message.includes('secret'));
  await assert.rejects(() => stat(stateDir), error => error.code === 'ENOENT');
});
