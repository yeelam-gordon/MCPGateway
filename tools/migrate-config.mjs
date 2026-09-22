import { constants as fsConstants } from 'node:fs';
import { access, chmod, link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.js';
import { loadOrCreateToken } from '../src/token.js';
import { CLIENT_REQUEST_TIMEOUT_MS } from '../src/request-budget.js';

const SELF_NAME = 'shared-mcp-gateway';
const ADAPTER_MAPPING_PATH = fileURLToPath(new URL('../adapters/agency.json', import.meta.url));
const CONNECTOR_PATH = fileURLToPath(new URL('./connector.mjs', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const timestamp = date => date.toISOString().replaceAll(':', '-');

function collection(config) {
  const keys = ['mcpServers', 'servers'].filter(key => Object.hasOwn(config, key));
  if (keys.length !== 1 || !config[keys[0]] || typeof config[keys[0]] !== 'object' || Array.isArray(config[keys[0]]))
    throw new Error('Source config must contain exactly one of mcpServers or servers');
  return { key: keys[0], servers: config[keys[0]] };
}
function selfConnector(entry) {
  return entry && entry.command === process.execPath && Array.isArray(entry.args) && entry.args[0] && resolve(entry.args[0]) === resolve(CONNECTOR_PATH);
}
function connector({ privatePath, stateDir, port, adaptersPath }) {
  const args = [CONNECTOR_PATH, '--auto-start', '--config', privatePath, '--port', String(port), '--state-dir', stateDir];
  if (adaptersPath) args.push('--adapters', adaptersPath);
  return { command: process.execPath, args, timeout: CLIENT_REQUEST_TIMEOUT_MS };
}
async function existing(path) {
  try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function executableOnPath(name, env, platform) {
  const extensions = platform === 'win32' ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  const names = extname(name) ? [name] : extensions.map(extension => `${name}${extension.toLowerCase()}`);
  for (const directory of (env.PATH || '').split(delimiter).filter(Boolean)) for (const candidate of names) {
    try { await access(join(directory, candidate), fsConstants.X_OK); return true; } catch {}
  }
  return false;
}
async function secureDirectory(path, platform) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (platform !== 'win32') await chmod(path, 0o700);
}
async function atomicWrite(path, bytes, platform) {
  const staged = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(staged, bytes, { flag: 'wx', mode: 0o600 });
  if (platform !== 'win32') await chmod(staged, 0o600);
  try { await rename(staged, path); } catch (error) { await rm(staged, { force: true }); throw error; }
}
async function atomicCreate(path, bytes, platform) {
  const staged = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(staged, bytes, { flag: 'wx', mode: 0o600 });
  if (platform !== 'win32') await chmod(staged, 0o600);
  try { await link(staged, path); } finally { await rm(staged, { force: true }); }
}
function result(plan) {
  return { mode: plan.apply ? 'apply' : 'dry-run', status: plan.status, sourcePath: plan.sourcePath,
    privatePath: plan.privatePath, backupPath: plan.backupPath, manifestPath: plan.manifestPath,
    adaptersPath: plan.adaptersPath, backendCount: plan.backendCount, adapterCount: plan.adapterCount,
    skippedAdapters: plan.skippedAdapters, sourceHash: plan.sourceHash };
}

export async function migrateConfig(options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const sourcePath = resolve(options.sourceConfig ?? resolve(env.COPILOT_HOME || join(home, '.copilot'), 'mcp-config.json'));
  const stateDir = resolve(options.stateDir ?? join(home, '.shared-mcp-gateway'));
  const privatePath = join(stateDir, 'backends.json');
  const port = options.port ?? 7319;
  const apply = options.apply === true;
  const useAdapters = options.agencyAdapters === true;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535');
  if (sourcePath === privatePath) throw new Error('Source config and private backend config must be different files');

  const sourceBytes = await readFile(sourcePath);
  let source;
  try { source = JSON.parse(sourceBytes.toString('utf8')); } catch { throw new Error(`Cannot parse source config ${sourcePath}: invalid JSON`); }
  await loadConfig(sourcePath);
  const { key, servers } = collection(source);
  const privateBytes = await existing(privatePath);
  const sourceHash = digest(sourceBytes);
  const backupDir = join(stateDir, 'backups', timestamp(options.now instanceof Date ? options.now : new Date()));
  const backupPath = join(backupDir, basename(sourcePath));
  const manifestPath = join(backupDir, 'rollback-manifest.json');
  const adaptersPath = useAdapters ? join(stateDir, 'agency-adapters.json') : null;
  const own = servers[SELF_NAME];
  if (own && !selfConnector(own)) throw new Error(`Source config reserves ${SELF_NAME} for a different command`);
  if (own && !own.disabled && Object.keys(servers).length !== 1) throw new Error('Source config mixes the gateway connector with additional server entries');

  if (own && !own.disabled) {
    const expectedConnector = connector({ privatePath, stateDir, port, adaptersPath });
    if (JSON.stringify(own) !== JSON.stringify(expectedConnector)) throw new Error('Existing gateway connector settings do not match the requested migration settings');
    if (!privateBytes) throw new Error('Source is already migrated but the private backend config is missing');
    let privateJson;
    try { privateJson = JSON.parse(privateBytes.toString('utf8')); } catch { throw new Error(`Existing private backend config is invalid JSON: ${privatePath}`); }
    await loadConfig(privatePath);
    const privateServers = collection(privateJson).servers;
    if (Object.values(privateServers).some(entry => !entry.disabled && selfConnector(entry))) throw new Error('Private backend config contains the gateway connector itself');
    const adapterIndex = own.args.indexOf('--adapters');
    return result({ apply, status: 'already-migrated', sourcePath, privatePath, backupPath: null, manifestPath: null,
      adaptersPath: adapterIndex >= 0 ? own.args[adapterIndex + 1] : null,
      backendCount: Object.values(privateServers).filter(entry => !entry.disabled).length,
      adapterCount: 0, skippedAdapters: [], sourceHash: digest(privateBytes) });
  }

  if (privateBytes) {
    let privateJson;
    try { privateJson = JSON.parse(privateBytes.toString('utf8')); } catch { throw new Error(`Existing private backend config is invalid JSON: ${privatePath}`); }
    if (!privateBytes.equals(sourceBytes)) throw new Error(`Refusing migration because existing private backend config differs: ${privatePath}`);
  }

  let adapterSubset = null;
  const skippedAdapters = [];
  if (useAdapters) {
    if (!(options.agencyAvailable ?? await executableOnPath('agency', env, platform))) throw new Error('Agency adapters requested, but the Agency executable is not available on this machine');
    const mapping = JSON.parse(await readFile(ADAPTER_MAPPING_PATH, 'utf8'));
    adapterSubset = {};
    for (const [name, builtin] of Object.entries(mapping)) {
      const entry = servers[name];
      if (!entry) { skippedAdapters.push({ name, reason: 'not present' }); continue; }
      if (entry.disabled) { skippedAdapters.push({ name, reason: 'disabled' }); continue; }
      if (!entry.url || entry.command) { skippedAdapters.push({ name, reason: 'not an HTTP backend' }); continue; }
      if (Object.values(entry.headers ?? {}).some(value => String(value).length > 0)) throw new Error(`Agency adapter ${name} would overwrite custom credential headers`);
      adapterSubset[name] = builtin;
    }
  }

  const replacement = { ...source, [key]: { [SELF_NAME]: connector({ privatePath, stateDir, port, adaptersPath }) } };
  const replacementBytes = Buffer.from(`${JSON.stringify(replacement, null, 2)}\n`);
  const manifest = { version: 1, sourcePath, privatePath, originalSha256: sourceHash,
    replacementSha256: digest(replacementBytes), backupLocation: backupPath };
  const plan = { apply, status: apply ? 'migrated' : 'planned', sourcePath, privatePath, backupPath, manifestPath,
    adaptersPath, backendCount: Object.entries(servers).filter(([name, entry]) => name !== SELF_NAME && !entry.disabled).length,
    adapterCount: Object.keys(adapterSubset ?? {}).length, skippedAdapters, sourceHash };
  if (!apply) return result(plan);

  if (await existing(backupPath) || await existing(manifestPath)) {
    const error = new Error(`Backup location already exists: ${backupDir}`);
    error.code = 'EEXIST';
    throw error;
  }
  await loadOrCreateToken(stateDir);
  await secureDirectory(backupDir, platform);
  await atomicCreate(backupPath, sourceBytes, platform);
  if (!privateBytes) await atomicWrite(privatePath, sourceBytes, platform);
  if (adapterSubset) await atomicWrite(adaptersPath, Buffer.from(`${JSON.stringify(adapterSubset, null, 2)}\n`), platform);
  await atomicCreate(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), platform);
  if (options.beforeSourceReplace) await options.beforeSourceReplace();
  const currentSourceBytes = await readFile(sourcePath);
  if (!currentSourceBytes.equals(sourceBytes)) throw new Error(`Source config changed during migration; refusing to overwrite ${sourcePath}`);
  try { await atomicWrite(sourcePath, replacementBytes, platform); }
  catch (error) { throw new Error(`Migration could not replace source config; the original remains at ${sourcePath} and ${backupPath}`, { cause: error }); }
  return result(plan);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--apply') { options.apply = true; continue; }
    if (flag === '--agency-adapters') { options.agencyAdapters = true; continue; }
    const value = argv[++index];
    if (!value || !['--source-config', '--state-dir', '--port'].includes(flag)) throw new Error('Usage: node tools/migrate-config.mjs [--apply] [--source-config PATH] [--state-dir PATH] [--port PORT] [--agency-adapters]');
    if (flag === '--source-config') options.sourceConfig = value;
    if (flag === '--state-dir') options.stateDir = value;
    if (flag === '--port') options.port = Number(value);
  }
  return options;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  migrateConfig(parseArgs(process.argv.slice(2))).then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => { process.stderr.write(`Migration failed: ${error.message}\n`); process.exitCode = 1; });
}


