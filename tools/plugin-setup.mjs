import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, chmod, link, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF_NAME = 'shared-mcp-gateway';
const MIN_NODE_MAJOR = 24;
const CLIENT_REQUEST_TIMEOUT_MS = 210_000;
const SETUP_USAGE = 'Usage: node tools/plugin-setup.mjs [--apply] [--adopt-existing] [--source-config PATH] [--state-dir PATH] [--port PORT] [--agency-adapters]';
const STATIC_FILES = ['LICENSE', 'package.json', 'package-lock.json', 'tools/connector.mjs', 'tools/connect-client.mjs', 'tools/migrate-config.mjs'];
const STATIC_TREES = ['src'];
const JSON_TREES = ['adapters'];

async function exists(path) {
  try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function nodeMajor(version) {
  const major = Number(String(version).split('.')[0]);
  if (!Number.isInteger(major) || major < MIN_NODE_MAJOR) throw new Error(`Plugin setup requires Node.js >=${MIN_NODE_MAJOR}; found ${version}`);
}

function configCollection(config, sourcePath) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`Source config must be a JSON object: ${sourcePath}`);
  const keys = ['mcpServers', 'servers'].filter(key => Object.hasOwn(config, key));
  if (keys.length !== 1 || !config[keys[0]] || typeof config[keys[0]] !== 'object' || Array.isArray(config[keys[0]])) {
    throw new Error('Source config must contain exactly one of mcpServers or servers');
  }
  return { key: keys[0], servers: config[keys[0]] };
}

async function canonicalValidator() {
  const module = await import(`${pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'config-schema.js')).href}?pluginSetup=${Date.now()}`);
  return module;
}

