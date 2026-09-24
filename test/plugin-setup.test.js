import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';
import { parseSetupArgs, pluginSetup, verifyTrustedClientDependencies } from '../tools/plugin-setup.mjs';

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const currentPackageVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
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
  await writeJson(join(root, 'package.json'), { name: 'fixture-runtime', version: currentPackageVersion, type: 'module' });
  await writeJson(join(root, 'package-lock.json'), { name: 'fixture-runtime', version: currentPackageVersion, lockfileVersion: 3, packages: { '': { name: 'fixture-runtime', version: currentPackageVersion } } });
  await mkdir(join(root, 'tools'), { recursive: true });
  await cp(new URL('../tools/migrate-config.mjs', import.meta.url), join(root, 'tools', 'migrate-config.mjs'));
  await cp(new URL('../tools/connector.mjs', import.meta.url), join(root, 'tools', 'connector.mjs'));
  await cp(new URL('../tools/connect-client.mjs', import.meta.url), join(root, 'tools', 'connect-client.mjs'));
  await mkdir(join(root, 'integrity'), { recursive: true });
  await cp(new URL('../integrity/client-runtime-dependencies.json', import.meta.url), join(root, 'integrity', 'client-runtime-dependencies.json'));
  await mkdir(join(root, 'src'), { recursive: true });
  await cp(new URL('../src/config.js', import.meta.url), join(root, 'src', 'config.js'));
  await cp(new URL('../src/config-schema.js', import.meta.url), join(root, 'src', 'config-schema.js'));
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

