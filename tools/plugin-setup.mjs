import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF_NAME = 'shared-mcp-gateway';
const MIN_NODE_MAJOR = 24;
const SETUP_USAGE = 'Usage: node tools/plugin-setup.mjs [--apply] [--source-config PATH] [--state-dir PATH] [--port PORT] [--agency-adapters]';
const STATIC_FILES = ['LICENSE', 'package.json', 'package-lock.json', 'tools/connector.mjs', 'tools/migrate-config.mjs'];
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

async function readJson(path, label) {
  let bytes;
  try { bytes = await readFile(path); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} does not exist: ${path}`);
    throw error;
  }
  try { return { bytes, value: JSON.parse(bytes.toString('utf8')) }; }
  catch { throw new Error(`Cannot parse ${label.toLowerCase()} ${path}: invalid JSON`); }
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
  if (Object.keys(servers).length !== 1) throw new Error('Source config mixes the gateway connector with additional server entries');
  const args = own && Array.isArray(own.args) ? own.args : [];
  const connectorPath = args[0];
  if (own.disabled || typeof own.command !== 'string' || resolve(own.command) !== resolve(process.execPath) || !connectorPath || basename(connectorPath).toLowerCase() !== 'connector.mjs' || !args.includes('--auto-start')) {
    throw new Error(`Source config reserves ${SELF_NAME} for a different gateway command`);
  }
  const backendPath = resolve(argValue(args, '--config'));
  const entryStateDir = resolve(argValue(args, '--state-dir'));
  const entryPort = Number(argValue(args, '--port'));
  if (backendPath !== requested.privatePath || entryStateDir !== requested.stateDir || entryPort !== requested.port) {
    throw new Error('Existing gateway connector settings do not match the requested setup settings');
  }
  const adapterIndex = args.indexOf('--adapters');
  const hasAdapters = adapterIndex >= 0;
  if ((requested.agencyAdapters !== undefined && hasAdapters !== requested.agencyAdapters)
      || (hasAdapters && !args[adapterIndex + 1])) {
    throw new Error('Existing gateway connector adapter settings do not match the requested setup settings');
  }
  const backend = await readJson(backendPath, 'Existing private backend config');
  const backendServers = configCollection(backend.value, backendPath).servers;
  return {
    status: 'already-configured',
    migrationStatus: 'already-migrated',
    backendCount: Object.values(backendServers).filter(entry => !entry?.disabled).length,
    connectorPath: resolve(connectorPath),
    runtimePath: dirname(dirname(resolve(connectorPath))),
    privatePath: backendPath
  };
}

async function collectTree(root, directory, predicate = () => true) {
  const base = join(root, directory);
  const output = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && predicate(child)) output.push(relative(root, child));
    }
  }
  if (await exists(base)) await walk(base);
  return output;
}

async function runtimeFiles(sourceRoot) {
  const files = [...STATIC_FILES];
  for (const tree of STATIC_TREES) files.push(...await collectTree(sourceRoot, tree));
  for (const tree of JSON_TREES) files.push(...await collectTree(sourceRoot, tree, path => path.toLowerCase().endsWith('.json')));
  const unique = [...new Set(files)].sort();
  for (const path of unique) if (!(await exists(join(sourceRoot, path)))) throw new Error(`Plugin runtime source is missing required file: ${path}`);
  return unique;
}

async function contentHash(sourceRoot, files) {
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(path.split(sep).join('/')); hash.update('\0'); hash.update(await readFile(join(sourceRoot, path))); hash.update('\0');
  }
  return hash.digest('hex');
}

async function copyRuntime(sourceRoot, destination, files) {
  for (const path of files) {
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(sourceRoot, path), target, { force: false, errorOnExist: true });
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

async function publishedRuntime(runtimeRoot, hash) {
  if (!(await exists(runtimeRoot))) return null;
  for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.staging-')) continue;
    const path = join(runtimeRoot, entry.name);
    const markerPath = join(path, '.plugin-runtime.json');
    if (!(await exists(markerPath))) throw new Error(`Refusing to overwrite an unowned runtime directory: ${path}`);
    const marker = await readJson(markerPath, 'Runtime marker');
    if (marker.value?.contentHash !== entry.name) throw new Error(`Runtime marker does not match its directory: ${path}`);
    if (entry.name !== hash) throw new Error(`A different plugin runtime is already installed at ${path}; updates require a separate explicit operation`);
    return path;
  }
  return null;
}

async function deployRuntime(plan, options) {
  const runtimeRoot = join(plan.stateDir, 'runtime');
  const existing = await publishedRuntime(runtimeRoot, plan.contentHash);
  if (existing) return existing;
  await mkdir(runtimeRoot, { recursive: true });
  const staging = join(runtimeRoot, `.staging-${plan.contentHash}-${process.pid}-${randomBytes(6).toString('hex')}`);
  const destination = join(runtimeRoot, plan.contentHash);
  await mkdir(staging, { recursive: false });
  try {
    await copyRuntime(plan.sourceRoot, staging, plan.files);
    await (options.npmRunner ?? installDependencies)(staging, options);
    await writeFile(join(staging, '.plugin-runtime.json'), `${JSON.stringify({ version: 1, contentHash: plan.contentHash }, null, 2)}\n`, { flag: 'wx' });
    try { await rename(staging, destination); }
    catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
      const raced = await publishedRuntime(runtimeRoot, plan.contentHash);
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
  const agencyAdapters = options.agencyAdapters === true;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535');
  if (sourcePath === privatePath) throw new Error('Source config and private backend config must be different files');

  const source = await readJson(sourcePath, 'Source config');
  const { servers } = configCollection(source.value, sourcePath);
  const existing = await inspectExistingGateway(servers, {
    stateDir, privatePath, port, agencyAdapters: options.agencyAdapters
  });
  if (existing) return {
    mode: apply ? 'apply' : 'preview', sourceExists: true, sourcePath, stateDir, ...existing,
    ...recoveryGuidance({ sourcePath, connectorPath: existing.connectorPath, stateDir, port,
      message: 'Gateway setup is already configured; existing configuration and credentials were not overwritten.' })
  };

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
