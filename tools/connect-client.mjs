import { access, lstat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--apply') { options.apply = true; continue; }
    if (flag === '--migrate') { options.migrate = true; continue; }
    if (!['--client', '--config', '--gateway-config'].includes(flag) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('Usage: node tools/connect-client.mjs --client NAME --config PATH [--gateway-config PATH] [--migrate] [--apply]');
    }
    const key = flag.slice(2);
    if (Object.hasOwn(options, key)) throw new Error(`Repeated option: ${flag}`);
    options[key] = argv[++index];
  }
  if (!options.client || !options.config) throw new Error('--client and --config are required; configuration locations must be selected explicitly');
  return options;
}

function samePath(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function argValue(args, flag) {
  const indexes = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === flag) indexes.push(index);
  if (indexes.length !== 1 || indexes[0] + 1 >= args.length) throw new Error(`Gateway connector has invalid ${flag} settings`);
  return args[indexes[0] + 1];
}

async function ownedRuntime(connector) {
  if (!connector || connector.disabled || typeof connector.command !== 'string' || !samePath(connector.command, process.execPath)
      || !Array.isArray(connector.args) || !connector.args.includes('--auto-start')) {
    throw new Error('Source configuration does not contain an owned shared-mcp-gateway connector');
  }
  const connectorPath = connector.args[0];
  if (!connectorPath || basename(connectorPath).toLowerCase() !== 'connector.mjs') {
    throw new Error('Source configuration does not contain an installed shared-mcp-gateway connector');
  }
  const privatePath = resolve(argValue(connector.args, '--config'));
  const stateDir = resolve(argValue(connector.args, '--state-dir'));
  const port = Number(argValue(connector.args, '--port'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Gateway connector has an invalid port');
  if (!samePath(privatePath, join(stateDir, 'backends.json'))) {
    throw new Error('Gateway connector private catalog does not belong to its selected state directory');
  }
  const resolvedConnector = resolve(connectorPath);
  const runtimePath = dirname(dirname(resolvedConnector));
  const expectedConnector = join(runtimePath, 'tools', 'connector.mjs');
  if (!samePath(resolvedConnector, expectedConnector)) {
    throw new Error('Gateway connector must be the canonical tools/connector.mjs within its selected runtime');
  }
  const details = await lstat(resolvedConnector);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error('Gateway connector must be a regular non-symlinked runtime file');
  }
  return { connectorPath: resolvedConnector, runtimePath };
}

async function stableImplementation(options) {
  const gatewayPath = resolve(options['gateway-config'] ?? join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'mcp-config.json'));
  let gateway;
  let gatewayBytes;
  try { gatewayBytes = await readFile(gatewayPath); gateway = JSON.parse(gatewayBytes.toString('utf8')); }
  catch { throw new Error('Cannot read a valid source gateway configuration; configure the gateway first'); }
  const connector = gateway.mcpServers?.['shared-mcp-gateway'] ?? gateway.servers?.['shared-mcp-gateway'];
  const selected = await ownedRuntime(connector);
  const trustedRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  try {
    const verifier = await import(pathToFileURL(join(trustedRoot, 'tools', 'plugin-setup.mjs')).href);
    if (!samePath(selected.runtimePath, trustedRoot)) {
      await verifier.verifyTrustedRuntimeSelection({ trustedRoot, runtimePath: selected.runtimePath });
    }
    await verifier.verifyTrustedClientDependencies({ trustedRoot, runtimePath: selected.runtimePath });
  } catch (error) {
    throw new Error('The selected gateway runtime is not trusted by this installed plugin payload. Run gateway setup with --apply to install or upgrade the stable runtime, then retry.', { cause: error });
  }
  const helperPath = join(selected.runtimePath, 'src', 'client-connect.js');
  try { await access(helperPath); }
  catch { throw new Error('The selected gateway runtime does not support cross-client setup. Run gateway setup with --apply to install or upgrade the stable runtime, then retry.'); }
  let module;
  try { module = await import(pathToFileURL(helperPath).href); }
  catch (error) {
    throw new Error('The selected gateway runtime cannot load cross-client support. Run gateway setup with --apply to repair or upgrade the stable runtime, then retry.', { cause: error });
  }
  if (typeof module.connectClient !== 'function') {
    throw new Error('The selected gateway runtime is missing its cross-client entry point. Run gateway setup with --apply to upgrade it, then retry.');
  }
  if (options.beforeRuntimeOperation) await options.beforeRuntimeOperation();
  return module.connectClient({ ...options, verifiedGatewayBytes: gatewayBytes, verifiedConnector: connector });
}

export function connectClient(options) {
  return stableImplementation(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve().then(() => connectClient(parseArgs(process.argv.slice(2))))
    .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => { process.stderr.write(`Client setup failed: ${error.message}\n`); process.exitCode = 1; });
}