async function publishedRuntimeFixture(sourceRoot, item) {
  const preview = await pluginSetup({ sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir });
  await mkdir(join(preview.runtimePath, 'tools'), { recursive: true });
  for (const file of ['LICENSE', 'package.json', 'package-lock.json']) await cp(join(sourceRoot, file), join(preview.runtimePath, file));
  for (const file of ['connector.mjs', 'connect-client.mjs', 'migrate-config.mjs']) await cp(join(sourceRoot, 'tools', file), join(preview.runtimePath, 'tools', file));
  await mkdir(join(preview.runtimePath, 'integrity'), { recursive: true });
  await cp(join(sourceRoot, 'integrity', 'client-runtime-dependencies.json'), join(preview.runtimePath, 'integrity', 'client-runtime-dependencies.json'));
  await cp(join(sourceRoot, 'src'), join(preview.runtimePath, 'src'), { recursive: true });
  await cp(join(sourceRoot, 'adapters'), join(preview.runtimePath, 'adapters'), { recursive: true });
  await writeJson(join(preview.runtimePath, '.plugin-runtime.json'), { version: 1, contentHash: preview.contentHash });
  return preview;
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
    env: { [`TOKEN_${index + 1}`]: `secret-${index + 1}` }, tools: [`tool-${index + 1}`]
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
  original.mcpServers['backend-1'].requiresExclusiveAccess = true;
  original.mcpServers['backend-2'].requiresExclusiveAccess = false;
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

test('dependency-free plugin bootstrap delegates migration preview and apply to the installed stable runtime', { timeout: 120000 }, async () => {
  const item = await sourceFixture({ mcpServers: {
    existing: { command: 'node', args: ['existing.mjs'], cwd: repositoryRoot, env: { TOKEN: 'fixture' } }
  } });
  const installed = await pluginSetup({ sourceRoot: repositoryRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
    apply: true, tokenLoader: injectedToken });
  const isolated = await temporary('plugin-cache-isolated-');
  await mkdir(join(isolated, 'tools'), { recursive: true });
  for (const file of ['LICENSE', 'package.json', 'package-lock.json']) await cp(join(repositoryRoot, file), join(isolated, file));
  await cp(join(repositoryRoot, 'src'), join(isolated, 'src'), { recursive: true });
  await cp(join(repositoryRoot, 'adapters'), join(isolated, 'adapters'), { recursive: true });
  await cp(join(repositoryRoot, 'integrity'), join(isolated, 'integrity'), { recursive: true });
  for (const file of ['connector.mjs', 'connect-client.mjs', 'migrate-config.mjs', 'plugin-setup.mjs']) {
    await cp(join(repositoryRoot, 'tools', file), join(isolated, 'tools', file));
  }
  const bootstrap = join(isolated, 'tools', 'connect-client.mjs');
  await assert.rejects(() => stat(join(isolated, 'node_modules')), error => error.code === 'ENOENT');
  const clientPath = join(item.root, 'claude.json');
  await writeJson(clientPath, { keep: true, mcpServers: {
    existing: { command: 'node', args: ['existing.mjs'], cwd: repositoryRoot, env: { TOKEN: 'fixture' } },
    added: { command: 'node', args: ['added.mjs'], cwd: repositoryRoot }
  } });
  const dependencyEntry = join(installed.runtimePath, 'node_modules', 'smol-toml', 'dist', 'index.js');
  const originalDependency = await readFile(dependencyEntry);
  const dependencySentinel = join(item.root, 'tampered-dependency-executed.txt');
  const maliciousDependency = Buffer.concat([Buffer.from(`import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(dependencySentinel)}, 'executed');\n`), originalDependency]);
  await writeFile(dependencyEntry, maliciousDependency);
  await writeJson(join(installed.runtimePath, 'client-runtime-dependencies.json'), {
    forged: true, sha256: createHash('sha256').update(maliciousDependency).digest('hex')
  });
  for (const migrate of [false, true]) {
    const protectedClient = join(item.root, `tampered-dependency-${migrate}.json`);
    await writeJson(protectedClient, { keep: true, mcpServers: {} });
    const before = await readFile(protectedClient);
    const protectedArgs = [bootstrap, '--client', 'claude', '--config', protectedClient, '--gateway-config', item.sourcePath];
    if (migrate) protectedArgs.push('--migrate');
    await assert.rejects(() => execute(process.execPath, protectedArgs, { timeout: 30000, windowsHide: true }),
      error => /not trusted by this installed plugin payload/.test(error.stderr));
    assert.deepEqual(await readFile(protectedClient), before);
    await assert.rejects(() => stat(dependencySentinel), error => error.code === 'ENOENT');
  }
  await writeFile(dependencyEntry, originalDependency);
  await rm(join(installed.runtimePath, 'client-runtime-dependencies.json'));

  const shadowRoot = join(installed.runtimePath, 'src', 'node_modules', 'smol-toml');
  await mkdir(shadowRoot, { recursive: true });
  await writeJson(join(shadowRoot, 'package.json'), { name: 'smol-toml', version: '1.8.0', type: 'module' });
  await assert.rejects(() => verifyTrustedClientDependencies({ trustedRoot: isolated, runtimePath: installed.runtimePath }), /shadow smol-toml dependency/);
  await rm(join(installed.runtimePath, 'src', 'node_modules'), { recursive: true });

  const args = [bootstrap, '--client', 'claude', '--config', clientPath, '--gateway-config', item.sourcePath, '--migrate'];
  const preview = JSON.parse((await execute(process.execPath, args, { timeout: 30000, windowsHide: true })).stdout);
  assert.equal(preview.status, 'planned-sync');
  assert.deepEqual(preview.addedAliases, ['added']);
  const applied = JSON.parse((await execute(process.execPath, [...args, '--apply'], { timeout: 30000, windowsHide: true })).stdout);
  assert.equal(applied.status, 'synchronized');
  assert.equal(applied.runtimePath, undefined);
  const catalog = JSON.parse(await readFile(installed.privatePath, 'utf8'));
  assert.deepEqual(Object.keys(catalog.mcpServers).sort(), ['added', 'existing']);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(clientPath, 'utf8')).mcpServers), ['shared-mcp-gateway']);

  const untrustedDir = join(isolated, 'untrusted');
  const untrustedConnector = join(untrustedDir, 'connector.mjs');
  const sentinel = join(item.root, 'untrusted-connector-executed.txt');
  await mkdir(untrustedDir);
  await writeFile(untrustedConnector, `import { writeFile } from 'node:fs/promises';\nawait writeFile(${JSON.stringify(sentinel)}, 'executed');\n`);
  const evilGateway = JSON.parse(await readFile(item.sourcePath, 'utf8'));
  evilGateway.mcpServers['shared-mcp-gateway'].args[0] = untrustedConnector;
  await writeJson(item.sourcePath, evilGateway);
  for (const migrate of [false, true]) {
    const evilClient = join(item.root, `evil-${migrate}.json`);
    await writeJson(evilClient, { keep: true, mcpServers: {
      native: { command: 'node', args: ['native.mjs'], cwd: repositoryRoot }
    } });
    const before = await readFile(evilClient);
    const evilArgs = [bootstrap, '--client', 'claude', '--config', evilClient, '--gateway-config', item.sourcePath, '--apply'];
    if (migrate) evilArgs.push('--migrate');
    await assert.rejects(() => execute(process.execPath, evilArgs, { timeout: 30000, windowsHide: true }),
      error => /canonical tools[/\\]connector\.mjs/.test(error.stderr));
    assert.deepEqual(await readFile(evilClient), before);
    await assert.rejects(() => stat(sentinel), error => error.code === 'ENOENT');
  }
});

