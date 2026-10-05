import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CONNECTOR_REQUEST_TIMEOUT_MS, requestOptions } from '../src/request-budget.js';
import { isRequestTimeout } from '../src/time.js';
import { VERSION } from '../src/version.js';

function parseArgs(argv) {
  const options = {
    port: 7319,
    stateDir: null,
    check: false,
    connectTimeoutMs: 15000,
    heartbeatIntervalMs: 30000,
    heartbeatTimeoutMs: 10000,
    autoStart: false,
    configPath: null,
    adaptersPath: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--check') { options.check = true; continue; }
    if (flag === '--auto-start') { options.autoStart = true; continue; }
    const value = argv[++index];
    if (!value || !['--port', '--state-dir', '--connect-timeout-ms', '--heartbeat-interval-ms', '--heartbeat-timeout-ms', '--config', '--adapters'].includes(flag)) {
      throw new Error('Usage: node tools/connector.mjs --state-dir DIR [--port PORT] [--check] [--heartbeat-interval-ms MS] [--heartbeat-timeout-ms MS] [--auto-start --config PATH [--adapters PATH]]');
    }
    if (flag === '--port') options.port = Number(value);
    if (flag === '--state-dir') options.stateDir = resolve(value);
    if (flag === '--connect-timeout-ms') options.connectTimeoutMs = Number(value);
    if (flag === '--heartbeat-interval-ms') options.heartbeatIntervalMs = Number(value);
    if (flag === '--heartbeat-timeout-ms') options.heartbeatTimeoutMs = Number(value);
    if (flag === '--config') options.configPath = resolve(value);
    if (flag === '--adapters') options.adaptersPath = resolve(value);
  }
  if (!options.stateDir) throw new Error('--state-dir is required');
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be an integer from 1 to 65535');
  if (!Number.isInteger(options.connectTimeoutMs) || options.connectTimeoutMs < 1) throw new Error('--connect-timeout-ms must be a positive integer');
  if (!Number.isInteger(options.heartbeatIntervalMs) || options.heartbeatIntervalMs < 1) throw new Error('--heartbeat-interval-ms must be a positive integer');
  if (!Number.isInteger(options.heartbeatTimeoutMs) || options.heartbeatTimeoutMs < 1 || options.heartbeatTimeoutMs > 10000) throw new Error('--heartbeat-timeout-ms must be an integer from 1 to 10000');
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

class GatewaySessionExpired extends Error {
  constructor() {
    super('Gateway HTTP session expired (invalid_session)');
    this.name = 'GatewaySessionExpired';
  }
}

function isExpiredSession(error) {
  return error instanceof GatewaySessionExpired || Boolean(error?.cause && isExpiredSession(error.cause));
}

class GatewayConnectionInterrupted extends Error {
  constructor(cause) {
    super('Gateway HTTP connection was interrupted', { cause });
    this.name = 'GatewayConnectionInterrupted';
  }
}

function isConnectionInterrupted(error) {
  return error instanceof GatewayConnectionInterrupted || Boolean(error?.cause && isConnectionInterrupted(error.cause));
}

function isConnectionFailure(error) {
  return ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(error?.code) ||
    Boolean(error?.cause && isConnectionFailure(error.cause)) ||
    Boolean(Array.isArray(error?.errors) && error.errors.some(isConnectionFailure));
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.autoStart) {
    const { ensureGateway } = await import('../src/ensure-gateway.js');
    await ensureGateway({ configPath: options.configPath, adaptersPath: options.adaptersPath, stateDir: options.stateDir, port: options.port });
  }

  const tokenPath = resolve(options.stateDir, 'owner.token');
  const token = (await readFile(tokenPath, 'utf8')).trim();
  secretForRedaction = token;
  if (!token) throw new Error(`Gateway owner token is empty: ${tokenPath}`);

  const endpoint = new URL(`http://127.0.0.1:${options.port}/mcp`);
  let remoteTransport;
  let remote;
  let recovery;
  const sessionControllers = new Set();
  const sessionClients = new Set();
  const clientSessions = new WeakMap();
  const closeClient = client => {
    const session = clientSessions.get(client);
    if (session.closing) return session.closing;
    session.closing = withTimeout(client.close(), 3000, 'Gateway client session close').finally(() => {
      session.controller.abort();
      sessionControllers.delete(session.controller);
      sessionClients.delete(client);
    });
    return session.closing;
  };
  const retireClient = client => {
    const session = clientSessions.get(client);
    if (session.retiring && session.active === 0) {
      void closeClient(client).catch(error => {
        process.stderr.write(`Expired gateway session cleanup warning: ${safeMessage(error)}\n`);
      });
    }
  };
  const invokeClient = async (client, operation) => {
    const session = clientSessions.get(client);
    session.active += 1;
    try { return await operation(client); }
    finally { session.active -= 1; retireClient(client); }
  };
  const connectRemote = async () => {
    const controller = new AbortController();
    sessionControllers.add(controller);
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (url, init = {}) => {
        let response;
        try {
          response = await fetch(url, { ...init, redirect: 'error',
            signal: AbortSignal.any([controller.signal, init.signal, AbortSignal.timeout(CONNECTOR_REQUEST_TIMEOUT_MS)].filter(Boolean)) });
        } catch (error) {
          if (!controller.signal.aborted && !init.signal?.aborted && isConnectionFailure(error)) {
            throw new GatewayConnectionInterrupted(error);
          }
          throw error;
        }
        if ([400, 404].includes(response.status) && response.headers.get('content-type')?.includes('application/json')) {
          let body;
          try { body = await response.clone().json(); } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
          }
          if (body?.error === 'invalid_session') {
            await response.body?.cancel();
            throw new GatewaySessionExpired();
          }
        }
        return response;
      }
    });
    const client = new Client({ name: 'shared-mcp-gateway-stdio-connector', version: VERSION });
    clientSessions.set(client, { controller, active: 0, retiring: false, closing: null });
    sessionClients.add(client);
    try {
      await withTimeout(client.connect(transport), options.connectTimeoutMs,
        `Gateway did not become ready within ${options.connectTimeoutMs}ms at ${endpoint}`);
      if (closing) throw new Error('Connector is shutting down');
      remote = client;
      remoteTransport = transport;
    } catch (error) {
      controller.abort();
      await closeClient(client).catch(() => {});
      throw error;
    } finally {
      if (controller.signal.aborted) sessionControllers.delete(controller);
    }
  };
  const recoverSession = async failedClient => {
    if (recovery) return recovery;
    if (remote !== failedClient) return;
    if (closing) throw new Error('Connector is shutting down');
    const operation = (async () => {
      if (options.autoStart) {
        const { ensureGateway } = await import('../src/ensure-gateway.js');
        await ensureGateway({ configPath: options.configPath, adaptersPath: options.adaptersPath,
          stateDir: options.stateDir, port: options.port });
      }
      await connectRemote();
      clientSessions.get(failedClient).retiring = true;
      retireClient(failedClient);
      process.stderr.write('Connector rebuilt an expired or interrupted gateway HTTP session; no downstream tool or ownership operation was replayed.\n');
    })();
    recovery = operation;
    try { await operation; }
    finally { if (recovery === operation) recovery = undefined; }
  };
  const invokeRemote = async (operation, retryDiscovery, signal) => {
    if (recovery) await recovery;
    const client = remote;
    try { return await invokeClient(client, operation); }
    catch (error) {
      if (closing || signal?.aborted || isRequestTimeout(error)) throw error;
      if (!isExpiredSession(error)) {
        if (isConnectionInterrupted(error) || isConnectionFailure(error)) {
          if (retryDiscovery) {
            await recoverSession(client);
            return invokeClient(remote, operation);
          }
          throw new Error('Gateway connection was interrupted; downstream outcome is unknown and the request was not retried. Review the previous workflow before continuing.', { cause: error });
        }
        throw error;
      }
      await recoverSession(client);
      if (!retryDiscovery) {
        throw new Error('Gateway HTTP session was lost; this request was rejected before dispatch and was not replayed. Previous workflow ownership may be lost; claim the server again before continuing.', { cause: error });
      }
      return invokeClient(remote, operation);
    }
  };
  let connected = false;
  let closing;
  let heartbeatTimer;
  let heartbeatStopped = false;
  let heartbeatFailures = 0;
  let localServer;

  const safeMessage = error => String(error?.message ?? error).replaceAll(token, '[REDACTED]');
  const stopHeartbeat = () => { heartbeatStopped = true; clearTimeout(heartbeatTimer); };
  const closeRemote = () => {
    if (closing) return closing;
    stopHeartbeat();
    closing = (async () => {
      try {
        await withTimeout((async () => {
          if (connected) {
            try { await remoteTransport.terminateSession(); } catch (error) { process.stderr.write(`Connector session termination warning: ${safeMessage(error)}\n`); }
          }
          await Promise.all([...sessionClients].map(client => closeClient(client)));
        })(), 3000, 'connector shutdown exceeded 3 seconds');
      } catch (error) {
        process.stderr.write(`Connector shutdown warning: ${safeMessage(error)}\n`);
        try { await remoteTransport.close(); } catch (closeError) { process.stderr.write(`Connector transport close warning: ${safeMessage(closeError)}\n`); }
      } finally {
        for (const controller of sessionControllers) controller.abort();
        sessionControllers.clear();
      }
    })();
    return closing;
  };
  const heartbeat = async () => {
    if (heartbeatStopped) return;
    try {
      await invokeRemote(client => client.callTool(
        { name: 'list_servers', arguments: {} },
        CallToolResultSchema,
        requestOptions(options.heartbeatTimeoutMs)
      ), true);
      heartbeatFailures = 0;
    } catch (error) {
      heartbeatFailures += 1;
      if (heartbeatFailures >= 2) {
        stopHeartbeat();
        process.stderr.write(`Connector heartbeat failed twice; closing transport: ${safeMessage(error)}\n`);
        process.exitCode = 1;
        await Promise.allSettled([localServer?.close(), closeRemote()]);
        return;
      }
    }
    if (!heartbeatStopped) {
      heartbeatTimer = setTimeout(heartbeat, options.heartbeatIntervalMs);
      heartbeatTimer.unref?.();
    }
  };

  try {
    await connectRemote();
    connected = true;

    if (options.check) {
      process.stdout.write(`Gateway ready at ${endpoint}\n`);
      return;
    }

    const server = new Server({ name: 'shared-mcp-gateway', version: VERSION }, { capabilities: { tools: {} } });
    localServer = server;
    server.setRequestHandler(ListToolsRequestSchema, (request, extra) => invokeRemote(
      client => client.listTools(request.params ?? {}, requestOptions(CONNECTOR_REQUEST_TIMEOUT_MS, extra.signal)), true, extra.signal));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const serverName = request.params?.arguments?.server ?? 'gateway';
      const toolName = request.params?.arguments?.tool ?? request.params?.name ?? 'unknown tool';
      try {
        const discovery = ['list_servers', 'search_tools', 'get_tool_schema'].includes(request.params.name);
        return await invokeRemote(client => client.callTool(request.params, CallToolResultSchema,
          requestOptions(CONNECTOR_REQUEST_TIMEOUT_MS, extra.signal)), discovery, extra.signal);
      } catch (error) {
        const context = `${serverName}.${toolName}`;
        if (isRequestTimeout(error)) throw new Error(`Gateway request timed out after ${CONNECTOR_REQUEST_TIMEOUT_MS}ms while calling ${context}; downstream outcome is unknown and the request was not retried`, { cause: error });
        const status = Number.isInteger(error?.code) && error.code >= 100 && error.code <= 599 ? ` [HTTP ${error.code}]` : '';
        const detail = (safeMessage(error) || `${error?.name ?? 'Error'}${error?.code === undefined ? '' : ` (${error.code})`}`) + status;
        throw new Error(`Gateway request failed while calling ${context}: ${detail}`, { cause: error });
      }
    });

    const stdio = new StdioServerTransport();
    await server.connect(stdio);
    stdio.onclose = () => { void closeRemote().finally(() => { if (process.exitCode === undefined) process.exitCode = 0; }); };
    process.stdin.once('end', () => { void closeRemote().finally(() => { if (process.exitCode === undefined) process.exitCode = 0; }); });
    process.once('SIGINT', () => { void closeRemote().finally(() => process.exit(0)); });
    process.once('SIGTERM', () => { void closeRemote().finally(() => process.exit(0)); });
    heartbeatTimer = setTimeout(heartbeat, options.heartbeatIntervalMs);
    heartbeatTimer.unref?.();
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
