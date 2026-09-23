import { randomUUID, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import express from 'express';
import { errorResult } from './errors.js';
import { LeaseManager } from './lease-manager.js';
import { withTimeout } from './time.js';
import { VERSION } from './version.js';

const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
function tokenMatches(actual, expected) { const left = Buffer.from(actual); const right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right); }

export function createGateway({
  registry,
  token,
  host = '127.0.0.1',
  port = 7319,
  bodyLimit = '1mb',
  sessionIdleTimeoutMs = 5 * 60 * 1000,
  sessionSweepIntervalMs = Math.min(30_000, Math.max(10, Math.floor(sessionIdleTimeoutMs / 2)))
}) {
  if (!Number.isFinite(sessionIdleTimeoutMs) || sessionIdleTimeoutMs <= 0) throw new TypeError('sessionIdleTimeoutMs must be positive');
  if (!Number.isFinite(sessionSweepIntervalMs) || sessionSweepIntervalMs <= 0 || sessionSweepIntervalMs > 30_000) throw new TypeError('sessionSweepIntervalMs must be positive and at most 30000');
  let allowedHosts = port === 0 ? null : new Set([`${host}:${port}`, `localhost:${port}`]);
  const app = createMcpExpressApp({ host, allowedHosts: undefined }); const sessions = new Map(); const lease = new LeaseManager(); let listener; let sweepTimer;
  app.use((request, response, next) => {
    if (allowedHosts && (!request.headers.host || !allowedHosts.has(request.headers.host))) return response.status(403).json({ error: 'host_rejected' });
    const actualPort = listener?.address()?.port ?? port;
    const origins = new Set([`http://${host}`, `http://${host}:${actualPort}`, 'http://localhost', `http://localhost:${actualPort}`]);
    if (request.headers.origin && !origins.has(request.headers.origin)) return response.status(403).json({ error: 'origin_rejected' });
    const authorization = request.headers.authorization ?? '';
    if (!authorization.startsWith('Bearer ') || !tokenMatches(authorization.slice(7), token)) return response.status(401).json({ error: 'unauthorized' });
    next();
  });
  app.use('/mcp', express.json({ limit: bodyLimit }));

  function disconnectSession(session) {
    if (session.disconnected) return;
    session.disconnected = true;
    if (session.transport.sessionId) sessions.delete(session.transport.sessionId);
    lease.disconnect(session.clientId);
  }

  async function expireSession(session) {
    if (session.expiring || session.disconnected || session.activeOperations > 0) return;
    session.expiring = true;
    disconnectSession(session);
    await withTimeout(session.transport.close(), 3000, 'Expired gateway session close').catch(() => {});
  }

  async function createSession() {
    const clientId = randomUUID();
    const session = { clientId, server: null, transport: null, lastActivityAt: Date.now(), activeOperations: 0, disconnected: false, expiring: false };
    const server = new McpServer({ name: 'shared-mcp-gateway', version: VERSION });
    session.server = server;
    const withActiveOperation = async operation => {
      session.activeOperations += 1;
      try { return await operation(); }
      finally { session.activeOperations -= 1; }
    };
    server.registerTool('list_servers', { description: 'List redacted backend metadata and state without connecting.' }, async () => result({ servers: registry.list() }));
    server.registerTool('search_tools', { description: 'Search one backend, or initialized caches when server is omitted.', inputSchema: { server: z.string().optional(), query: z.string().default('') } },
      async ({ server: name, query }, extra) => withActiveOperation(async () => { try { return result(await registry.searchTools(name, query, extra.signal)); } catch (error) { return errorResult(error); } }));
    server.registerTool('get_tool_schema', { description: 'Return an allowed downstream tool definition.', inputSchema: { server: z.string(), tool: z.string() } },
      async ({ server: name, tool }, extra) => withActiveOperation(async () => { try { return result({ server: name, requiresExclusiveAccess: registry.requiresExclusiveAccess(name), tool: await registry.getTool(name, tool, extra.signal) }); } catch (error) { return errorResult(error); } }));
    server.registerTool('claim_server', { description: 'Claim an exclusive backend workflow lease.', inputSchema: { server: z.string() } },
      async ({ server: name }) => { try { return result(lease.claim(name, clientId, registry.requiresExclusiveAccess(name))); } catch (error) { return errorResult(error); } });
    server.registerTool('release_server', { description: 'Release an exclusive backend lease after outstanding calls settle.', inputSchema: { server: z.string() } },
      async ({ server: name }) => { try { return result(await lease.release(name, clientId, registry.requiresExclusiveAccess(name))); } catch (error) { return errorResult(error); } });
    server.registerTool('call_tool', { description: 'Validate and invoke an allowed downstream tool, preserving its complete result.', inputSchema: { server: z.string(), tool: z.string(), arguments: z.record(z.string(), z.unknown()).optional() } },
      async ({ server: name, tool, arguments: args }, extra) => withActiveOperation(async () => {
        let began = false; let outcomeUnknown = false;
        try {
          if (registry.requiresExclusiveAccess(name)) { lease.begin(name, clientId); began = true; }
          return await registry.callTool(name, tool, args, extra.signal);
        } catch (error) {
          outcomeUnknown = error?.outcomeUnknown === true;
          return errorResult(error);
        } finally { if (began) lease.end(name, clientId, outcomeUnknown); }
      }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: id => sessions.set(id, session) });
    session.transport = transport;
    await server.connect(transport);
    const sdkOnClose = transport.onclose;
    transport.onclose = () => { sdkOnClose?.(); disconnectSession(session); };
    return session;
  }
  app.all('/mcp', async (request, response) => {
    try {
      const id = request.headers['mcp-session-id']; let session = id ? sessions.get(id) : null;
      if (!session && request.method === 'POST' && request.body?.method === 'initialize') session = await createSession();
      if (!session) return response.status(400).json({ error: 'invalid_session' });
      if (request.method === 'POST') session.lastActivityAt = Date.now();
      await session.transport.handleRequest(request, response, request.body);
      if (request.method === 'DELETE') disconnectSession(session);
    } catch (error) { if (!response.headersSent) response.status(500).json({ error: 'gateway_error', message: error.message }); }
  });
  return {
    async listen() {
      listener = await new Promise((resolve, reject) => { const server = app.listen(port, host, () => resolve(server)); server.once('error', reject); });
      if (port === 0) { const actualPort = listener.address().port; allowedHosts = new Set([`${host}:${actualPort}`, `localhost:${actualPort}`]); }
      sweepTimer = setInterval(() => {
        const now = Date.now();
        for (const session of sessions.values()) if (session.activeOperations === 0 && now - session.lastActivityAt >= sessionIdleTimeoutMs) void expireSession(session);
      }, sessionSweepIntervalMs);
      sweepTimer.unref?.();
      return listener.address();
    },
    async close() {
      clearInterval(sweepTimer);
      await Promise.allSettled([...sessions.values()].map(async session => { disconnectSession(session); await withTimeout(session.transport.close(), 3000, 'Gateway session close'); }));
      await registry.close();
      if (listener) {
        const closing = new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
        listener.closeIdleConnections?.();
        try { await withTimeout(closing, 3000, 'Gateway listener close'); }
        catch (error) { listener.closeAllConnections?.(); await withTimeout(closing, 3000, 'Gateway forced listener close').catch(() => { throw error; }); }
      }
    }
  };
}
