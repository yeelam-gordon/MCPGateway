import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CONNECTOR_REQUEST_TIMEOUT_MS, requestOptions } from '../src/request-budget.js';
import { isRequestTimeout } from '../src/time.js';

function parseArgs(argv) {
  const options = {
    port: 7319,
    stateDir: null,
    check: false,
    connectTimeoutMs: 15000,
    autoStart: false,
    configPath: null,
    adaptersPath: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--check') {
      options.check = true;
      continue;
    }
    if (flag === '--auto-start') {
      options.autoStart = true;
      continue;
    }
    const value = argv[++index];
    if (!value || !['--port', '--state-dir', '--connect-timeout-ms', '--config', '--adapters'].includes(flag)) {
      throw new Error('Usage: node tools/connector.mjs --state-dir DIR [--port PORT] [--check] [--auto-start --config PATH [--adapters PATH]]');
    }
    if (flag === '--port') options.port = Number(value);
    if (flag === '--state-dir') options.stateDir = resolve(value);
    if (flag === '--connect-timeout-ms') options.connectTimeoutMs = Number(value);
    if (flag === '--config') options.configPath = resolve(value);
    if (flag === '--adapters') options.adaptersPath = resolve(value);
  }
  if (!options.stateDir) throw new Error('--state-dir is required');
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be an integer from 1 to 65535');
  if (!Number.isInteger(options.connectTimeoutMs) || options.connectTimeoutMs < 1) throw new Error('--connect-timeout-ms must be a positive integer');
  if (options.autoStart && !options.configPath) throw new Error('--config is required with --auto-start');
  if (!options.autoStart && options.configPath) throw new Error('--config requires --auto-start');
  if (!options.autoStart && options.adaptersPath) throw new Error('--adapters requires --auto-start');
  return options;
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.autoStart) {
    const { ensureGateway } = await import('../src/ensure-gateway.js');
    await ensureGateway({
      configPath: options.configPath,
      adaptersPath: options.adaptersPath,
      stateDir: options.stateDir,
      port: options.port,
      startupTimeoutMs: 20000
    });
  }

  const tokenPath = resolve(options.stateDir, 'owner.token');
  const token = (await readFile(tokenPath, 'utf8')).trim();
  secretForRedaction = token;
  if (!token) throw new Error(`Gateway owner token is empty: ${tokenPath}`);

  const endpoint = new URL(`http://127.0.0.1:${options.port}/mcp`);
  const remoteTransport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  });
  const remote = new Client({ name: 'shared-mcp-gateway-stdio-connector', version: '0.1.0' });
  let connected = false;
  let closing;

  const safeMessage = error => String(error?.message ?? error).replaceAll(token, '[REDACTED]');
  const closeRemote = () => {
    if (closing) return closing;
    closing = (async () => {
      try {
        await withTimeout((async () => {
          if (connected) {
            try { await remoteTransport.terminateSession(); } catch (error) { process.stderr.write(`Connector session termination warning: ${safeMessage(error)}\n`); }
          }
          await remote.close();
        })(), 3000, 'connector shutdown exceeded 3 seconds');
      } catch (error) {
        process.stderr.write(`Connector shutdown warning: ${safeMessage(error)}\n`);
        try { await remoteTransport.close(); } catch (closeError) { process.stderr.write(`Connector transport close warning: ${safeMessage(closeError)}\n`); }
      }
    })();
    return closing;
  };

  try {
    await withTimeout(
      remote.connect(remoteTransport),
      options.connectTimeoutMs,
      `Gateway did not become ready within ${options.connectTimeoutMs}ms at ${endpoint}`
    );
    connected = true;

    if (options.check) {
      process.stdout.write(`Gateway ready at ${endpoint}\n`);
      return;
    }

    const server = new Server(
      { name: 'shared-mcp-gateway', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, (request, extra) => remote.listTools(
      request.params ?? {},
      requestOptions(CONNECTOR_REQUEST_TIMEOUT_MS, extra.signal)
    ));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const serverName = request.params?.arguments?.server ?? 'unknown backend';
      const toolName = request.params?.arguments?.tool ?? request.params?.name ?? 'unknown tool';
      try {
        return await remote.callTool(
          request.params,
          CallToolResultSchema,
          requestOptions(CONNECTOR_REQUEST_TIMEOUT_MS, extra.signal)
        );
      } catch (error) {
        const context = `${serverName}.${toolName}`;
        if (isRequestTimeout(error)) {
          throw new Error(`Gateway request timed out after ${CONNECTOR_REQUEST_TIMEOUT_MS}ms while calling ${context}; downstream outcome is unknown and the request was not retried`, { cause: error });
        }
        throw new Error(`Gateway request failed while calling ${context}: ${safeMessage(error)}`, { cause: error });
      }
    });

    const stdio = new StdioServerTransport();
    await server.connect(stdio);
    stdio.onclose = () => {
      void closeRemote().finally(() => { process.exitCode = 0; });
    };
    process.stdin.once('end', () => { void closeRemote().finally(() => { process.exitCode = 0; }); });
    process.once('SIGINT', () => { void closeRemote().finally(() => process.exit(0)); });
    process.once('SIGTERM', () => { void closeRemote().finally(() => process.exit(0)); });
  } finally {
    if (options.check || !connected) await closeRemote();
  }
}

let secretForRedaction = '';
run().catch(error => {
  const rawMessage = String(error?.message ?? error);
  const message = secretForRedaction ? rawMessage.replaceAll(secretForRedaction, '[REDACTED]') : rawMessage;
  process.stderr.write(`shared-mcp-gateway connector failed: ${message}\n`);
  process.exitCode = 1;
});
