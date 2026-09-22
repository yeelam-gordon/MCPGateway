import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { BackendRegistry } from './backend-registry.js';
import { loadConfig } from './config.js';
import { createGateway } from './gateway-server.js';
import { loadOrCreateToken } from './token.js';
import { applyAgencyAdapters } from './agency-adapters.js';

function parseArgs(argv) {
  const options = {
    config: resolve(homedir(), '.shared-mcp-gateway', 'backends.json'),
    port: 7319,
    stateDir: resolve(homedir(), '.shared-mcp-gateway'),
    adapters: null,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || !['--config', '--port', '--state-dir', '--adapters'].includes(flag)) {
      throw new Error('Usage: npm start -- [--config PATH] [--port PORT] [--state-dir PATH] [--adapters PATH]');
    }
    if (flag === '--config') options.config = resolve(value);
    if (flag === '--port') options.port = Number(value);
    if (flag === '--state-dir') options.stateDir = resolve(value);
    if (flag === '--adapters') options.adapters = resolve(value);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be an integer from 1 to 65535');
  return options;
}
const options = parseArgs(process.argv.slice(2));
const imported = await loadConfig(options.config);
const configs = options.adapters
  ? await applyAgencyAdapters(imported, options.adapters)
  : imported;
const { token, path: tokenPath } = await loadOrCreateToken(options.stateDir);
const gateway = createGateway({ registry: new BackendRegistry(configs), token, port: options.port }); await gateway.listen();
console.log(`Shared MCP gateway listening on http://127.0.0.1:${options.port}/mcp`); console.log(`Bearer token file: ${tokenPath}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await gateway.close();
  } catch (error) {
    console.error(`Gateway shutdown failed: ${error.message}`);
    process.exitCode = 1;
  }
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