async function readJson(path, label) {
  let bytes;
  try { bytes = await readFile(path); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} does not exist: ${path}`);
    throw error;
  }
  try { return { bytes, value: JSON.parse(bytes.toString('utf8')) }; }
  catch { throw new Error(`Cannot parse ${label.toLowerCase()} ${path}: invalid JSON`); }
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const timestamp = date => date.toISOString().replaceAll(':', '-');

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

function comparablePath(path, platform = process.platform) {
  const normalized = resolve(path);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePath(left, right, platform = process.platform) {
  return comparablePath(left, platform) === comparablePath(right, platform);
}

function isWithin(path, parent, platform = process.platform) {
  const rel = relative(comparablePath(parent, platform), comparablePath(path, platform));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function powershellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function recoveryGuidance({ sourcePath, backupPath = null, manifestPath = null, connectorPath = null, stateDir, port, message = null }) {
  const rollbackCommand = backupPath
    ? `Copy-Item -LiteralPath ${powershellLiteral(backupPath)} -Destination ${powershellLiteral(sourcePath)} -Force`
    : null;
  const runtimeHealthPowerShell = connectorPath
    ? `& ${powershellLiteral(process.execPath)} ${powershellLiteral(connectorPath)} --state-dir ${powershellLiteral(stateDir)} --port ${powershellLiteral(String(port))} --check`
    : null;
  return {
    outputVersion: 1,
    pluginInstallBehavior: 'Plugin installation only downloads the plugin; it does not rewrite MCP configuration or install runtime dependencies.',
    setupInvocation: '/mcp-gateway-setup performs the explicit backed-up MCP setup.',
    packageSetupInvocation: 'npm run setup -- --apply performs the same explicit setup from a repository checkout.',
    copilotMcpAddBehavior: 'copilot mcp add only registers a command; it does not migrate the existing MCP config or install this gateway runtime.',
    sourcePath,
    backupPath,
    manifestPath,
    rollbackCommand,
    message,
    recoveryPrompt: rollbackCommand
      ? `If the migrated MCP setup does not work, close Copilot CLI and restore the exact original config with: ${rollbackCommand}`
      : 'No migration backup was created; the source MCP config was not replaced.',
    restartNewCli: connectorPath
      ? 'Close this Copilot CLI session, start a new Copilot CLI session, then run the runtime health command.'
      : null,
    runtimeHealthPowerShell
  };
}

async function backupPaths(stateDir, sourcePath) {
  const root = join(stateDir, 'backups');
  if (!(await exists(root))) return new Set();
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(root, entry.name, basename(sourcePath));
    if (await exists(candidate)) paths.push(candidate);
  }
  return new Set(paths);
}

function argValue(args, flag) {
  const indexes = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === flag) indexes.push(index);
  if (indexes.length !== 1 || indexes[0] + 1 >= args.length) throw new Error(`Existing gateway connector has invalid ${flag} settings`);
  return args[indexes[0] + 1];
}

async function inspectExistingGateway(servers, requested) {
  const own = servers[SELF_NAME];
  if (!own) return null;
  const args = own && Array.isArray(own.args) ? own.args : [];
  const connectorPath = args[0];
  if (own.disabled || typeof own.command !== 'string' || !samePath(own.command, process.execPath, requested.platform) || !connectorPath || basename(connectorPath).toLowerCase() !== 'connector.mjs' || !args.includes('--auto-start')) {
    throw new Error(`Source config reserves ${SELF_NAME} for a different gateway command`);
  }
  const backendPath = resolve(argValue(args, '--config'));
  const entryStateDir = resolve(argValue(args, '--state-dir'));
  const entryPort = Number(argValue(args, '--port'));
  if (!samePath(backendPath, requested.privatePath, requested.platform) || !samePath(entryStateDir, requested.stateDir, requested.platform) || entryPort !== requested.port) {
    throw new Error('Existing gateway connector settings do not match the requested setup settings');
  }
  const adapterIndexes = args.map((value, index) => value === '--adapters' ? index : -1).filter(index => index >= 0);
  if (adapterIndexes.length > 1) throw new Error('Existing gateway connector has invalid --adapters settings');
  const adapterIndex = adapterIndexes[0] ?? -1;
  const hasAdapters = adapterIndex >= 0;
  if ((requested.agencyAdapters !== undefined && hasAdapters !== requested.agencyAdapters)
      || (hasAdapters && !args[adapterIndex + 1])) {
    throw new Error('Existing gateway connector adapter settings do not match the requested setup settings');
  }
  const backend = await readJson(backendPath, 'Existing private backend config');
  const validator = await canonicalValidator();
  validator.validateBackendConfig(own, `gateway.${SELF_NAME}`, { allowUnknown: true });
  const backendServers = validator.validateConfig(backend.value).servers;
  const adapterPath = hasAdapters ? resolve(args[adapterIndex + 1]) : null;
  const adapter = requested.adoptExisting && adapterPath ? await readJson(adapterPath, 'Existing adapter config') : null;
  if (adapter && (!adapter.value || typeof adapter.value !== 'object' || Array.isArray(adapter.value))) {
    throw new Error(`Existing adapter config must be a JSON object: ${adapterPath}`);
  }
  return {
    status: 'already-configured',
    migrationStatus: 'already-migrated',
    backendCount: Object.values(backendServers).filter(entry => !entry?.disabled).length,
    connectorPath: resolve(connectorPath),
    runtimePath: dirname(dirname(resolve(connectorPath))),
    privatePath: backendPath,
    entry: own,
    backendBytes: backend.bytes,
    adapterPath,
    adapterBytes: adapter?.bytes ?? null
  };
}

async function safeRuntimePath(root, relativePath, expectedType, label) {
  const rootPath = resolve(root);
  if (!isWithin(resolve(rootPath, relativePath), rootPath)) throw new Error(`${label} escapes its root: ${relativePath}`);
  let current = rootPath;
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    const details = await lstat(current);
    if (details.isSymbolicLink()) throw new Error(`${label} must not contain symlinks or junctions: ${current}`);
    const final = index === segments.length - 1;
    if (!final && !details.isDirectory()) throw new Error(`${label} path component is not a directory: ${current}`);
    if (final && expectedType === 'file' && !details.isFile()) throw new Error(`${label} is not a regular file: ${current}`);
    if (final && expectedType === 'directory' && !details.isDirectory()) throw new Error(`${label} is not a directory: ${current}`);
  }
  const [canonicalRoot, canonicalPath] = await Promise.all([realpath(rootPath), realpath(current)]);
  if (!isWithin(canonicalPath, canonicalRoot)) throw new Error(`${label} resolves outside its root: ${current}`);
  return current;
}

async function collectTree(root, directory, predicate = () => true) {
  const base = join(root, directory);
  const output = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      const childRelative = relative(root, child);
      const details = await lstat(child);
      if (details.isSymbolicLink()) throw new Error(`Plugin runtime source must not contain symlinks or junctions: ${child}`);
      if (details.isDirectory()) await walk(child);
      else if (details.isFile() && predicate(child)) output.push(childRelative);
      else if (!details.isFile()) throw new Error(`Plugin runtime source contains an unsupported filesystem entry: ${child}`);
    }
  }
  if (await exists(base)) {
    await safeRuntimePath(root, directory, 'directory', 'Plugin runtime source directory');
    await walk(base);
  }
  return output;
}

async function runtimeFiles(sourceRoot) {
  const files = [...STATIC_FILES];
  for (const tree of STATIC_TREES) files.push(...await collectTree(sourceRoot, tree));
  for (const tree of JSON_TREES) files.push(...await collectTree(sourceRoot, tree, path => path.toLowerCase().endsWith('.json')));
  const unique = [...new Set(files)].sort();
  for (const path of unique) {
    try { await safeRuntimePath(sourceRoot, path, 'file', 'Plugin runtime source file'); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Plugin runtime source is missing required file: ${path}`);
      throw error;
    }
  }
  return unique;
}

