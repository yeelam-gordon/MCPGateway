import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { BackendRegistry } from '../src/backend-registry.js';
import { LeaseManager } from '../src/lease-manager.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function readyRegistry(client, callTimeoutMs = 200) {
  const name = 'catalog';
  const registry = new BackendRegistry(
    new Map([[name, { name, command: 'unused', tools: ['*'] }]]),
    { callTimeoutMs, closeTimeoutMs: 50 }
  );
  const entry = {
    state: 'ready', client, transport: null, tools: null, discovery: null,
    connecting: null, closing: null, transportError: null, retireScheduled: null
  };
  registry.entries.set(name, entry);
  return { registry, entry };
}

test('unknown completion rejects a pending release and survives disconnect cleanup', async () => {
  const lease = new LeaseManager();
  lease.claim('exclusive', 'owner', true);
  lease.begin('exclusive', 'owner');

  const releasing = lease.release('exclusive', 'owner', true);
  assert.throws(() => lease.claim('exclusive', 'owner', true), error => error.code === 'lease_releasing');
  lease.disconnect('owner');
  lease.end('exclusive', 'owner', true);

  await assert.rejects(releasing, error => error.code === 'server_outcome_unknown');
  assert.throws(() => lease.claim('exclusive', 'next', true), error => error.code === 'server_outcome_unknown');
  assert.equal(lease.leases.get('exclusive').outcomeUnknown, true);
});

test('last-waiter cancellation permits an immediate fresh discovery retry', async () => {
  const firstStarted = deferred();
  let calls = 0;
  const client = {
    listTools(_params, options) {
      calls += 1;
      if (calls > 1) return Promise.resolve({ tools: [{ name: 'fresh', inputSchema: { type: 'object' } }] });
      firstStarted.resolve();
      return new Promise((_, reject) => {
        const rejectCancelled = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        options.signal.addEventListener('abort', rejectCancelled, { once: true });
        if (options.signal.aborted) rejectCancelled();
      });
    },
    async close() {}
  };
  const { registry } = readyRegistry(client);
  const controller = new AbortController();
  try {
    const cancelled = registry.searchTools('catalog', '', controller.signal);
    await firstStarted.promise;
    controller.abort();
    const retried = registry.searchTools('catalog');

    await assert.rejects(cancelled, error => error.code === 'cancelled');
    assert.deepEqual((await retried).tools.map(tool => tool.name), ['fresh']);
    assert.equal(calls, 2);
  } finally {
    await registry.close();
  }
});

test('stale discovery completion cannot overwrite or retire a newer backend generation', async () => {
  const staleStarted = deferred();
  const releaseStale = deferred();
  let staleCloses = 0;
  const staleClient = {
    async listTools() {
      staleStarted.resolve();
      await releaseStale.promise;
      return { tools: [{ name: 'stale', inputSchema: { type: 'object' } }] };
    },
    async close() { staleCloses += 1; }
  };
  const { registry, entry: staleEntry } = readyRegistry(staleClient);
  try {
    const staleRequest = registry.searchTools('catalog');
    await staleStarted.promise;

    const currentClient = {
      async listTools() { return { tools: [{ name: 'current', inputSchema: { type: 'object' } }] }; },
      async close() {}
    };
    const currentEntry = {
      state: 'ready', client: currentClient, transport: null, tools: null, discovery: null,
      connecting: null, closing: null, transportError: null, retireScheduled: null
    };
    registry.entries.set('catalog', currentEntry);
    assert.deepEqual((await registry.searchTools('catalog')).tools.map(tool => tool.name), ['current']);

    releaseStale.resolve();
    await assert.rejects(staleRequest, error => error.code === 'connect_cancelled');
    assert.equal(registry.entries.get('catalog'), currentEntry);
    assert.deepEqual([...currentEntry.tools.keys()], ['current']);
    assert.equal(staleEntry.tools, null);
    assert.equal(staleCloses, 1);
  } finally {
    releaseStale.resolve();
    await registry.close();
  }
});