test('bootstrap rejects untrusted or unowned runtime helpers before executing them', async () => {
  const root = await temporary('malicious-runtime-');
  const runtime = join(root, 'forged-runtime');
  const stateDir = join(root, 'state');
  const privatePath = join(stateDir, 'backends.json');
  const gatewayPath = join(root, 'gateway.json');
  const clientPath = join(root, 'client.json');
  const sentinel = join(root, 'executed.txt');
  await mkdir(join(runtime, 'tools'), { recursive: true });
  await mkdir(join(runtime, 'src'), { recursive: true });
  await writeFile(join(runtime, 'tools', 'connector.mjs'), '// forged connector\n');
  await writeFile(join(runtime, 'src', 'client-connect.js'), `import { writeFile } from 'node:fs/promises';\nawait writeFile(${JSON.stringify(sentinel)}, 'executed');\nexport async function connectClient() { return { status: 'forged' }; }\n`);
  await writeJson(privatePath, { mcpServers: {} });
  await writeJson(clientPath, { mcpServers: {} });
  const connector = { command: process.execPath, args: [join(runtime, 'tools', 'connector.mjs'), '--auto-start',
    '--config', privatePath, '--port', '7319', '--state-dir', stateDir] };
  await writeJson(gatewayPath, { mcpServers: { 'shared-mcp-gateway': connector } });
  const baseArgs = [join(repositoryRoot, 'tools', 'connect-client.mjs'), '--client', 'claude', '--config', clientPath,
    '--gateway-config', gatewayPath];
  for (const extra of [[], ['--migrate']]) {
    await assert.rejects(() => execute(process.execPath, [...baseArgs, ...extra], { timeout: 30000, windowsHide: true }),
      error => /not trusted by this installed plugin payload/.test(error.stderr));
    await assert.rejects(() => stat(sentinel), error => error.code === 'ENOENT');
  }
  connector.command = 'unowned-node';
  await writeJson(gatewayPath, { mcpServers: { 'shared-mcp-gateway': connector } });
  await assert.rejects(() => execute(process.execPath, baseArgs, { timeout: 30000, windowsHide: true }),
    error => /owned shared-mcp-gateway connector/.test(error.stderr));
  await assert.rejects(() => stat(sentinel), error => error.code === 'ENOENT');
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

test('matching published runtime is rehashed and reused without overwriting it', async () => {
  const sourceRoot = await pluginFixture();
  const item = await sourceFixture({ mcpServers: aliases(1) });
  const published = await publishedRuntimeFixture(sourceRoot, item);
  const connectorPath = join(published.runtimePath, 'tools', 'connector.mjs');
  const connectorBytes = await readFile(connectorPath);
  const connectorStats = await stat(connectorPath);
  let npmCalled = false;
  const result = await pluginSetup({
    sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir, apply: true,
    tokenLoader: async () => {},
    npmRunner: async () => { npmCalled = true; },
    migrationRunner: async () => ({ status: 'migrated', backupPath: null, manifestPath: null })
  });
  assert.equal(result.runtimePath, published.runtimePath);
  assert.equal(npmCalled, false);
  assert.deepEqual(await readFile(connectorPath), connectorBytes);
  assert.equal((await stat(connectorPath)).mtimeMs, connectorStats.mtimeMs);
});

test('tampered published connector is rejected before reuse or migration', async () => {
  const sourceRoot = await pluginFixture();
  const item = await sourceFixture({ mcpServers: aliases(1) });
  const published = await publishedRuntimeFixture(sourceRoot, item);
  await writeFile(join(published.runtimePath, 'tools', 'connector.mjs'), '// tampered\n');
  let npmCalled = false;
  let migrationCalled = false;
  await assert.rejects(() => pluginSetup({
    sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir, apply: true,
    tokenLoader: async () => {},
    npmRunner: async () => { npmCalled = true; },
    migrationRunner: async () => { migrationCalled = true; }
  }), /content hash does not match/);
  assert.equal(npmCalled, false);
  assert.equal(migrationCalled, false);
  assert.deepEqual(await readFile(item.sourcePath), item.bytes);
});

test('published runtime missing a required file is rejected before reuse or migration', async () => {
  const sourceRoot = await pluginFixture();
  const item = await sourceFixture({ mcpServers: aliases(1) });
  const published = await publishedRuntimeFixture(sourceRoot, item);
  await rm(join(published.runtimePath, 'tools', 'connector.mjs'));
  let npmCalled = false;
  let migrationCalled = false;
  await assert.rejects(() => pluginSetup({
    sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir, apply: true,
    tokenLoader: async () => {},
    npmRunner: async () => { npmCalled = true; },
    migrationRunner: async () => { migrationCalled = true; }
  }), /missing required file: tools[\\/]connector\.mjs/);
  assert.equal(npmCalled, false);
  assert.equal(migrationCalled, false);
  assert.deepEqual(await readFile(item.sourcePath), item.bytes);
});

test('published runtime missing an installed dependency is rejected before reuse', async () => {
  const sourceRoot = await pluginFixture();
  await writeJson(join(sourceRoot, 'package.json'), {
    name: 'fixture-runtime', version: currentPackageVersion, type: 'module', dependencies: { 'fixture-dependency': '2.3.4' }
  });
  await writeJson(join(sourceRoot, 'package-lock.json'), {
    name: 'fixture-runtime', version: currentPackageVersion, lockfileVersion: 3,
    packages: {
      '': { name: 'fixture-runtime', version: currentPackageVersion, dependencies: { 'fixture-dependency': '2.3.4' } },
      'node_modules/fixture-dependency': { version: '2.3.4' }
    }
  });
  const item = await sourceFixture({ mcpServers: aliases(1) });
  await publishedRuntimeFixture(sourceRoot, item);
  await assert.rejects(() => pluginSetup({
    sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir, apply: true,
    tokenLoader: async () => {}
  }), /missing required dependency fixture-dependency/);
  assert.deepEqual(await readFile(item.sourcePath), item.bytes);
});

test('published runtime with a mismatched marker is rejected explicitly', async () => {
  const sourceRoot = await pluginFixture();
  const item = await sourceFixture({ mcpServers: aliases(1) });
  const published = await publishedRuntimeFixture(sourceRoot, item);
  await writeJson(join(published.runtimePath, '.plugin-runtime.json'), { version: 1, contentHash: 'f'.repeat(64) });
  await assert.rejects(() => pluginSetup({
    sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir, apply: true,
    tokenLoader: async () => {}
  }), /Runtime marker does not match its directory/);
  assert.deepEqual(await readFile(item.sourcePath), item.bytes);
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
  const backend = { servers: { manual: { type: 'http', url: 'https://example.test/mcp', tools: ['kept'] } } };
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

test('Windows path case variants preserve an existing install in default and adoption flows', { skip: process.platform !== 'win32' }, async () => {
  const variant = path => [...path].map(character => {
    const lower = character.toLowerCase();
    const upper = character.toUpperCase();
    return lower === upper ? character : character === lower ? upper : lower;
  }).join('');
  for (const adoptExisting of [false, true]) {
    const item = await existingGatewayFixture();
    const entry = item.source.mcpServers['shared-mcp-gateway'];
    entry.command = variant(entry.command);
    entry.args = entry.args.map((value, index, args) => index === 0 || ['--config', '--state-dir', '--adapters'].includes(args[index - 1]) ? variant(value) : value);
    await writeJson(item.sourcePath, item.source);
    const result = await pluginSetup({
      sourceRoot: item.sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
      platform: 'win32', adoptExisting
    });
    assert.equal(result.status, adoptExisting ? 'planned-adoption' : 'planned-sync');
  }
});

test('Windows path comparison still rejects genuinely different existing-install paths', async () => {
  for (const target of ['command', 'config', 'state']) {
    const item = await existingGatewayFixture();
    const entry = item.source.mcpServers['shared-mcp-gateway'];
    if (target === 'command') entry.command = join(item.root, 'different-node.exe');
    else {
      const flag = target === 'config' ? '--config' : '--state-dir';
      entry.args[entry.args.indexOf(flag) + 1] = join(item.root, `different-${target}`);
    }
    await writeJson(item.sourcePath, item.source);
    await assert.rejects(() => pluginSetup({
      sourceRoot: item.sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
      platform: 'win32', adoptExisting: true
    }), target === 'command' ? /different gateway command/ : /settings do not match/);
  }
});

test('mixed gateway entries are planned and applied as backend synchronization without runtime deployment', async () => {
  const item = await existingGatewayFixture();
  const privateConfig = JSON.parse(item.backendBytes.toString('utf8'));
  const duplicate = privateConfig.servers['backend-1'];
  item.source.mcpServers['newly-added'] = {
    command: 'node', args: ['new.js'], env: { TOKEN: 'new-secret' }, tools: ['new-tool'], requiresExclusiveAccess: true
  };
  item.source.mcpServers['backend-1'] = {
    tools: duplicate.tools, args: duplicate.args, command: duplicate.command, env: duplicate.env
  };
  await writeJson(item.sourcePath, item.source);
  const before = await readFile(item.sourcePath);
  let npmCalled = false;
  const preview = await pluginSetup({
    sourceRoot: join(item.root, 'missing-plugin'), sourceConfig: item.sourcePath, stateDir: item.stateDir,
    npmRunner: async () => { npmCalled = true; }
  });
  assert.equal(preview.status, 'planned-sync');
  assert.deepEqual(preview.addedAliases, ['newly-added']);
  assert.deepEqual(preview.identicalDuplicates, ['backend-1']);
  assert.deepEqual(preview.conflicts, []);
  assert.equal(preview.restartRequired, true);
  assert.equal(npmCalled, false);
  assert.deepEqual(await readFile(item.sourcePath), before);
  assert.deepEqual(await readFile(item.privatePath), item.backendBytes);

  await assert.rejects(() => pluginSetup({
    sourceRoot: item.sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
    adoptExisting: true, npmRunner: async () => { npmCalled = true; }
  }), /sync first then adopt/);
  assert.equal(npmCalled, false);

  const applied = await pluginSetup({
    sourceRoot: join(item.root, 'missing-plugin'), sourceConfig: item.sourcePath, stateDir: item.stateDir,
    apply: true, tokenLoader: injectedToken, npmRunner: async () => { npmCalled = true; }
  });
  assert.equal(applied.status, 'synchronized');
  assert.equal(applied.restartRequired, true);
  assert.equal(npmCalled, false);
  const source = JSON.parse(await readFile(item.sourcePath, 'utf8'));
  const backend = JSON.parse(await readFile(item.privatePath, 'utf8'));
  assert.deepEqual(Object.keys(source.mcpServers), ['shared-mcp-gateway']);
  assert.deepEqual(backend.servers['newly-added'], item.source.mcpServers['newly-added']);
  assert.deepEqual(backend.servers['backend-1'], duplicate);
  assert.deepEqual(await readFile(applied.sourceBackupPath), before);
  assert.deepEqual(await readFile(applied.backendBackupPath), item.backendBytes);
  assert.deepEqual(await readFile(item.adapterPath), item.adapterBytes);

  const different = await sourceFixture({ mcpServers: { 'shared-mcp-gateway': { command: 'unrelated', args: ['other.js'] } } });
  await assert.rejects(() => pluginSetup({ sourceConfig: different.sourcePath, stateDir: different.stateDir }), /different gateway command/);
  await assert.rejects(() => stat(different.stateDir), error => error.code === 'ENOENT');
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


async function existingGatewayFixture({ adapterInsideState = false, timeout } = {}) {
  const item = await sourceFixture({ mcpServers: {} });
  const sourceRoot = await pluginFixture();
  const privatePath = join(item.stateDir, 'backends.json');
  const backend = { servers: aliases(17), mapping: { preserved: true } };
  const backendBytes = Buffer.from(JSON.stringify(backend));
  await mkdir(dirname(privatePath), { recursive: true });
  await writeFile(privatePath, backendBytes);
  const adapterPath = adapterInsideState
    ? join(item.stateDir, 'manual-agency-adapters.json')
    : join(item.root, 'checkout', 'adapters', 'agency.json');
  const adapterBytes = Buffer.from('{"mapping":{"alpha":{"command":"agency"}},"preserved":true}');
  await mkdir(dirname(adapterPath), { recursive: true });
  await writeFile(adapterPath, adapterBytes);
  const oldConnectorPath = join(item.root, 'checkout', 'tools', 'connector.mjs');
  const entry = {
    command: process.execPath,
    args: [oldConnectorPath, '--auto-start', '--config', privatePath, '--port', '7319', '--state-dir', item.stateDir, '--adapters', adapterPath],
    type: 'stdio', tools: ['preserved-tool'], extra: { preserved: true },
    ...(timeout === undefined ? {} : { timeout })
  };
  const source = { theme: 'preserved', unrelated: { keep: true }, mcpServers: { 'shared-mcp-gateway': entry } };
  const sourceBytes = Buffer.from(JSON.stringify(source));
  await writeFile(item.sourcePath, sourceBytes);
  return { ...item, sourceRoot, privatePath, backendBytes, adapterPath, adapterBytes, oldConnectorPath, source, sourceBytes };
}

test('adopt-existing remains a normal preview when no gateway entry is active', async () => {
  const sourceRoot = await pluginFixture();
  const item = await sourceFixture({ mcpServers: aliases(2) });
  const result = await pluginSetup({ sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir, adoptExisting: true });
  assert.equal(result.status, 'planned');
  assert.equal(result.migrationStatus, 'planned');
  assert.equal(result.oldRuntimePath, undefined);
  assert.deepEqual(await readFile(item.sourcePath), item.bytes);
  await assert.rejects(() => stat(item.stateDir), error => error.code === 'ENOENT');
});

test('adopt-existing preview is builtin-only and writes nothing', async () => {
  const item = await existingGatewayFixture();
  let npmCalled = false;
  const beforeState = (await readdir(item.stateDir)).sort();
  const result = await pluginSetup({
    sourceRoot: item.sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir, adoptExisting: true,
    npmRunner: async () => { npmCalled = true; }
  });
  assert.equal(result.mode, 'preview');
  assert.equal(result.status, 'planned-adoption');
  assert.equal(result.backendCount, 17);
  assert.equal(result.oldRuntimePath, dirname(dirname(item.oldConnectorPath)));
  assert.equal(result.adaptersPath, join(item.stateDir, 'adopted-agency-adapters.json'));
  assert.equal(result.adapterCopied, true);
  assert.equal(result.restartRequired, true);
  assert.equal(result.backupPath, null);
  assert.equal(npmCalled, false);
  assert.deepEqual(await readFile(item.sourcePath), item.sourceBytes);
  assert.deepEqual(await readFile(item.privatePath), item.backendBytes);
  assert.deepEqual(await readFile(item.adapterPath), item.adapterBytes);
  assert.deepEqual((await readdir(item.stateDir)).sort(), beforeState);
});

test('adopt-existing apply deploys alongside an older runtime and switches only the client config', async () => {
  const item = await existingGatewayFixture({ timeout: 345678 });
  const olderHash = 'a'.repeat(64);
  const olderRuntime = join(item.stateDir, 'runtime', olderHash);
  await mkdir(olderRuntime, { recursive: true });
  await writeJson(join(olderRuntime, '.plugin-runtime.json'), { version: 1, contentHash: olderHash });
  const now = new Date('2026-09-23T09:35:12.000Z');
  const result = await pluginSetup({
    sourceRoot: item.sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
    adoptExisting: true, apply: true, now, npmRunner: async () => {}
  });
  assert.equal(result.status, 'adopted');
  assert.equal(result.restartRequired, true);
  assert.equal(result.oldRuntimePath, dirname(dirname(item.oldConnectorPath)));
  assert.notEqual(result.runtimePath, olderRuntime);
  assert.equal((await stat(olderRuntime)).isDirectory(), true);
  assert.deepEqual(await readFile(item.privatePath), item.backendBytes);
  assert.deepEqual(await readFile(item.adapterPath), item.adapterBytes);
  assert.deepEqual(await readFile(result.adaptersPath), item.adapterBytes);
  assert.deepEqual(await readFile(result.sourceBackupPath), item.sourceBytes);
  assert.deepEqual(await readFile(result.backendBackupPath), item.backendBytes);
  assert.deepEqual(await readFile(result.adapterBackupPath), item.adapterBytes);
  const adopted = JSON.parse(await readFile(item.sourcePath, 'utf8'));
  assert.equal(adopted.theme, 'preserved');
  assert.deepEqual(adopted.unrelated, { keep: true });
  const entry = adopted.mcpServers['shared-mcp-gateway'];
  assert.equal(entry.command, process.execPath);
  assert.equal(entry.args[0], join(result.runtimePath, 'tools', 'connector.mjs'));
  assert.equal(entry.args[entry.args.indexOf('--config') + 1], item.privatePath);
  assert.equal(entry.args[entry.args.indexOf('--state-dir') + 1], item.stateDir);
  assert.equal(entry.args[entry.args.indexOf('--port') + 1], '7319');
  assert.equal(entry.args[entry.args.indexOf('--adapters') + 1], result.adaptersPath);
  assert.equal(entry.timeout, 345678);
  assert.equal(entry.type, 'stdio');
  assert.deepEqual(entry.tools, ['preserved-tool']);
  assert.deepEqual(entry.extra, { preserved: true });
  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
  assert.equal(manifest.operation, 'adopt-existing');
  assert.equal(manifest.files.source.backupPath, result.sourceBackupPath);
  assert.equal(manifest.files.backend.backupPath, result.backendBackupPath);
  assert.equal(manifest.files.adapter.backupPath, result.adapterBackupPath);
  assert.equal(result.rollbackCommand, `Copy-Item -LiteralPath '${result.sourceBackupPath}' -Destination '${item.sourcePath}' -Force`);
  assert.match(result.message, /activation remains the caller's responsibility/);
});

test('adopt-existing preserves a private adapter path and supplies the client timeout default', async () => {
  const item = await existingGatewayFixture({ adapterInsideState: true });
  const result = await pluginSetup({
    sourceRoot: item.sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
    adoptExisting: true, apply: true, npmRunner: async () => {}
  });
  assert.equal(result.adapterCopied, false);
  assert.equal(result.adaptersPath, item.adapterPath);
  const entry = JSON.parse(await readFile(item.sourcePath, 'utf8')).mcpServers['shared-mcp-gateway'];
  assert.equal(entry.args[entry.args.indexOf('--adapters') + 1], item.adapterPath);
  assert.equal(entry.timeout, 210000);
  assert.deepEqual(await readFile(result.adapterBackupPath), item.adapterBytes);
});

test('adopt-existing dependency failure preserves all existing configuration bytes', async () => {
  const item = await existingGatewayFixture();
  await assert.rejects(() => pluginSetup({
    sourceRoot: item.sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
    adoptExisting: true, apply: true, npmRunner: async () => { throw new Error('dependency failure'); }
  }), error => {
    assert.match(error.message, /dependency failure/);
    assert.equal(error.setupResult.backupPath, null);
    return true;
  });
  assert.deepEqual(await readFile(item.sourcePath), item.sourceBytes);
  assert.deepEqual(await readFile(item.privatePath), item.backendBytes);
  assert.deepEqual(await readFile(item.adapterPath), item.adapterBytes);
  await assert.rejects(() => stat(join(item.stateDir, 'backups')), error => error.code === 'ENOENT');
});

test('adopt-existing client replacement failure retains originals and exact rollback backups', async () => {
  const item = await existingGatewayFixture();
  await assert.rejects(() => pluginSetup({
    sourceRoot: item.sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
    adoptExisting: true, apply: true, npmRunner: async () => {},
    sourceWriter: async () => { throw new Error('replacement denied'); }
  }), error => {
    assert.match(error.message, /could not replace source config/);
    assert.ok(error.setupResult.backupPath);
    assert.ok(error.setupResult.manifestPath);
    return true;
  });
  assert.deepEqual(await readFile(item.sourcePath), item.sourceBytes);
  assert.deepEqual(await readFile(item.privatePath), item.backendBytes);
  assert.deepEqual(await readFile(item.adapterPath), item.adapterBytes);
  const backupDir = join(item.stateDir, 'backups', (await readdir(join(item.stateDir, 'backups')))[0]);
  assert.deepEqual(await readFile(join(backupDir, 'client-config.json')), item.sourceBytes);
  assert.deepEqual(await readFile(join(backupDir, 'backends.json')), item.backendBytes);
  assert.deepEqual(await readFile(join(backupDir, 'agency-adapters.json')), item.adapterBytes);
});

test('adopt-existing refuses a conflicting stable adapter without deploying', async () => {
  const item = await existingGatewayFixture();
  const stableAdapter = join(item.stateDir, 'adopted-agency-adapters.json');
  await writeFile(stableAdapter, '{"different":true}');
  let npmCalled = false;
  await assert.rejects(() => pluginSetup({
    sourceRoot: item.sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
    adoptExisting: true, npmRunner: async () => { npmCalled = true; }
  }), /stable adapter config differs/);
  assert.equal(npmCalled, false);
  assert.deepEqual(await readFile(item.sourcePath), item.sourceBytes);
  assert.deepEqual(await readFile(item.privatePath), item.backendBytes);
  assert.deepEqual(await readFile(item.adapterPath), item.adapterBytes);
  assert.deepEqual(await readFile(stableAdapter), Buffer.from('{"different":true}'));
  await assert.rejects(() => stat(join(item.stateDir, 'runtime')), error => error.code === 'ENOENT');
});

test('adopt-existing refuses concurrent backend or adapter edits before client commit', async () => {
  for (const target of ['backend', 'adapter']) {
    const item = await existingGatewayFixture();
    const changed = Buffer.from(`{"changed":"${target}"}`);
    await assert.rejects(() => pluginSetup({
      sourceRoot: item.sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
      adoptExisting: true, apply: true, npmRunner: async () => {},
      beforeSourceReplace: () => writeFile(target === 'backend' ? item.privatePath : item.adapterPath, changed)
    }), new RegExp(`${target === 'backend' ? 'Backend' : 'Adapter'} config changed`));
    assert.deepEqual(await readFile(item.sourcePath), item.sourceBytes);
    assert.deepEqual(await readFile(target === 'backend' ? item.privatePath : item.adapterPath), changed);
  }
});


test('existing gateway validates connector and private runtime config before deployment or writes', async () => {
  for (const mutate of [
    item => { item.source.mcpServers['shared-mcp-gateway'].timeout = 'slow'; },
    item => { item.backend.servers['backend-1'].env = { TOKEN: 7 }; },
    item => { item.backend.servers['backend-1'].unknown = true; }
  ]) {
    const item = await existingGatewayFixture();
    item.backend = JSON.parse(item.backendBytes.toString('utf8'));
    mutate(item);
    await writeJson(item.sourcePath, item.source);
    await writeJson(item.privatePath, item.backend);
    let npmCalled = false;
    await assert.rejects(() => pluginSetup({
      sourceRoot: item.sourceRoot, sourceConfig: item.sourcePath, stateDir: item.stateDir,
      adoptExisting: true, apply: true, npmRunner: async () => { npmCalled = true; }
    }), /timeout|env\.TOKEN|unknown/);
    assert.equal(npmCalled, false);
    await assert.rejects(() => stat(join(item.stateDir, 'runtime')), error => error.code === 'ENOENT');
  }
});

test('parser exposes the explicit adopt-existing option', () => {
  assert.deepEqual(parseSetupArgs(['--adopt-existing', '--apply']), { adoptExisting: true, apply: true });
});
