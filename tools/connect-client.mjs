import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

async function stableImplementation(options) {
  const gatewayPath = resolve(options['gateway-config'] ?? join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'mcp-config.json'));
  let gateway;
  try { gateway = JSON.parse(await readFile(gatewayPath, 'utf8')); }
  catch { throw new Error('Cannot read a valid source gateway configuration; configure the gateway first'); }
  const connector = gateway.mcpServers?.['shared-mcp-gateway'] ?? gateway.servers?.['shared-mcp-gateway'];
  const connectorPath = connector?.args?.[0];
  if (!connectorPath || basename(connectorPath).toLowerCase() !== 'connector.mjs') {
    throw new Error('Source configuration does not contain an installed shared-mcp-gateway connector');
  }
  const helperPath = join(dirname(dirname(resolve(connectorPath))), 'src', 'client-connect.js');
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
  return module.connectClient(options);
}

export function connectClient(options) {
  return stableImplementation(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve().then(() => connectClient(parseArgs(process.argv.slice(2))))
    .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => { process.stderr.write(`Client setup failed: ${error.message}\n`); process.exitCode = 1; });
}
