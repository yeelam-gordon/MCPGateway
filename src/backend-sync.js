import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { validateBackendConfig, validateConfig } from './config-schema.js';
import { loadOrCreateToken } from './token.js';

const SELF_NAME = 'shared-mcp-gateway';
const DEFAULT_LOCK_TIMEOUT_MS = 1_000;
const LOCK_POLL_MS = 25;

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const timestamp = date => date.toISOString().replaceAll(':', '-');

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collection(config, label) {
  if (!object(config)) throw new Error(`${label} must be a JSON object`);
  const keys = ['mcpServers', 'servers'].filter(key => Object.hasOwn(config, key));
  if (keys.length !== 1 || !object(config[keys[0]])) throw new Error(`${label} must contain exactly one of mcpServers or servers`);
  return { key: keys[0], servers: config[keys[0]] };
}

function parse(bytes, label, path) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(`Cannot parse ${label} ${path}: invalid JSON`); }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) {
    const defaultType = (typeof value.command === 'string' && (value.type === 'stdio' || value.type === 'local'))
      || (typeof value.url === 'string' && value.type === 'http');
    const keys = Object.keys(value).filter(key => (key !== 'disabled' || value[key] !== false) && (key !== 'type' || !defaultType));
    return `{${keys.sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function semanticEqual(left, right) {
  return canonical(left) === canonical(right);
}

export function classifyBackendMerge(sourceServers, backendServers) {
  const additions = [];
  const duplicates = [];
  const conflicts = [];
  for (const [name, entry] of Object.entries(sourceServers)) {
    if (!Object.hasOwn(backendServers, name)) additions.push(name);
    else if (semanticEqual(entry, backendServers[name])) duplicates.push(name);
    else conflicts.push(name);
  }
  additions.sort();
  duplicates.sort();
  conflicts.sort();
  const mergedServers = Object.fromEntries(Object.entries(backendServers));
  for (const name of additions) Object.defineProperty(mergedServers, name, {
    value: sourceServers[name], enumerable: true, configurable: true, writable: true
  });
  return { additions, duplicates, conflicts, mergedServers };
}

function powershellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function restoreCommand(backupPath, targetPath) {
  return `Copy-Item -LiteralPath ${powershellLiteral(backupPath)} -Destination ${powershellLiteral(targetPath)} -Force`;
}

async function secureDirectory(path, platform) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (platform !== 'win32') await chmod(path, 0o700);
}

async function atomicWrite(path, bytes, platform) {
  const staged = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(staged, bytes, { flag: 'wx', mode: 0o600 });
  if (platform !== 'win32') await chmod(staged, 0o600);
  try { await rename(staged, path); }
  catch (error) { await rm(staged, { force: true }); throw error; }
}

async function atomicCreate(path, bytes, platform) {
  const staged = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(staged, bytes, { flag: 'wx', mode: 0o600 });
  if (platform !== 'win32') await chmod(staged, 0o600);
  try { await link(staged, path); }
  finally { await rm(staged, { force: true }); }
}

async function acquireLock(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const nonce = randomUUID();
  do {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ nonce, pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      await handle.close();
      return { path, nonce };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Backend synchronization lock did not become available within ${timeoutMs}ms: ${path}`);
      await delay(Math.min(LOCK_POLL_MS, Math.max(1, deadline - Date.now())));
    }
  } while (true);
}

