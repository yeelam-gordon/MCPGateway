import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { synchronizeBackendTransaction, classifyBackendMerge } from './backend-sync.js';
import { prepareClientMigration } from './client-config.js';
import { validateBackendConfig, validateConfig } from './config-schema.js';

const SELF_NAME = 'shared-mcp-gateway';

function argValue(args, flag) {
  const indexes = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === flag) indexes.push(index);
  if (indexes.length !== 1 || indexes[0] + 1 >= args.length) throw new Error(`Gateway connector has invalid ${flag} settings`);
  return args[indexes[0] + 1];
}

function samePath(left, right, platform) {
  const a = resolve(left);
  const b = resolve(right);
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function inspectGatewayConnector(connector, platform = process.platform) {
  validateBackendConfig(connector, `gateway.${SELF_NAME}`, { allowUnknown: true });
  const args = connector.args;
  const connectorPath = args[0];
  if (connector.disabled || !samePath(connector.command, process.execPath, platform)
      || !connectorPath || basename(connectorPath).toLowerCase() !== 'connector.mjs' || !args.includes('--auto-start')) {
    throw new Error('Source gateway configuration does not contain an owned shared-mcp-gateway connector');
  }
  const privatePath = resolve(argValue(args, '--config'));
  const stateDir = resolve(argValue(args, '--state-dir'));
  const port = Number(argValue(args, '--port'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Gateway connector has an invalid port');
  if (!samePath(privatePath, join(stateDir, 'backends.json'), platform)) {
    throw new Error('Gateway connector private catalog does not belong to its selected state directory');
  }
  return { connectorPath: resolve(connectorPath), privatePath, stateDir, port };
}

async function assertDifferentFiles(leftPath, rightPath, leftLabel, rightLabel, platform) {
  if (samePath(leftPath, rightPath, platform)) throw new Error(`${leftLabel} must differ from ${rightLabel}`);
  const [leftReal, rightReal, leftStat, rightStat] = await Promise.all([
    realpath(leftPath), realpath(rightPath), stat(leftPath), stat(rightPath)
  ]);
  if (samePath(leftReal, rightReal, platform)
      || (leftStat.ino !== 0 && leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino)) {
    throw new Error(`${leftLabel} must not resolve to the same file as ${rightLabel}`);
  }
}

function collection(config) {
  const keys = ['mcpServers', 'servers'].filter(key => Object.hasOwn(config, key));
  if (keys.length !== 1) throw new Error('Private backend config must contain exactly one of mcpServers or servers');
  return { key: keys[0], servers: config[keys[0]] };
}

export async function synchronizeClientMigration(options) {
  const platform = options.platform ?? process.platform;
  const configPath = resolve(options.configPath);
  const gatewayPath = resolve(options.gatewayPath);
  const owned = inspectGatewayConnector(options.connector, platform);
  await assertDifferentFiles(configPath, owned.privatePath, 'Client configuration', 'private backend catalog', platform);
  await assertDifferentFiles(configPath, gatewayPath, 'Client configuration', 'gateway source configuration', platform);
  const gatewayBytes = options.gatewayBytes ?? await readFile(gatewayPath);
  const gatewayCurrent = await readFile(gatewayPath);
  if (!gatewayCurrent.equals(gatewayBytes)) throw new Error('Gateway source configuration changed before client migration; refusing to continue');
  const initialClientBytes = await readFile(configPath);
  const initialPrivateBytes = await readFile(owned.privatePath);

  const inspectPlan = (sourceBytes, privateBytes) => {
    const prepared = prepareClientMigration({
      client: options.client, configPath, configText: sourceBytes.toString('utf8'), connector: options.connector
    });
    let privateConfig;
    try { privateConfig = JSON.parse(privateBytes.toString('utf8')); }
    catch { throw new Error(`Cannot parse private backend config ${owned.privatePath}: invalid JSON`); }
    const backend = collection(privateConfig);
    const backendServers = validateConfig(privateConfig).servers;
    if (Object.hasOwn(backendServers, SELF_NAME)) throw new Error('Private backend config contains a blocked gateway self-loop');
    const sourceServers = validateConfig(prepared.backends).servers;
    const { additions, duplicates, conflicts, mergedServers } = classifyBackendMerge(sourceServers, backendServers);
    const replacementPrivate = { ...privateConfig, [backend.key]: mergedServers };
    validateConfig(replacementPrivate);
    return {
      additions, duplicates, conflicts,
      warnings: prepared.warnings ?? [],
      wouldChange: prepared.changed || additions.length > 0 || duplicates.length > 0,
      restartRequired: additions.length > 0 && conflicts.length === 0,
      sourceExtraCount: Object.keys(sourceServers).length,
      privateBackendCount: Object.keys(backendServers).length,
      resultingBackendCount: Object.keys(mergedServers).length,
      replacementPrivateBytes: Buffer.from(`${JSON.stringify(replacementPrivate, null, 2)}\n`),
      replacementSourceBytes: Buffer.from(prepared.updatedText)
    };
  };

  const guardGateway = async hook => {
    if (hook) await hook();
    if (!(await readFile(gatewayPath)).equals(gatewayBytes)) {
      throw new Error('Gateway source configuration changed during client migration; refusing to continue');
    }
  };

  try {
    const result = await synchronizeBackendTransaction({
      sourcePath: configPath,
      privatePath: owned.privatePath,
      stateDir: owned.stateDir,
      apply: options.apply === true,
      platform,
      operation: 'connect-client-migration',
      inspectPlan,
      expectedSourceBytes: initialClientBytes,
      expectedPrivateBytes: initialPrivateBytes,
      tokenLoader: options.tokenLoader,
      lockTimeoutMs: options.lockTimeoutMs,
      backendWriter: options.backendWriter,
      sourceWriter: options.sourceWriter,
      beforeBackendWrite: () => guardGateway(options.beforeBackendWrite),
      beforeSourceWrite: () => guardGateway(options.beforeSourceWrite)
    });
    return { ...result, client: options.client, configPath, gatewayPath, connectorPath: owned.connectorPath,
      stateDir: owned.stateDir, port: owned.port };
  } catch (error) {
    if (error.setupResult) error.setupResult = { ...error.setupResult, client: options.client, configPath, gatewayPath,
      connectorPath: owned.connectorPath, stateDir: owned.stateDir, port: owned.port };
    throw error;
  }
}
