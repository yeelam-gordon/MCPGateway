import { randomUUID, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import express from 'express';
import { GatewayError, errorResult } from './errors.js';
import { LeaseManager } from './lease-manager.js';
import { withTimeout } from './time.js';

const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
function tokenMatches(actual, expected) { const left = Buffer.from(actual); const right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right); }

export function createGateway({ registry, token, host = '127.0.0.1', port = 7319, bodyLimit = '1mb' }) {
  let allowedHosts = port === 0 ? null : new Set([`${host}:${port}`, `localhost:${port}`]);
  const app = createMcpExpressApp({ host, allowedHosts: undefined }); const sessions = new Map(); const lease = new LeaseManager(); const unknownPlaywrightOutcomes = new Set(); let listener;
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

  async function createSession() {
    const clientId = randomUUID(); const server = new McpServer({ name: 'shared-mcp-gateway', version: '0.1.0' });
    server.registerTool('list_servers', { description: 'List redacted backend metadata and state without connecting.' }, async () => result({ servers: registry.list() }));
    server.registerTool('search_tools', { description: 'Search one backend, or initialized caches when server is omitted.', inputSchema: { server: z.string().optional(), query: z.string().default('') } },
      async ({ server: name, query }) => { try { return result(await registry.searchTools(name, query)); } catch (error) { return errorResult(error); } });
    server.registerTool('get_tool_schema', { description: 'Return an allowed downstream tool definition.', inputSchema: { server: z.string(), tool: z.string() } },
      async ({ server: name, tool }) => { try { return result({ server: name, tool: await registry.getTool(name, tool) }); } catch (error) { return errorResult(error); } });
    server.registerTool('claim_playwright', { description: 'Claim the exclusive Playwright workflow lease.' }, async () => { try { return result(lease.claim(clientId)); } catch (error) { return errorResult(error); } });
    server.registerTool('release_playwright', { description: 'Release the Playwright lease after outstanding calls settle.' }, async () => { try { return result(lease.release(clientId)); } catch (error) { return errorResult(error); } });
    server.registerTool('call_tool', { description: 'Validate and invoke an allowed downstream tool, preserving its complete result.', inputSchema: { server: z.string(), tool: z.string(), arguments: z.record(z.string(), z.unknown()).optional() } },
      async ({ server: name, tool, arguments: args }) => {
        const playwright = name === 'playwright'; let began = false; let outcomeUnknown = false;
        try {
          if (playwright) {
            if (unknownPlaywrightOutcomes.has(clientId)) throw new GatewayError('playwright_outcome_unknown', 'A prior Playwright call timed out with an unknown downstream outcome; restart the gateway before issuing another Playwright mutation');
            lease.begin(clientId); began = true;
          }
          return await registry.callTool(name, tool, args);
        } catch (error) {
          outcomeUnknown = error?.outcomeUnknown === true;
          if (playwright && outcomeUnknown) unknownPlaywrightOutcomes.add(clientId);
          return errorResult(error);
        } finally { if (began && !outcomeUnknown) lease.end(clientId); }
      });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: id => sessions.set(id, { clientId, server, transport }) });
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); unknownPlaywrightOutcomes.delete(clientId); lease.disconnect(clientId); };
    await server.connect(transport); return { clientId, server, transport };
  }
  app.all('/mcp', async (request, response) => {
    try {
      const id = request.headers['mcp-session-id']; let session = id ? sessions.get(id) : null;
      if (!session && request.method === 'POST' && request.body?.method === 'initialize') session = await createSession();
      if (!session) return response.status(400).json({ error: 'invalid_session' });
      await session.transport.handleRequest(request, response, request.body);
      if (request.method === 'DELETE') {
        if (session.transport.sessionId) sessions.delete(session.transport.sessionId);
        unknownPlaywrightOutcomes.delete(session.clientId);
        lease.disconnect(session.clientId);
      }
    } catch (error) { if (!response.headersSent) response.status(500).json({ error: 'gateway_error', message: error.message }); }
  });
  return {
    async listen() {
      listener = await new Promise((resolve, reject) => { const server = app.listen(port, host, () => resolve(server)); server.once('error', reject); });
      if (port === 0) { const actualPort = listener.address().port; allowedHosts = new Set([`${host}:${actualPort}`, `localhost:${actualPort}`]); }
      return listener.address();
    },
    async close() {
      await Promise.allSettled([...sessions.values()].map(session => withTimeout(session.transport.close(), 3000, 'Gateway session close')));
      await registry.close();
      if (listener) {
        const closing = new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
        listener.closeIdleConnections?.();
        try {
          await withTimeout(closing, 3000, 'Gateway listener close');
        } catch (error) {
          listener.closeAllConnections?.();
          await withTimeout(closing, 3000, 'Gateway forced listener close').catch(() => { throw error; });
        }
      }
    }
  };
}
