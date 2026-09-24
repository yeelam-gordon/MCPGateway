import { readFile, mkdir, writeFile, rename, link, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { prepareConnectorRegistration, clientCapabilities } from '../src/client-config.js';
import { loadOrCreateToken } from '../src/token.js';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--apply') { options.apply = true; continue; }
    if (!['--client', '--config', '--gateway-config'].includes(flag) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('Usage: node tools/connect-client.mjs --client NAME --config PATH [--gateway-config PATH] [--apply]');
    }
    const key = flag.slice(2);
    if (Object.hasOwn(options, key)) throw new Error(`Repeated option: ${flag}`);
    options[key] = argv[++index];
  }
  if (!options.client || !options.config) throw new Error('--client and --config are required; configuration locations must be selected explicitly');
  return options;
}

export async function connectClient(options) {
  const capabilities = clientCapabilities(options.client);
  const configPath = resolve(options.config);
  const gatewayPath = resolve(options['gateway-config'] ?? join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'mcp-config.json'));
  const samePath = process.platform === 'win32'
    ? configPath.toLowerCase() === gatewayPath.toLowerCase()
    : configPath === gatewayPath;
  if (samePath) throw new Error('Client destination must differ from the source gateway configuration');
  let gateway;
  try { gateway = JSON.parse(await readFile(gatewayPath, 'utf8')); }
  catch { throw new Error('Cannot read a valid source gateway configuration; configure the gateway first'); }
  const connector = gateway.mcpServers?.['shared-mcp-gateway'] ?? gateway.servers?.['shared-mcp-gateway'];
  if (!connector || !Array.isArray(connector.args)) throw new Error('Source configuration does not contain a stdio shared-mcp-gateway connector');
  let original = null;
  try { original = await readFile(configPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const prepared = await prepareConnectorRegistration({
    client: options.client, configPath, configText: original ?? '{}', connector
  });
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
  await loadOrCreateToken(stateDir);
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve().then(() => connectClient(parseArgs(process.argv.slice(2))))
    .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => { process.stderr.write(`Client setup failed: ${error.message}\n`); process.exitCode = 1; });
}