async function contentHash(sourceRoot, files) {
  const hash = createHash('sha256');
  for (const path of files) {
    const source = await safeRuntimePath(sourceRoot, path, 'file', 'Plugin runtime file');
    hash.update(path.split(sep).join('/')); hash.update('\0'); hash.update(await readFile(source)); hash.update('\0');
  }
  return hash.digest('hex');
}

async function copyRuntime(sourceRoot, destination, files) {
  for (const path of files) {
    const source = await safeRuntimePath(sourceRoot, path, 'file', 'Plugin runtime source file');
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(source), { flag: 'wx' });
  }
}

async function resolveNpmCli() {
  const require = createRequire(import.meta.url);
  const candidates = [];
  try { candidates.push(require.resolve('npm/bin/npm-cli.js')); } catch {}
  candidates.push(join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  candidates.push(resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error('Cannot locate npm-cli.js for the current Node.js installation');
}

async function installDependencies(runtimePath, options = {}) {
  const npmCli = options.npmCli ?? await resolveNpmCli();
  const args = [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: runtimePath, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    const timeout = setTimeout(() => child.kill(), options.npmTimeoutMs ?? 120_000);
    child.once('error', error => { clearTimeout(timeout); reject(new Error(`Dependency installation could not start: ${error.message}`, { cause: error })); });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else reject(new Error(signal ? `Dependency installation timed out or was terminated (${signal})` : `Dependency installation failed with exit code ${code}`));
    });
  });
}

async function verifyRuntimeDependencies(runtimePath) {
  const packageManifest = await readJson(await safeRuntimePath(runtimePath, 'package.json', 'file', 'Published runtime package manifest'), 'Runtime package manifest');
  const lockManifest = await readJson(await safeRuntimePath(runtimePath, 'package-lock.json', 'file', 'Published runtime package lock'), 'Runtime package lock');
  const dependencies = packageManifest.value?.dependencies ?? {};
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) throw new Error(`Published runtime dependencies are invalid: ${runtimePath}`);
  for (const name of Object.keys(dependencies).sort()) {
    const locked = lockManifest.value?.packages?.[`node_modules/${name}`];
    if (!locked?.version) throw new Error(`Published runtime package lock is missing dependency ${name}: ${runtimePath}`);
    const manifestRelative = join('node_modules', ...name.split('/'), 'package.json');
    let installedPath;
    try { installedPath = await safeRuntimePath(runtimePath, manifestRelative, 'file', `Published runtime dependency ${name}`); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Published runtime is missing required dependency ${name}: ${runtimePath}`);
      throw error;
    }
    const installed = await readJson(installedPath, `Runtime dependency ${name}`);
    if (installed.value?.name !== name || installed.value?.version !== locked.version) {
      throw new Error(`Published runtime dependency ${name} does not match package-lock.json: ${runtimePath}`);
    }
  }
}

async function verifyPublishedRuntime(runtimePath, plan) {
  const files = await runtimeFiles(runtimePath);
  if (files.length !== plan.files.length || files.some((file, index) => file !== plan.files[index])) {
    throw new Error(`Published runtime file manifest does not match the expected runtime: ${runtimePath}`);
  }
  const hash = await contentHash(runtimePath, files);
  if (hash !== plan.contentHash) throw new Error(`Published runtime content hash does not match its directory: ${runtimePath}`);
  await verifyRuntimeDependencies(runtimePath);
}

async function publishedRuntime(runtimeRoot, plan, allowDifferentRuntime = false) {
  if (!(await exists(runtimeRoot))) return null;
  for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.staging-')) continue;
    const path = join(runtimeRoot, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing a symlinked or junction runtime directory: ${path}`);
    if (!entry.isDirectory()) continue;
    const markerPath = join(path, '.plugin-runtime.json');
    if (!(await exists(markerPath))) throw new Error(`Refusing to overwrite an unowned runtime directory: ${path}`);
    await safeRuntimePath(path, '.plugin-runtime.json', 'file', 'Runtime marker');
    const marker = await readJson(markerPath, 'Runtime marker');
    if (marker.value?.version !== 1 || marker.value?.contentHash !== entry.name) throw new Error(`Runtime marker does not match its directory: ${path}`);
    if (entry.name === plan.contentHash) {
      await verifyPublishedRuntime(path, plan);
      return path;
    }
    if (!allowDifferentRuntime) throw new Error(`A different plugin runtime is already installed at ${path}; updates require a separate explicit operation`);
  }
  return null;
}