async function releaseLock(lock) {
  try {
    const current = JSON.parse(await readFile(lock.path, 'utf8'));
    if (current?.nonce === lock.nonce) await unlink(lock.path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function inspect(sourceBytes, privateBytes, sourcePath, privatePath) {
  const sourceConfig = parse(sourceBytes, 'source config', sourcePath);
  const privateConfig = parse(privateBytes, 'private backend config', privatePath);
  const source = collection(sourceConfig, 'Source config');
  const backend = collection(privateConfig, 'Private backend config');
  const connector = source.servers[SELF_NAME];
  if (!connector) throw new Error(`Source config no longer contains ${SELF_NAME}`);
  validateBackendConfig(connector, `gateway.${SELF_NAME}`, { allowUnknown: true });
  const sourceExtras = Object.fromEntries(Object.entries(source.servers).filter(([name]) => name !== SELF_NAME));
  validateConfig({ [source.key]: sourceExtras });
  const backendServers = validateConfig(privateConfig).servers;
  if (Object.hasOwn(backendServers, SELF_NAME)) throw new Error(`Private backend config must not contain ${SELF_NAME}; a gateway self-loop is blocked`);

  const { additions, duplicates, conflicts, mergedServers } = classifyBackendMerge(sourceExtras, backendServers);
  const replacementPrivate = { ...privateConfig, [backend.key]: mergedServers };
  const replacementSource = { ...sourceConfig, [source.key]: { [SELF_NAME]: connector } };
  validateConfig(replacementPrivate);
  validateBackendConfig(replacementSource[source.key][SELF_NAME], `gateway.${SELF_NAME}`, { allowUnknown: true });
  const replacementPrivateBytes = Buffer.from(`${JSON.stringify(replacementPrivate, null, 2)}\n`);
  const replacementSourceBytes = Buffer.from(`${JSON.stringify(replacementSource, null, 2)}\n`);
  const wouldChange = additions.length > 0 || duplicates.length > 0;
  return {
    additions, duplicates, conflicts, wouldChange, restartRequired: additions.length > 0 && conflicts.length === 0,
    sourceExtraCount: Object.keys(sourceExtras).length,
    privateBackendCount: Object.keys(backendServers).length,
    resultingBackendCount: Object.keys(mergedServers).length,
    replacementPrivateBytes, replacementSourceBytes
  };
}

function publicResult(plan, options = {}) {
  return {
    mode: options.apply ? 'apply' : 'preview',
    status: options.status ?? (options.apply ? (plan.wouldChange ? 'synchronized' : 'already-configured') : 'planned-sync'),
    synchronizationStatus: options.synchronizationStatus ?? (plan.wouldChange ? (options.apply ? 'synchronized' : 'planned') : 'no-changes'),
    sourcePath: options.sourcePath,
    privatePath: options.privatePath,
    addedAliases: plan.additions,
    identicalDuplicates: plan.duplicates,
    conflicts: plan.conflicts,
    warnings: plan.warnings ?? [],
    addedCount: plan.additions.length,
    identicalDuplicateCount: plan.duplicates.length,
    conflictCount: plan.conflicts.length,
    sourceExtraCount: plan.sourceExtraCount,
    privateBackendCount: plan.privateBackendCount,
    resultingBackendCount: plan.resultingBackendCount,
    backendCount: plan.resultingBackendCount,
    restartRequired: options.restartRequired ?? plan.restartRequired ?? (plan.wouldChange && plan.conflicts.length === 0),
    backupPath: options.backupPath ?? null,
    sourceBackupPath: options.sourceBackupPath ?? null,
    backendBackupPath: options.backendBackupPath ?? null,
    manifestPath: options.manifestPath ?? null,
    rollbackCommand: options.rollbackCommand ?? null,
    backendRollbackCommand: options.backendRollbackCommand ?? null,
    rollbackCommands: options.rollbackCommands ?? [],
    message: options.message ?? (plan.wouldChange ? 'Backend synchronization preview complete; no files were changed.' : 'Gateway setup is already configured; no synchronization changes are pending.')
  };
}

export async function synchronizeBackendTransaction(options) {
  const sourcePath = options.sourcePath;
  const privatePath = options.privatePath;
  const stateDir = options.stateDir;
  const apply = options.apply === true;
  const platform = options.platform ?? process.platform;
  const initialSourceBytes = await readFile(sourcePath);
  const initialPrivateBytes = await readFile(privatePath);
  if (options.expectedSourceBytes && !initialSourceBytes.equals(options.expectedSourceBytes)) throw new Error(`Source config changed after gateway inspection; refusing synchronization: ${sourcePath}`);
  if (options.expectedPrivateBytes && !initialPrivateBytes.equals(options.expectedPrivateBytes)) throw new Error(`Private backend config changed after gateway inspection; refusing synchronization: ${privatePath}`);
  const inspectPlan = options.inspectPlan ?? inspect;
  const initialPlan = inspectPlan(initialSourceBytes, initialPrivateBytes, sourcePath, privatePath);
  const preview = publicResult(initialPlan, { apply, sourcePath, privatePath });
  if (!apply) return preview;
  if (initialPlan.conflicts.length > 0) {
    const error = new Error(`Backend synchronization conflicts require manual resolution: ${initialPlan.conflicts.join(', ')}`);
    error.setupResult = { ...preview, status: 'conflict', synchronizationStatus: 'conflict', restartRequired: false,
      message: 'Backend synchronization was rejected because aliases have different configurations; both files are unchanged.' };
    throw error;
  }
  if (!initialPlan.wouldChange) return preview;

  await (options.tokenLoader ?? loadOrCreateToken)(stateDir);
  const lockPath = join(stateDir, 'backend-sync.lock');
  const lock = await acquireLock(lockPath, options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
  try {
    const sourceBytes = await readFile(sourcePath);
    const privateBytes = await readFile(privatePath);
    if (!sourceBytes.equals(initialSourceBytes) || !privateBytes.equals(initialPrivateBytes)) {
      const changed = !sourceBytes.equals(initialSourceBytes) ? 'Source config' : 'Private backend config';
      const error = new Error(`${changed} changed during synchronization preparation; refusing to adopt a different configuration`);
      error.setupResult = { ...preview, status: 'failed', synchronizationStatus: 'failed', restartRequired: false,
        message: 'Backend synchronization stopped before backups or writes because configuration changed during state preparation.' };
      throw error;
    }
    const plan = inspectPlan(sourceBytes, privateBytes, sourcePath, privatePath);
    if (plan.conflicts.length > 0) {
      const error = new Error(`Backend synchronization conflicts require manual resolution: ${plan.conflicts.join(', ')}`);
      error.setupResult = { ...publicResult(plan, { apply, sourcePath, privatePath }), status: 'conflict', synchronizationStatus: 'conflict', restartRequired: false };
      throw error;
    }
    if (!plan.wouldChange) return publicResult(plan, { apply, sourcePath, privatePath });

    const backupDir = join(stateDir, 'backups', `${timestamp(options.now instanceof Date ? options.now : new Date())}-${randomUUID()}`);
    const sourceBackupPath = join(backupDir, 'client-config.json');
    const backendBackupPath = join(backupDir, 'backends.json');
    const manifestPath = join(backupDir, 'rollback-manifest.json');
    const rollbackCommand = restoreCommand(sourceBackupPath, sourcePath);
    const backendRollbackCommand = restoreCommand(backendBackupPath, privatePath);
    const rollbackCommands = [backendRollbackCommand, rollbackCommand];
    await secureDirectory(backupDir, platform);
    await atomicCreate(sourceBackupPath, sourceBytes, platform);
    await atomicCreate(backendBackupPath, privateBytes, platform);
    const manifest = {
      version: 1,
      operation: options.operation ?? 'backend-sync',
      sourcePath,
      privatePath,
      files: {
        source: { path: sourcePath, backupPath: sourceBackupPath, originalSha256: digest(sourceBytes), replacementSha256: digest(plan.replacementSourceBytes) },
        backend: { path: privatePath, backupPath: backendBackupPath, originalSha256: digest(privateBytes), replacementSha256: digest(plan.replacementPrivateBytes) }
      }
    };
    await atomicCreate(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), platform);
    const base = { apply, sourcePath, privatePath, backupPath: sourceBackupPath, sourceBackupPath, backendBackupPath, manifestPath,
      rollbackCommand, backendRollbackCommand, rollbackCommands };

    try {
      if (options.beforeBackendWrite) await options.beforeBackendWrite();
      const [sourceBeforeBackend, backendBeforeBackend] = await Promise.all([readFile(sourcePath), readFile(privatePath)]);
      if (!sourceBeforeBackend.equals(sourceBytes)) throw new Error(`Source config changed during backend synchronization; refusing to overwrite ${sourcePath}`);
      if (!backendBeforeBackend.equals(privateBytes)) throw new Error(`Private backend config changed during backend synchronization; refusing to overwrite ${privatePath}`);
      await (options.backendWriter ?? atomicWrite)(privatePath, plan.replacementPrivateBytes, platform);
    } catch (error) {
      error.setupResult = publicResult(plan, { ...base, status: 'failed', synchronizationStatus: 'failed', restartRequired: false,
        message: 'Backend synchronization failed before publishing the merged backend catalog. Both original files can be restored from the reported backups.' });
      throw error;
    }

    try {
      if (options.beforeSourceWrite) await options.beforeSourceWrite();
      const [sourceBeforeSource, backendBeforeSource] = await Promise.all([readFile(sourcePath), readFile(privatePath)]);
      if (!sourceBeforeSource.equals(sourceBytes)) throw new Error(`Source config changed after the backend catalog was published; refusing to overwrite ${sourcePath}`);
      if (!backendBeforeSource.equals(plan.replacementPrivateBytes)) throw new Error(`Private backend config changed after publication; refusing to overwrite ${privatePath}`);
      await (options.sourceWriter ?? atomicWrite)(sourcePath, plan.replacementSourceBytes, platform);
    } catch (error) {
      error.setupResult = publicResult(plan, { ...base, status: 'partial-failure', synchronizationStatus: 'partial-failure', restartRequired: plan.restartRequired,
        message: 'The merged backend catalog was published, but the client config was not changed. Finish active work first, then manually restore both backups or rerun setup; no concurrent edits were overwritten.' });
      throw error;
    }

    return publicResult(plan, { ...base, status: 'synchronized', synchronizationStatus: 'synchronized', restartRequired: plan.restartRequired,
      message: plan.restartRequired
        ? 'Backend synchronization completed. Restart the gateway explicitly after active work finishes.'
        : 'Backend synchronization completed; duplicate native entries were removed without changing the gateway catalog.' });
  } finally {
    await releaseLock(lock);
  }
}

export function synchronizeBackends(options) {
  return synchronizeBackendTransaction({ ...options, inspectPlan: inspect });
}
