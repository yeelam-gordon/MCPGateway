import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { execFile } from 'node:child_process';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { GatewayError } from './errors.js';
import { redactedMetadata, requiresExclusiveAccess as configRequiresExclusiveAccess } from './config.js';
import { downstreamTimeout, isRequestTimeout, withTimeout } from './time.js';
import { BACKEND_CALL_TIMEOUT_MS, requestOptions } from './request-budget.js';
import { VERSION } from './version.js';

async function firstExisting(paths) {
  for (const path of paths) { try { await access(path, constants.F_OK); return path; } catch {} }
  return null;
}

async function terminateWindowsProcessTree(pid, timeoutMs) {
  if (process.platform !== 'win32' || !pid) return;
  await new Promise(resolve => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: timeoutMs, windowsHide: true }, () => resolve());
  });
}

async function resolveLaunch(config, env) {
  const args = config.args ?? [];
  if (process.platform !== 'win32' || !/^(npx|npx\.cmd)$/i.test(config.command)) return { command: config.command, args };
  const candidates = [
    process.env.APPDATA && join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    ...(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean).map(path => join(path, 'node_modules', 'npm', 'bin', 'npx-cli.js'))
  ].filter(Boolean);
  const cli = await firstExisting(candidates);
  if (!cli) throw new GatewayError('transport_error', 'Unable to resolve npx-cli.js safely on Windows');
  return { command: process.execPath, args: [cli, ...args] };
}

function allows(config, toolName) {
  return config.tools === undefined || config.tools.includes('*') || config.tools.includes(toolName);
}

function catalogTimeout(name, milliseconds, cause) {
  return new GatewayError('timeout', `List tools for ${name} timed out after ${milliseconds}ms`, cause);
}

function hasAmbiguousTransportFailure(error) {
  for (let current = error; current; current = current.cause) {
    const message = String(current.message ?? '');
    if (/session not found/i.test(message)) return false;
    const code = String(current.code ?? '').toUpperCase();
    if (['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ENETRESET'].includes(code)) return true;
    if (/^UND_ERR_(?:SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|ABORTED)$/.test(code)) return true;
    if (/connection (?:was )?(?:closed|reset|aborted)|socket hang up|network (?:request )?aborted/i.test(message)) return true;
  }
  return false;
}

export class BackendRegistry {
  constructor(configs, options = {}) {
    this.configs = configs;
    this.entries = new Map();
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
    this.callTimeoutMs = options.callTimeoutMs ?? BACKEND_CALL_TIMEOUT_MS;
    this.closeTimeoutMs = options.closeTimeoutMs ?? 3_000;
    this.maxToolPages = options.maxToolPages ?? 100;
    this.maxTools = options.maxTools ?? 10_000;
    this.ajv7 = new Ajv({ allErrors: true, strict: false });
    this.ajv2020 = new Ajv2020({ allErrors: true, strict: false });
    this.validators = new WeakMap();
    this.stopping = false;
  }

  list() {
    return [...this.configs.values()].map(config => redactedMetadata(config, this.entries.get(config.name)?.state ?? 'idle'));
  }

  requireConfig(name) {
    const config = this.configs.get(name);
    if (!config) throw new GatewayError('unknown_server', `Unknown backend: ${name}`);
    return config;
  }

  requiresExclusiveAccess(name) {
    return configRequiresExclusiveAccess(this.requireConfig(name));
  }

  async connect(name) {
    if (this.stopping) throw new GatewayError('gateway_stopping', 'Gateway is shutting down');
    const config = this.requireConfig(name);
    const current = this.entries.get(name);
    if (current?.state === 'ready') return current;
    if (current?.connecting) return current.connecting;
    const entry = { state: 'connecting', client: null, transport: null, tools: null, discovery: null, connecting: null, closing: null, transportError: null, retireScheduled: null };
    this.entries.set(name, entry);
    entry.connecting = this.#connect(config, entry);
    return entry.connecting;
  }