async function deployRuntime(plan, options) {
  const { publishRuntimeDirectory } = await import('../src/runtime-publish.js');
  const runtimeRoot = join(plan.stateDir, 'runtime');
  const existing = await publishedRuntime(runtimeRoot, plan, options.allowDifferentRuntime === true);
  if (existing) return existing;
  await mkdir(runtimeRoot, { recursive: true });
  const staging = join(runtimeRoot, `.staging-${plan.contentHash}-${process.pid}-${randomBytes(6).toString('hex')}`);
  const destination = join(runtimeRoot, plan.contentHash);
  await mkdir(staging, { recursive: false });
  try {
    await copyRuntime(plan.sourceRoot, staging, plan.files);
    await (options.npmRunner ?? installDependencies)(staging, options);
    await writeFile(join(staging, '.plugin-runtime.json'), `${JSON.stringify({ version: 1, contentHash: plan.contentHash }, null, 2)}\n`, { flag: 'wx' });
    try { await publishRuntimeDirectory(staging, destination); }
    catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
      const raced = await publishedRuntime(runtimeRoot, plan, options.allowDifferentRuntime === true);
      if (!raced) throw error;
      await rm(staging, { recursive: true, force: true });
      return raced;
    }
    return destination;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function loadTokenHelper(sourceRoot) {
  const module = await import(`${pathToFileURL(join(sourceRoot, 'src', 'token.js')).href}?pluginSetup=${Date.now()}`);
  if (typeof module.loadOrCreateToken !== 'function') throw new Error('Plugin token helper does not export loadOrCreateToken');
  return module.loadOrCreateToken;
}

async function loadMigration(runtimePath) {
  const module = await import(`${pathToFileURL(join(runtimePath, 'tools', 'migrate-config.mjs')).href}?pluginSetup=${Date.now()}`);
  if (typeof module.migrateConfig !== 'function') throw new Error('Copied migration module does not export migrateConfig');
  return module.migrateConfig;
}

export function parseSetupArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--apply') { options.apply = true; continue; }
    if (flag === '--adopt-existing') { options.adoptExisting = true; continue; }
    if (flag === '--agency-adapters') { options.agencyAdapters = true; continue; }
    if (!['--source-config', '--state-dir', '--port'].includes(flag)) throw new Error(SETUP_USAGE);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(SETUP_USAGE);
    if (flag === '--source-config') options.sourceConfig = value;
    if (flag === '--state-dir') options.stateDir = value;
    if (flag === '--port') options.port = Number(value);
  }
  return options;
}

