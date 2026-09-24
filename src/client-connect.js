import { readFile, mkdir, writeFile, rename, link, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { prepareConnectorRegistration, clientCapabilities } from './client-config.js';
import { loadOrCreateToken } from './token.js';

export async function connectClient(options) {
  const capabilities = clientCapabilities(options.client);
  const configPath = resolve(options.config);
  const gatewayPath = resolve(options['gateway-config'] ?? join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'mcp-config.json'));
  const samePath = process.platform === 'win32'
    ? configPath.toLowerCase() === gatewayPath.toLowerCase()
    : configPath === gatewayPath;
  if (samePath) throw new Error('Client destination must differ from the source gateway configuration');
  let gatewayBytes = options.verifiedGatewayBytes;
  let connector = options.verifiedConnector;
  if (gatewayBytes !== undefined && !Buffer.isBuffer(gatewayBytes)) throw new TypeError('verifiedGatewayBytes must be a Buffer');
  if (gatewayBytes === undefined || connector === undefined) {
    let gateway;
    try { gatewayBytes = await readFile(gatewayPath); gateway = JSON.parse(gatewayBytes.toString('utf8')); }
    catch { throw new Error('Cannot read a valid source gateway configuration; configure the gateway first'); }
    connector = gateway.mcpServers?.['shared-mcp-gateway'] ?? gateway.servers?.['shared-mcp-gateway'];
  }
  if (!connector || !Array.isArray(connector.args)) throw new Error('Source configuration does not contain a stdio shared-mcp-gateway connector');
  const assertGatewayUnchanged = async () => {
    if (!(await readFile(gatewayPath)).equals(gatewayBytes)) {
      throw new Error('Gateway source configuration changed after bootstrap verification; refusing client setup');
    }
  };
  await assertGatewayUnchanged();
  const { inspectGatewayConnector, assertDifferentFiles } = await import('./client-sync.js');
  const platform = options.platform ?? process.platform;
  const owned = inspectGatewayConnector(connector, platform);
  await assertDifferentFiles(configPath, owned.privatePath, 'Client configuration', 'private backend catalog',
    platform, { allowMissing: !options.migrate });
  await assertDifferentFiles(configPath, gatewayPath, 'Client configuration', 'gateway source configuration',
    platform, { allowMissing: !options.migrate });
  let original = null;
  try { original = await readFile(configPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (options.migrate) {
    if (original === null) throw new Error('Client migration requires an existing client configuration; use registration-only setup for a new client');
    const { synchronizeClientMigration } = await import('./client-sync.js');
    return synchronizeClientMigration({
      client: options.client, configPath, gatewayPath, gatewayBytes, connector, apply: options.apply === true,
      platform: options.platform, tokenLoader: options.tokenLoader, lockTimeoutMs: options.lockTimeoutMs,
      backendWriter: options.backendWriter, sourceWriter: options.sourceWriter,
      beforeBackendWrite: options.beforeBackendWrite, beforeSourceWrite: options.beforeSourceWrite
    });
  }
  const prepared = await prepareConnectorRegistration({
    client: options.client, configPath, configText: original ?? '{}', connector
  });
  await assertGatewayUnchanged();
  if (capabilities.format === 'toml') {
    if (options.apply) throw new Error('Codex registration uses its native CLI. Preview the registration command and run it after reviewing the existing Codex configuration.');
    return { status: 'native-cli-required', client: options.client, configPath, registrationCommand: prepared.registrationCommand };
  }
  const plan = {
    status: prepared.changed ? 'planned' : 'already-configured',
    client: options.client, configPath, changed: prepared.changed,
    message: 'Register only the shared gateway connector. Existing servers, backend catalog, and approval settings are not migrated or removed.',
    backupPath: null
  };
  if (!options.apply || !prepared.changed) return plan;
  const stateIndex = connector.args.indexOf('--state-dir');
  if (stateIndex < 0 || !connector.args[stateIndex + 1]) throw new Error('Gateway connector has no private state directory for backups');
  const stateDir = resolve(connector.args[stateIndex + 1]);
  await (options.tokenLoader ?? loadOrCreateToken)(stateDir);
  await assertGatewayUnchanged();
  const backupDir = join(stateDir, 'backups', `client-${options.client}-${randomUUID()}`);
  await mkdir(backupDir, { recursive: false, mode: 0o700 }).catch(async error => {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(dirname(backupDir), { recursive: true, mode: 0o700 });
    await mkdir(backupDir, { recursive: false, mode: 0o700 });
  });
  const backupPath = original === null ? null : join(backupDir, 'original-config.txt');
  if (backupPath) await writeFile(backupPath, original, { flag: 'wx', mode: 0o600 });
  await writeFile(join(backupDir, 'manifest.json'), JSON.stringify({
    operation: 'register-client-connector', client: options.client, configPath, backupPath, originallyAbsent: original === null
  }, null, 2), { flag: 'wx', mode: 0o600 });
  let current = null;
  try { current = await readFile(configPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (current !== original) throw new Error(`Client configuration changed; refusing replacement. Backup: ${backupPath ?? backupDir}`);
  await assertGatewayUnchanged();
  await mkdir(dirname(configPath), { recursive: true });
  const staged = `${configPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(staged, prepared.updatedText, { flag: 'wx', mode: 0o600 });
    if (original === null) {
      await link(staged, configPath);
      await rm(staged);
    } else {
      await rename(staged, configPath);
    }
  } catch (error) {
    await rm(staged, { force: true });
    throw new Error(`Client registration failed. Backup: ${backupPath ?? backupDir}`, { cause: error });
  }
  return { ...plan, status: 'configured', backupPath, manifestPath: join(backupDir, 'manifest.json') };
}
