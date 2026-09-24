import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { BackendRegistry } from '../src/backend-registry.js';
import { createGateway } from '../src/gateway-server.js';

const decode = response => JSON.parse(response.content[0].text);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('HTTP 502 after mutation dispatch latches an exclusive workflow without retry', async () => {
  const app = createMcpExpressApp({ host: '127.0.0.1', allowedHosts: undefined });
  const sessions = new Map();
  const dispatched = deferred();
  let mutationCalls = 0;
  let remoteCompleted = false;

  app.use('/mcp', express.json({ limit: '64kb' }));
  app.all('/mcp', async (request, response) => {
    const id = request.headers['mcp-session-id'];
    let session = id ? sessions.get(id) : null;
    if (!session && request.method === 'POST' && request.body?.method === 'initialize') {
      const server = new McpServer({ name: 'http-outcome', version: '1' });
      server.registerTool('mutate', { inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'unreachable' }] }));
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: sessionId => sessions.set(sessionId, { server, transport })
      });
      await server.connect(transport);
      session = { server, transport };
    }
    if (!session) return response.status(400).json({ error: 'invalid_session' });
    if (request.method === 'POST' && request.body?.method === 'tools/call') {
      mutationCalls += 1;
      dispatched.resolve();
      setTimeout(() => { remoteCompleted = true; }, 25).unref?.();
      return response.status(502).json({ error: 'bad_gateway' });
    }
    await session.transport.handleRequest(request, response, request.body);
  });

  const listener = await new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
  const registry = new BackendRegistry(new Map([['exclusive', {
    name: 'exclusive',
    url: `http://127.0.0.1:${listener.address().port}/mcp`,
    tools: ['mutate'],
    requiresExclusiveAccess: true
  }]]), { connectTimeoutMs: 1000, callTimeoutMs: 1000, closeTimeoutMs: 100 });
  const token = 'http-outcome-test-token';
  const gateway = createGateway({ registry, token, port: 0 });
  const address = await gateway.listen();
  const clients = [];

  try {
    for (const name of ['owner-a', 'owner-b']) {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } }
      });
      const client = new Client({ name, version: '1' });
      await client.connect(transport);
      clients.push(client);
    }
    const [ownerA, ownerB] = clients;
    assert.deepEqual(decode(await ownerA.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } })), {
      claimed: true,
      server: 'exclusive'
    });

    const failed = ownerA.callTool({
      name: 'call_tool',
      arguments: { server: 'exclusive', tool: 'mutate', arguments: { value: 'echo' } }
    });
    await dispatched.promise;
    const failure = decode(await failed);
    assert.equal(failure.error, 'call_failed');
    assert.match(failure.message, /downstream outcome is unknown; request was not retried/);
    assert.match(failure.message, /server remains blocked; review active work and restart gateway before another workflow/);
    assert.equal(mutationCalls, 1);

    assert.equal(decode(await ownerA.callTool({ name: 'release_server', arguments: { server: 'exclusive' } })).error, 'server_outcome_unknown');
    assert.equal(decode(await ownerB.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } })).error, 'server_outcome_unknown');
    await delay(40);
    assert.equal(remoteCompleted, true);
    assert.equal(mutationCalls, 1);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    await gateway.close();
    await Promise.allSettled([...sessions.values()].map(session => session.transport.close()));
    await new Promise(resolve => listener.close(resolve));
  }
});


test('nonexclusive post-dispatch failure reports uncertainty without exclusive recovery guidance', async () => {
  let calls = 0;
  const client = {
    async callTool() {
      calls += 1;
      throw new Error('Streamable HTTP error: 503 Service Unavailable');
    },
    async close() {}
  };
  const registry = new BackendRegistry(new Map([['open', {
    name: 'open', command: 'unused', tools: ['mutate'], requiresExclusiveAccess: false
  }]]), { closeTimeoutMs: 50 });
  registry.entries.set('open', {
    state: 'ready', client, transport: null,
    tools: new Map([['mutate', { name: 'mutate', inputSchema: { type: 'object' } }]]),
    discovery: null, connecting: null, closing: null, transportError: null, retireScheduled: null
  });

  await assert.rejects(() => registry.callTool('open', 'mutate', { value: 'echo' }), error => {
    assert.equal(error.code, 'call_failed');
    assert.equal(error.outcomeUnknown, true);
    assert.match(error.message, /downstream outcome is unknown; request was not retried/);
    assert.doesNotMatch(error.message, /server remains blocked|restart gateway/);
    return true;
  });
  assert.equal(calls, 1);
  await registry.close();
});