async function adoptExistingGateway({ source, sourcePath, stateDir, port, existing, sourceRoot, files, contentHash, apply, options }) {
  const platform = options.platform ?? process.platform;
  const runtimePath = join(stateDir, 'runtime', contentHash);
  const connectorPath = join(runtimePath, 'tools', 'connector.mjs');
  const oldRuntimePath = existing.runtimePath;
  const copyAdapter = existing.adapterPath !== null && !isWithin(existing.adapterPath, stateDir, platform);
  const adaptersPath = copyAdapter ? join(stateDir, 'adopted-agency-adapters.json') : existing.adapterPath;
  if (copyAdapter && await exists(adaptersPath)) {
    const current = await readFile(adaptersPath);
    if (!current.equals(existing.adapterBytes)) throw new Error(`Refusing adoption because stable adapter config differs: ${adaptersPath}`);
  }

  const args = [...existing.entry.args];
  args[0] = connectorPath;
  if (copyAdapter) args[args.indexOf('--adapters') + 1] = adaptersPath;
  const { key } = configCollection(source.value, sourcePath);
  const replacementEntry = { ...existing.entry, command: process.execPath, args,
    timeout: existing.entry.timeout ?? CLIENT_REQUEST_TIMEOUT_MS };
  const replacement = { ...source.value, [key]: { [SELF_NAME]: replacementEntry } };
  const replacementBytes = Buffer.from(`${JSON.stringify(replacement, null, 2)}\n`);
  const backupDir = join(stateDir, 'backups', timestamp(options.now instanceof Date ? options.now : new Date()));
  const backupPath = join(backupDir, 'client-config.json');
  const backendBackupPath = join(backupDir, 'backends.json');
  const adapterBackupPath = existing.adapterPath ? join(backupDir, 'agency-adapters.json') : null;
  const manifestPath = join(backupDir, 'rollback-manifest.json');
  const guidance = recoveryGuidance({ sourcePath, stateDir, port,
    message: apply ? 'Gateway adoption is preparing an explicit backed-up client configuration switch.' : 'Adoption preview complete; no files were changed.' });
  const base = {
    ...guidance,
    mode: apply ? 'apply' : 'preview', status: apply ? 'installing' : 'planned-adoption', migrationStatus: 'not-applicable',
    sourceExists: true, sourcePath, stateDir, privatePath: existing.privatePath, runtimePath, oldRuntimePath,
    contentHash, runtimeFileCount: files.length, backendCount: existing.backendCount, adaptersPath,
    sourceAdapterPath: existing.adapterPath, adapterCopied: copyAdapter, restartRequired: true,
    backupPath: apply ? backupPath : null, sourceBackupPath: apply ? backupPath : null,
    backendBackupPath: apply ? backendBackupPath : null, adapterBackupPath: apply ? adapterBackupPath : null,
    manifestPath: apply ? manifestPath : null,
    rollbackCommand: apply ? `Copy-Item -LiteralPath ${powershellLiteral(backupPath)} -Destination ${powershellLiteral(sourcePath)} -Force` : null
  };
  if (!apply) return base;

  let deployedPath = null;
  try {
    deployedPath = await deployRuntime({ sourceRoot, stateDir, files, contentHash }, { ...options, allowDifferentRuntime: true });
    if (await exists(backupPath) || await exists(backendBackupPath) || (adapterBackupPath && await exists(adapterBackupPath)) || await exists(manifestPath)) {
      const error = new Error(`Backup location already exists: ${backupDir}`);
      error.code = 'EEXIST';
      throw error;
    }
    const currentSource = await readFile(sourcePath);
    const currentBackend = await readFile(existing.privatePath);
    const currentAdapter = existing.adapterPath ? await readFile(existing.adapterPath) : null;
    if (!currentSource.equals(source.bytes)) throw new Error(`Source config changed during adoption; refusing to overwrite ${sourcePath}`);
    if (!currentBackend.equals(existing.backendBytes)) throw new Error(`Backend config changed during adoption; refusing to continue: ${existing.privatePath}`);
    if (currentAdapter && !currentAdapter.equals(existing.adapterBytes)) throw new Error(`Adapter config changed during adoption; refusing to continue: ${existing.adapterPath}`);

    await secureDirectory(backupDir, platform);
    await atomicCreate(backupPath, source.bytes, platform);
    await atomicCreate(backendBackupPath, existing.backendBytes, platform);
    if (adapterBackupPath) await atomicCreate(adapterBackupPath, existing.adapterBytes, platform);
    if (copyAdapter && !(await exists(adaptersPath))) await atomicCreate(adaptersPath, existing.adapterBytes, platform);
    const manifest = {
      version: 1, operation: 'adopt-existing', sourcePath, privatePath: existing.privatePath,
      sourceAdapterPath: existing.adapterPath, adaptersPath, backupLocation: backupPath,
      files: {
        source: { path: sourcePath, backupPath, originalSha256: digest(source.bytes), replacementSha256: digest(replacementBytes) },
        backend: { path: existing.privatePath, backupPath: backendBackupPath, originalSha256: digest(existing.backendBytes) },
        ...(existing.adapterPath ? { adapter: { path: existing.adapterPath, backupPath: adapterBackupPath, originalSha256: digest(existing.adapterBytes) } } : {})
      }
    };
    await atomicCreate(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), platform);
    if (options.beforeSourceReplace) await options.beforeSourceReplace();
    const commitSource = await readFile(sourcePath);
    const commitBackend = await readFile(existing.privatePath);
    const commitAdapter = existing.adapterPath ? await readFile(existing.adapterPath) : null;
    const stableAdapter = copyAdapter ? await readFile(adaptersPath) : null;
    if (!commitSource.equals(source.bytes)) throw new Error(`Source config changed during adoption; refusing to overwrite ${sourcePath}`);
    if (!commitBackend.equals(existing.backendBytes)) throw new Error(`Backend config changed during adoption; refusing to continue: ${existing.privatePath}`);
    if (commitAdapter && !commitAdapter.equals(existing.adapterBytes)) throw new Error(`Adapter config changed during adoption; refusing to continue: ${existing.adapterPath}`);
    if (stableAdapter && !stableAdapter.equals(existing.adapterBytes)) throw new Error(`Stable adapter config changed during adoption; refusing to continue: ${adaptersPath}`);
    try { await (options.sourceWriter ?? atomicWrite)(sourcePath, replacementBytes, platform); }
    catch (error) { throw new Error(`Adoption could not replace source config; the original remains at ${sourcePath} and ${backupPath}`, { cause: error }); }
    return {
      ...base, status: 'adopted', runtimePath: deployedPath, connectorPath: join(deployedPath, 'tools', 'connector.mjs'),
      ...recoveryGuidance({ sourcePath, backupPath, manifestPath, connectorPath: join(deployedPath, 'tools', 'connector.mjs'), stateDir, port,
        message: 'Existing gateway runtime adopted successfully. Restart is required; activation remains the caller\'s responsibility.' }),
      sourceBackupPath: backupPath, backendBackupPath, adapterBackupPath, adaptersPath, oldRuntimePath,
      restartRequired: true,
      readinessCommand: { command: process.execPath, args: [join(deployedPath, 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(port), '--check'] }
    };
  } catch (error) {
    const backupExists = await exists(backupPath);
    const backendBackupExists = await exists(backendBackupPath);
    const adapterBackupExists = adapterBackupPath ? await exists(adapterBackupPath) : false;
    error.setupResult = {
      ...base, status: 'failed', runtimePath: deployedPath ?? runtimePath,
      ...recoveryGuidance({ sourcePath, backupPath: backupExists ? backupPath : null,
        manifestPath: await exists(manifestPath) ? manifestPath : null,
        connectorPath: deployedPath ? join(deployedPath, 'tools', 'connector.mjs') : null, stateDir, port,
        message: backupExists
          ? 'Gateway adoption failed after creating exact backups. The source config was not overwritten unless the replacement completed.'
          : 'Gateway adoption failed before creating backups. The source, backend, and adapter configs were unchanged.' }),
      sourceBackupPath: backupExists ? backupPath : null,
      backendBackupPath: backendBackupExists ? backendBackupPath : null,
      adapterBackupPath: adapterBackupExists ? adapterBackupPath : null
    };
    throw error;
  }
}

