import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { BackendRegistry } from '../src/backend-registry.js';

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    const onAbort = () => finish(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    function finish(error) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function readyRegistry(client, options = {}) {
  const name = 'catalog';
  const registry = new BackendRegistry(new Map([[name, { name, command: 'unused', tools: ['*'] }]]), {
    callTimeoutMs: options.callTimeoutMs ?? 200,
    closeTimeoutMs: 50,
    maxToolPages: 10
  });
  registry.entries.set(name, {
    state: 'ready', client, transport: null, tools: null, discovery: null,
    connecting: null, closing: null, transportError: null, retireScheduled: null
  });
  return registry;
}

function paginatedClient({ pageDelayMs = 10, pages = 3, failFirst = false } = {}) {
  const calls = []; let failures = 0; let mutationCalls = 0;
  return {
    calls,
    get mutationCalls() { return mutationCalls; },
    async listTools(params, options) {
      const page = params?.cursor ? Number(params.cursor) : 1;
      calls.push({ page, timeout: options.timeout, signal: options.signal });
      await abortableDelay(pageDelayMs, options.signal);
      if (failFirst && failures++ === 0) throw Object.assign(new Error('Request timed out'), { code: -32001 });
      return {
        tools: [{ name: `tool_${page}`, inputSchema: { type: 'object' } }],
        ...(page < pages ? { nextCursor: String(page + 1) } : {})
      };
    },
    async callTool() { mutationCalls += 1; return { content: [{ type: 'text', text: 'done' }] }; },
    async close() {}
  };
}

test('shares one in-flight paginated catalog across concurrent first-use clients', async () => {
  const client = paginatedClient(); const registry = readyRegistry(client);
  try {
    const [first, second] = await Promise.all([registry.searchTools('catalog'), registry.searchTools('catalog')]);
    assert.equal(first.tools.length, 3); assert.deepEqual(second, first);
    assert.deepEqual(client.calls.map(call => call.page), [1, 2, 3]);
    assert.equal(registry.entries.get('catalog').tools.size, 3);
  } finally { await registry.close(); }
});

test('cancelling one catalog waiter does not cancel another waiter', async () => {
  const client = paginatedClient({ pageDelayMs: 15 }); const registry = readyRegistry(client);
  const cancelled = new AbortController(); const remaining = new AbortController();
  try {
    const first = registry.searchTools('catalog', '', cancelled.signal);
    const second = registry.searchTools('catalog', '', remaining.signal);
    await delay(5); cancelled.abort();
    await assert.rejects(first, error => error.code === 'cancelled');
    assert.equal((await second).tools.length, 3);
    assert.deepEqual(client.calls.map(call => call.page), [1, 2, 3]);
  } finally { await registry.close(); }
});

test('cancelling every waiter aborts shared discovery before the next page', async () => {
  const client = paginatedClient({ pageDelayMs: 50 }); const registry = readyRegistry(client);
  const one = new AbortController(); const two = new AbortController();
  try {
    const first = registry.searchTools('catalog', '', one.signal);
    const second = registry.getTool('catalog', 'tool_1', two.signal);
    await delay(5); one.abort(); two.abort();
    await Promise.all([
      assert.rejects(first, error => error.code === 'cancelled'),
      assert.rejects(second, error => error.code === 'cancelled')
    ]);
    await delay(20);
    assert.deepEqual(client.calls.map(call => call.page), [1]);
    assert.equal(registry.entries.get('catalog').discovery, null);
  } finally { await registry.close(); }
});

test('enforces one aggregate catalog deadline and passes decreasing SDK budgets', async () => {
  const client = paginatedClient({ pageDelayMs: 25, pages: 3 }); const registry = readyRegistry(client, { callTimeoutMs: 45 });
  const started = Date.now();
  try {
    await assert.rejects(() => registry.searchTools('catalog'), error => error.code === 'timeout');
    assert.ok(Date.now() - started < 150);
    assert.deepEqual(client.calls.map(call => call.page), [1, 2]);
    assert.ok(client.calls[1].timeout < client.calls[0].timeout);
    assert.equal(registry.entries.get('catalog').discovery, null);
  } finally { await registry.close(); }
});

test('clears failed discovery for explicit retry and never replays mutation calls', async () => {
  const client = paginatedClient({ failFirst: true, pages: 1 }); const registry = readyRegistry(client);
  try {
    await assert.rejects(() => registry.callTool('catalog', 'tool_1', { mutation: true }), error => error.code === 'timeout');
    assert.equal(client.mutationCalls, 0);
    assert.equal(registry.entries.get('catalog').discovery, null);
    const result = await registry.callTool('catalog', 'tool_1', { mutation: true });
    assert.equal(result.content[0].text, 'done');
    assert.equal(client.calls.length, 2); assert.equal(client.mutationCalls, 1);
  } finally { await registry.close(); }
});


test('marks an actual Undici socket-destroy failure unknown without retrying mutation', async () => {
  const app = createMcpExpressApp({ host: '127.0.0.1', allowedHosts: undefined });
  const sessions = new Map(); let mutationCalls = 0; let remoteCompleted = false;
  app.use('/mcp', express.json({ limit: '64kb' }));
  app.all('/mcp', async (request, response) => {
    const id = request.headers['mcp-session-id']; let session = id ? sessions.get(id) : null;
    if (!session && request.method === 'POST' && request.body?.method === 'initialize') {
      const server = new McpServer({ name: 'socket-destroy', version: '1' });
      server.registerTool('mutate', { inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'unreachable' }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: sessionId => sessions.set(sessionId, { server, transport }) });
      await server.connect(transport); session = { server, transport };
    }
    if (!session) return response.status(400).json({ error: 'invalid_session' });
    if (request.method === 'POST' && request.body?.method === 'tools/call') {
      mutationCalls += 1;
      setTimeout(() => { remoteCompleted = true; }, 20).unref?.();
      response.socket.destroy();
      return;
    }
    await session.transport.handleRequest(request, response, request.body);
  });
  const listener = await new Promise((resolve, reject) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); server.once('error', reject); });
  const registry = new BackendRegistry(new Map([['exclusive', {
    name: 'exclusive', url: `http://127.0.0.1:${listener.address().port}/mcp`, tools: ['mutate'], requiresExclusiveAccess: true
  }]]), { connectTimeoutMs: 1000, callTimeoutMs: 1000, closeTimeoutMs: 100 });
  try {
    await assert.rejects(() => registry.callTool('exclusive', 'mutate', {}), error => error.code === 'call_failed' && error.outcomeUnknown === true);
    await delay(30);
    assert.equal(mutationCalls, 1); assert.equal(remoteCompleted, true); assert.equal(registry.entries.has('exclusive'), false);
  } finally {
    await registry.close();
    await Promise.allSettled([...sessions.values()].map(session => session.transport.close()));
    await new Promise(resolve => listener.close(resolve));
  }
});