  async #connect(config, entry) {
    const client = new Client({ name: 'shared-mcp-gateway', version: VERSION });
    entry.client = client;
    try {
      if (config.url) {
        entry.transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } });
      } else {
        const env = { ...process.env, ...(config.env ?? {}) };
        const launch = await resolveLaunch(config, env);
        entry.transport = new StdioClientTransport({ ...launch, cwd: config.cwd, env, stderr: 'pipe' });
        entry.transport.stderr?.on('data', () => {});
        entry.transport.stderr?.resume?.();
      }
      const scheduleRetire = () => {
        if (entry.state !== 'ready' || entry.retireScheduled) return;
        entry.retireScheduled = setImmediate(() => {
          entry.retireScheduled = null;
          if (entry.state === 'ready') void this.#retire(config.name, entry);
        });
        entry.retireScheduled.unref?.();
      };
      client.onclose = () => {
        if (!config.url) scheduleRetire();
      };
      client.onerror = error => {
        entry.transportError = error;
        if (!config.url) scheduleRetire();
      };
      await withTimeout(client.connect(entry.transport), this.connectTimeoutMs, `Connect to ${config.name}`);
      if (this.stopping || this.entries.get(config.name) !== entry || entry.state === 'closing') {
        await this.#retire(config.name, entry);
        throw new GatewayError('connect_cancelled', `Connect to ${config.name} was cancelled`);
      }
      entry.state = 'ready';
      entry.connecting = null;
      return entry;
    } catch (error) {
      await this.#retire(config.name, entry);
      const failure = `${String(error)} ${String(entry.transportError ?? '')}`;
      const status = error?.code ?? entry.transportError?.code;
      if (config.url && (status === 401 || /401|unauthori[sz]ed/i.test(failure))) throw new GatewayError('auth_required', `Backend ${config.name} requires authentication`, error);
      throw error instanceof GatewayError ? error : new GatewayError('connect_failed', `Backend ${config.name} failed to connect: ${error.message}`, error);
    }
  }

  #retire(name, entry) {
    if (this.entries.get(name) === entry) this.entries.delete(name);
    if (entry.discovery && !entry.discovery.settled) entry.discovery.controller.abort();
    if (entry.retireScheduled) {
      clearImmediate(entry.retireScheduled);
      entry.retireScheduled = null;
    }
    if (entry.closing) return entry.closing;
    entry.state = 'closing';
    entry.closing = Promise.resolve()
      .then(() => this.#closeOwned(entry.client, entry.transport))
      .finally(() => { entry.state = 'closed'; });
    entry.closing.catch(error => { entry.closeError = error; });
    return entry.closing;
  }

  async #listAllTools(name, entry, discovery) {
    const tools = [];
    const seenCursors = new Set();
    let cursor;
    for (let page = 0; page < this.maxToolPages; page += 1) {
      const remaining = discovery.deadline - Date.now();
      if (remaining <= 0) {
        discovery.timedOut = true;
        discovery.controller.abort();
        throw catalogTimeout(name, this.callTimeoutMs, new Error('Catalog discovery deadline exceeded'));
      }
      const options = requestOptions(page === 0 ? this.callTimeoutMs : remaining);
      Object.defineProperty(options, 'signal', { value: discovery.controller.signal });
      const listed = await entry.client.listTools(cursor ? { cursor } : undefined, options);
      tools.push(...listed.tools);
      if (tools.length > this.maxTools) throw new GatewayError('tool_limit_exceeded', `Backend ${name} returned more than ${this.maxTools} tools`);
      if (!listed.nextCursor) return tools;
      if (seenCursors.has(listed.nextCursor)) throw new GatewayError('pagination_cycle', `Backend ${name} repeated tool cursor ${listed.nextCursor}`);
      seenCursors.add(listed.nextCursor);
      cursor = listed.nextCursor;
    }
    throw new GatewayError('pagination_limit', `Backend ${name} exceeded ${this.maxToolPages} tool pages`);
  }

  #startDiscovery(name, config, entry) {
    const controller = new AbortController();
    const discovery = {
      controller,
      deadline: Date.now() + this.callTimeoutMs,
      timer: null,
      waiters: new Set(),
      settled: false,
      timedOut: false,
      promise: null
    };
    discovery.timer = setTimeout(() => {
      discovery.timedOut = true;
      controller.abort();
    }, this.callTimeoutMs);
    discovery.timer.unref?.();
    discovery.promise = (async () => {
      try {
        const listed = await this.#listAllTools(name, entry, discovery);
        if (this.entries.get(name) !== entry || entry.discovery !== discovery || entry.state !== 'ready') {
          throw new GatewayError('connect_cancelled', `Tool discovery for ${name} was cancelled`);
        }
        const tools = new Map(listed.filter(tool => allows(config, tool.name)).map(tool => [tool.name, tool]));
        entry.tools = tools;
        return tools;
      } catch (error) {
        if (discovery.timedOut || isRequestTimeout(error)) {
          throw error instanceof GatewayError && error.code === 'timeout'
            ? error
            : catalogTimeout(name, this.callTimeoutMs, error);
        }
        if (controller.signal.aborted) throw new GatewayError('cancelled', `Tool discovery for ${name} was cancelled`, error);
        await this.#retire(name, entry);
        throw error instanceof GatewayError ? error : new GatewayError('tool_discovery_failed', `Tool discovery failed for ${name}: ${error.message}`, error);
      } finally {
        clearTimeout(discovery.timer);
        discovery.settled = true;
        if (entry.discovery === discovery) entry.discovery = null;
      }
    })();
    discovery.promise.catch(() => {});
    entry.discovery = discovery;
    return discovery;
  }

  #awaitDiscovery(name, discovery, signal) {
    if (signal?.aborted) return Promise.reject(new GatewayError('cancelled', `Tool discovery for ${name} was cancelled`));
    const waiter = {};
    discovery.waiters.add(waiter);
    return new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', onAbort);
        discovery.waiters.delete(waiter);
      };
      const onAbort = () => {
        cleanup();
        if (!discovery.settled && discovery.waiters.size === 0) discovery.controller.abort();
        reject(new GatewayError('cancelled', `Tool discovery for ${name} was cancelled`));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      discovery.promise.then(
        tools => { cleanup(); resolve(tools); },
        error => { cleanup(); reject(error); }
      );
    });
  }

  async #tools(name, signal) {
    const config = this.requireConfig(name);
    const entry = await this.connect(name);
    if (entry.tools) return entry.tools;
    const discovery = entry.discovery ?? this.#startDiscovery(name, config, entry);
    return this.#awaitDiscovery(name, discovery, signal);
  }

  async searchTools(server, query = '', signal) {
    const names = server ? [server] : [...this.configs.keys()].filter(name => this.entries.get(name)?.state === 'ready');
    const tools = [];
    for (const name of names) for (const tool of (await this.#tools(name, signal)).values()) {
      if (!query || `${tool.name} ${tool.description ?? ''}`.toLowerCase().includes(query.toLowerCase())) {
        tools.push({ server: name, name: tool.name, description: tool.description ?? null, requiresExclusiveAccess: this.requiresExclusiveAccess(name) });
      }
    }
    return { tools, note: server ? null : 'Only already-initialized backends are searched when server is omitted.' };
  }

  async getTool(name, toolName, signal) {
    const tool = (await this.#tools(name, signal)).get(toolName);
    if (!tool) throw new GatewayError('tool_not_allowed', `Tool ${toolName} is unavailable or not allowed on ${name}`);
    return tool;
  }

  #validatorFor(tool, name, toolName) {
    const cached = this.validators.get(tool);
    if (cached) return cached;
    const schema = tool.inputSchema ?? { type: 'object' };
    const draft = typeof schema.$schema === 'string' ? schema.$schema : '';
    const ajv = draft.includes('2020-12') ? this.ajv2020 : this.ajv7;
    if (draft && !draft.includes('2020-12') && !draft.includes('draft-07')) {
      throw new GatewayError('schema_error', `Unsupported JSON Schema draft for ${name}.${toolName}: ${draft}`);
    }
    try {
      const validator = ajv.compile(schema);
      this.validators.set(tool, validator);
      return validator;
    } catch (error) {
      throw new GatewayError('schema_error', `Invalid input schema for ${name}.${toolName}: ${error.message}`, error);
    }
  }

  async callTool(name, toolName, args, signal) {
    const tool = await this.getTool(name, toolName, signal);
    const entry = await this.connect(name);
    const validate = this.#validatorFor(tool, name, toolName);
    if (!validate(args ?? {})) {
      throw new GatewayError('invalid_arguments', `Invalid arguments for ${name}.${toolName}: ${this.ajv7.errorsText(validate.errors, { separator: '; ' })}`);
    }
    try {
      return await entry.client.callTool(
        { name: toolName, arguments: args ?? {} },
        CallToolResultSchema,
        requestOptions(this.callTimeoutMs)
      );
    } catch (error) {
      if (isRequestTimeout(error)) throw downstreamTimeout(`Call ${name}.${toolName}`, this.callTimeoutMs, error);
      const failure = error instanceof GatewayError ? error : new GatewayError('call_failed', `Call ${name}.${toolName} failed: ${error.message}`, error);
      if (hasAmbiguousTransportFailure(error)) failure.outcomeUnknown = true;
      try { await this.#retire(name, entry); }
      catch (cleanupError) { failure.cleanupError = cleanupError; }
      throw failure;
    }
  }

  async #closeOwned(client, transport) {
    const ownedPid = transport?.pid;
    if (ownedPid && process.platform === 'win32') await terminateWindowsProcessTree(ownedPid, this.closeTimeoutMs);
    const close = client ? client.close() : transport?.close();
    if (close) await withTimeout(close, this.closeTimeoutMs, client ? 'Client close' : 'Transport close');
  }

  async close() {
    this.stopping = true;
    const entries = [...this.entries.entries()];
    this.entries.clear();
    await Promise.all(entries.map(([name, entry]) => this.#retire(name, entry)));
  }
}