export async function pluginSetup(options = {}) {
  nodeMajor(options.nodeVersion ?? process.versions.node);
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const sourceRoot = resolve(options.sourceRoot ?? dirname(dirname(fileURLToPath(import.meta.url))));
  const sourcePath = resolve(options.sourceConfig ?? join(env.COPILOT_HOME || join(home, '.copilot'), 'mcp-config.json'));
  const stateDir = resolve(options.stateDir ?? join(home, '.shared-mcp-gateway'));
  const privatePath = join(stateDir, 'backends.json');
  const port = options.port ?? 7319;
  const apply = options.apply === true;
  const adoptExisting = options.adoptExisting === true;
  const agencyAdapters = options.agencyAdapters === true;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535');
  if (samePath(sourcePath, privatePath, options.platform ?? process.platform)) throw new Error('Source config and private backend config must be different files');

  const source = await readJson(sourcePath, 'Source config');
  const collection = configCollection(source.value, sourcePath);
  const { servers } = collection;
  const existing = await inspectExistingGateway(servers, {
    stateDir, privatePath, port, agencyAdapters: options.agencyAdapters, adoptExisting, platform: options.platform ?? process.platform
  });
  if (existing) {
    let synchronization;
    try {
      const { synchronizeBackends } = await import('../src/backend-sync.js');
      synchronization = await synchronizeBackends({
        sourcePath, privatePath: existing.privatePath, stateDir, apply: apply && !adoptExisting,
        expectedSourceBytes: source.bytes, expectedPrivateBytes: existing.backendBytes,
        platform: options.platform, now: options.now, tokenLoader: options.tokenLoader,
        lockTimeoutMs: options.lockTimeoutMs, backendWriter: options.backendWriter, sourceWriter: options.sourceWriter,
        beforeBackendWrite: options.beforeBackendWrite, beforeSourceWrite: options.beforeSourceWrite
      });
    } catch (error) {
      if (error.setupResult) {
        const failed = error.setupResult;
        error.setupResult = {
          ...failed,
          ...recoveryGuidance({ sourcePath, backupPath: failed.sourceBackupPath, manifestPath: failed.manifestPath,
            connectorPath: existing.connectorPath, stateDir, port, message: failed.message }),
          sourceExists: true, migrationStatus: existing.migrationStatus,
          connectorPath: existing.connectorPath, runtimePath: existing.runtimePath, privatePath: existing.privatePath,
          backendBackupPath: failed.backendBackupPath,
          backendRollbackCommand: failed.backendRollbackCommand,
          rollbackCommands: failed.rollbackCommands,
          readinessCommand: { command: process.execPath, args: [existing.connectorPath, '--state-dir', stateDir, '--port', String(port), '--check'] }
        };
      }
      throw error;
    }
    if (adoptExisting && synchronization.sourceExtraCount > 0) {
      const error = new Error('Existing gateway has pending native MCP entries; sync first then adopt');
      error.setupResult = { ...synchronization, status: 'adoption-blocked', migrationStatus: 'not-applicable',
        connectorPath: existing.connectorPath, runtimePath: existing.runtimePath,
        message: 'Adoption was not started. Run setup with --apply to synchronize pending backends, then rerun with --adopt-existing.' };
      throw error;
    }
    if (adoptExisting) {
      const files = await runtimeFiles(sourceRoot);
      const hash = await contentHash(sourceRoot, files);
      return adoptExistingGateway({ source, sourcePath, stateDir, port, existing, sourceRoot, files, contentHash: hash, apply, options });
    }
    const guidance = recoveryGuidance({ sourcePath, backupPath: synchronization.sourceBackupPath,
      manifestPath: synchronization.manifestPath, connectorPath: existing.connectorPath, stateDir, port,
      message: synchronization.message });
    return {
      ...synchronization, ...guidance, sourceExists: true, migrationStatus: existing.migrationStatus,
      connectorPath: existing.connectorPath, runtimePath: existing.runtimePath, privatePath: existing.privatePath,
      backendBackupPath: synchronization.backendBackupPath,
      backendRollbackCommand: synchronization.backendRollbackCommand,
      rollbackCommands: synchronization.rollbackCommands,
      readinessCommand: { command: process.execPath, args: [existing.connectorPath, '--state-dir', stateDir, '--port', String(port), '--check'] }
    };
  }

  const validator = await canonicalValidator();
  validator.validateConfig(source.value);

  if (await exists(privatePath)) {
    const privateBytes = await readFile(privatePath);
    if (!privateBytes.equals(source.bytes)) throw new Error(`Refusing setup because existing private backend config differs: ${privatePath}`);
  }

  const files = await runtimeFiles(sourceRoot);
  const hash = await contentHash(sourceRoot, files);
  const runtimePath = join(stateDir, 'runtime', hash);
  const base = {
    mode: apply ? 'apply' : 'preview', status: apply ? 'installing' : 'planned', migrationStatus: apply ? 'pending' : 'planned',
    sourceExists: true, sourcePath, stateDir, privatePath, runtimePath, contentHash: hash,
    runtimeFileCount: files.length, backendCount: Object.values(servers).filter(entry => !entry?.disabled).length,
    ...recoveryGuidance({ sourcePath, stateDir, port,
      message: apply ? 'Gateway setup is preparing an explicit backed-up migration.' : 'Preview complete; no files were changed.' })
  };
  if (!apply) return base;

  let deployedPath = null;
  let migrationStarted = false;
  const backupsBefore = await backupPaths(stateDir, sourcePath);
  try {
    const tokenLoader = options.tokenLoader ?? await loadTokenHelper(sourceRoot);
    await tokenLoader(stateDir);
    deployedPath = await deployRuntime({ sourceRoot, stateDir, files, contentHash: hash }, options);
    const migrateConfig = options.migrationRunner ?? await loadMigration(deployedPath);
    migrationStarted = true;
    const migrationOptions = { sourceConfig: sourcePath, stateDir, port, agencyAdapters, apply: true, env, home, platform: options.platform };
    if (options.beforeSourceReplace) migrationOptions.beforeSourceReplace = options.beforeSourceReplace;
    const migration = await migrateConfig(migrationOptions);
    const connectorPath = join(deployedPath, 'tools', 'connector.mjs');
    return {
      ...base, status: 'configured', migrationStatus: migration.status, runtimePath: deployedPath, migration,
      ...recoveryGuidance({ sourcePath, backupPath: migration.backupPath, manifestPath: migration.manifestPath,
        connectorPath, stateDir, port,
        message: 'Gateway setup completed successfully. Restart Copilot CLI, then run the reported runtime health command.' }),
      readinessCommand: { command: process.execPath, args: [connectorPath, '--state-dir', stateDir, '--port', String(port), '--check'] }
    };
  } catch (error) {
    const backupsAfter = migrationStarted ? await backupPaths(stateDir, sourcePath) : new Set();
    const backupPath = [...backupsAfter].filter(path => !backupsBefore.has(path)).sort().at(-1) ?? null;
    const possibleManifest = backupPath ? join(dirname(backupPath), 'rollback-manifest.json') : null;
    const manifestPath = possibleManifest && await exists(possibleManifest) ? possibleManifest : null;
    const connectorPath = deployedPath ? join(deployedPath, 'tools', 'connector.mjs') : null;
    const failureMessage = backupPath
      ? 'Gateway setup failed after creating an exact backup. No automatic rollback was attempted; close Copilot CLI and run rollbackCommand to restore the source config.'
      : 'Gateway setup failed before creating a backup. The source config was unchanged and no restore is needed.';
    error.setupResult = {
      ...base, status: 'failed', migrationStatus: migrationStarted ? 'failed' : 'not-started', migrationStarted,
      runtimePath: deployedPath ?? runtimePath,
      ...recoveryGuidance({ sourcePath, backupPath, manifestPath, connectorPath, stateDir, port, message: failureMessage })
    };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let cliOptions;
  try { cliOptions = parseSetupArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${JSON.stringify({ status: 'failed', error: error.message }, null, 2)}\n`); process.exitCode = 1; }
  if (cliOptions) pluginSetup(cliOptions)
    .then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`))
    .catch(error => {
      const home = homedir();
      const sourcePath = resolve(cliOptions.sourceConfig ?? join(process.env.COPILOT_HOME || join(home, '.copilot'), 'mcp-config.json'));
      const stateDir = resolve(cliOptions.stateDir ?? join(home, '.shared-mcp-gateway'));
      const details = error.setupResult ?? {
        status: 'failed', migrationStatus: 'not-started', migrationStarted: false,
        ...recoveryGuidance({ sourcePath, stateDir, port: cliOptions.port ?? 7319,
          message: 'Gateway setup failed before creating a backup. The source config was unchanged and no restore is needed.' })
      };
      process.stderr.write(`${JSON.stringify({ error: error.message, ...details }, null, 2)}\n`);
      process.exitCode = 1;
    });
}