test('heartbeat failure terminates the connector without clearing an exclusive unknown-outcome lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gateway-confidence-heartbeat-'));
  const token = 'confidence-heartbeat-token';
  await writeFile(join(root, 'owner.token'), `${token}\n`);

  const lease = new LeaseManager();
  const sessions = new Map();
  const heartbeatFailuresObserved = deferred();
  let failHeartbeats = false;
  let failedHeartbeats = 0;
  const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
  const app = createMcpExpressApp({ host: '127.0.0.1', allowedHosts: undefined });
  app.use((request, response, next) => request.headers.authorization === `Bearer ${token}`
    ? next()
    : response.status(401).json({ error: 'unauthorized' }));
  app.use('/mcp', express.json({ limit: '64kb' }));
  app.all('/mcp', async (request, response) => {
    const id = request.headers['mcp-session-id'];
    let session = id ? sessions.get(id) : null;
    if (!session && request.method === 'POST' && request.body?.method === 'initialize') {
      const clientId = randomUUID();
      const server = new McpServer({ name: 'confidence-gateway', version: '0.4.0' });
      server.registerTool('list_servers', {}, async () => result({ servers: [{ name: 'exclusive', requiresExclusiveAccess: true }] }));
      server.registerTool('claim_server', { inputSchema: { server: z.string() } }, async ({ server: name }) => {
        try { return result(lease.claim(name, clientId, true)); }
        catch (error) { return result({ error: error.code, message: error.message }); }
      });
      server.registerTool('call_tool', { inputSchema: { server: z.string(), tool: z.string(), arguments: z.record(z.string(), z.unknown()).optional() } }, async ({ server: name }) => {
        try {
          lease.begin(name, clientId);
          lease.end(name, clientId, true);
          return result({ error: 'timeout', message: 'downstream outcome unknown' });
        } catch (error) { return result({ error: error.code, message: error.message }); }
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: sessionId => sessions.set(sessionId, { clientId, server, transport })
      });
      await server.connect(transport);
      session = { clientId, server, transport };
    }
    if (!session) return response.status(400).json({ error: 'invalid_session' });
    if (failHeartbeats && request.method === 'POST' && request.body?.method === 'tools/call' && request.body?.params?.name === 'list_servers') {
      failedHeartbeats += 1;
      if (failedHeartbeats === 2) heartbeatFailuresObserved.resolve();
      return response.status(503).json({ error: 'heartbeat_unavailable' });
    }
    if (request.method === 'DELETE') {
      sessions.delete(id);
      lease.disconnect(session.clientId);
      return response.status(200).end();
    }
    await session.transport.handleRequest(request, response, request.body);
  });

  const listener = await new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
  const connectorTransport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', root, '--port', String(listener.address().port), '--heartbeat-interval-ms', '20', '--heartbeat-timeout-ms', '50'],
    stderr: 'pipe'
  });
  const connectorClient = new Client({ name: 'confidence-connector', version: '1' });
  let directClient;
  try {
    await connectorClient.connect(connectorTransport);
    const connectorProcess = connectorTransport._process;
    assert.ok(connectorProcess, 'connector child process was not available');
    let stderr = '';
    connectorTransport.stderr?.setEncoding('utf8');
    connectorTransport.stderr?.on('data', chunk => { stderr += chunk; });

    assert.equal(JSON.parse((await connectorClient.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } })).content[0].text).claimed, true);
    assert.equal(JSON.parse((await connectorClient.callTool({ name: 'call_tool', arguments: { server: 'exclusive', tool: 'mutate' } })).content[0].text).error, 'timeout');

    failHeartbeats = true;
    await Promise.race([
      heartbeatFailuresObserved.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('connector did not issue two failed heartbeats')), 3000))
    ]);
    const exitCode = await Promise.race([
      connectorProcess.exitCode === null
        ? new Promise(resolve => connectorProcess.once('exit', resolve))
        : Promise.resolve(connectorProcess.exitCode),
      new Promise((_, reject) => setTimeout(() => reject(new Error('connector heartbeat termination exceeded bound')), 3000))
    ]);
    assert.equal(exitCode, 1, stderr);
    assert.match(stderr, /Connector heartbeat failed twice/);
    assert.equal(sessions.size, 0);

    const directTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${listener.address().port}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    });
    directClient = new Client({ name: 'confidence-after-heartbeat', version: '1' });
    await directClient.connect(directTransport);
    const claimed = JSON.parse((await directClient.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } })).content[0].text);
    assert.equal(claimed.error, 'server_outcome_unknown');
  } finally {
    await Promise.allSettled([connectorClient.close(), directClient?.close()]);
    await Promise.allSettled([...sessions.values()].map(session => session.transport.close()));
    await new Promise(resolve => listener.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

