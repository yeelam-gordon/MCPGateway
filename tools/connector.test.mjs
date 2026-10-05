import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
import { stopOwnedGateway } from '../src/ensure-gateway.js';

async function startFakeGateway(token, { idleTimeoutMs = 0 } = {}) {
  const app = createMcpExpressApp({ host: '127.0.0.1', allowedHosts: undefined });
  const sessions = new Map();
  let deletes = 0;
  let listCalls = 0;
  let failHeartbeatRequests = false;
  let invalidSessionStatus = 400;
  let initialized = 0;
  let mutations = 0;
  let claims = 0;
  let failMutationResponse = false;
  let invalidRequests = 0;
  let delayedInvalidResponse;
  let disconnectNextTool;
  let disconnectAfterHeadersTool;
  let interruptedContentType = 'application/json';
  const exclusiveClaims = new Map();
  let heldRecoveryNotification;
  let recoveryNotifications = 0;
  let initializedNotifications = 0;
  let interruptedNotifications = 0;
  let deleteDelayMs = 0;
  app.use((request, response, next) => request.headers.authorization === `Bearer ${token}` ? next() : response.status(401).json({ error: 'unauthorized' }));
  app.use('/mcp', express.json({ limit: '64kb' }));
  app.all('/mcp', async (request, response) => {
    const id = request.headers['mcp-session-id'];
    let session = id ? sessions.get(id) : null;
    if (!session && request.method === 'POST' && request.body?.method === 'initialize') {
      initialized += 1;
      const server = new McpServer({ name: 'fake-shared-gateway', version: '1' });
      server.registerTool('list_servers', {}, async () => { listCalls += 1; return { content: [{ type: 'text', text: '[]' }], structuredContent: { servers: [] } }; });
      server.registerTool('search_tools', { inputSchema: { query: z.string().optional() } }, async () => ({ content: [{ type: 'text', text: '[]' }] }));
      server.registerTool('get_tool_schema', { inputSchema: { server: z.string(), tool: z.string() } }, async () => ({ content: [{ type: 'text', text: '{}' }] }));
      server.registerTool(
        'call_tool',
        {
          inputSchema: {
            server: z.string(),
            tool: z.string(),
            arguments: z.record(z.string(), z.unknown()).optional()
          }
        },
        async ({ arguments: args }) => {
          mutations += 1;
          return ({
          content: [{ type: 'text', text: args.text }],
          structuredContent: { echoed: args.text, nested: { preserved: true } }
          });
        }
      );
      server.registerTool('claim_server', { inputSchema: { server: z.string() } }, async ({ server: name }) => {
        if (exclusiveClaims.has(name) && exclusiveClaims.get(name) !== transport.sessionId) {
          return { isError: true, content: [{ type: 'text', text: '{"error":"lease_busy"}' }] };
        }
        exclusiveClaims.set(name, transport.sessionId);
        claims += 1;
        return { content: [{ type: 'text', text: 'claimed' }] };
      });
      server.registerTool('release_server', { inputSchema: { server: z.string() } }, async () => ({ content: [{ type: 'text', text: 'released' }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: sessionId => sessions.set(sessionId, { server, transport, lastActivityAt: Date.now() }) });
      transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
      await server.connect(transport);
      session = { server, transport };
    }
    if (!session) {
      if (request.method === 'POST') {
        invalidRequests += 1;
        if (delayedInvalidResponse && invalidRequests === 2) await delayedInvalidResponse;
      }
      return response.status(invalidSessionStatus).json({ error: 'invalid_session' });
    }
    if (request.method === 'POST') session.lastActivityAt = Date.now();
    if (failHeartbeatRequests && request.method === 'POST' && request.body?.method === 'tools/call' && request.body?.params?.name === 'list_servers') {
      return response.status(503).json({ error: token });
    }
    if (request.method === 'DELETE') {
      if (deleteDelayMs) await new Promise(resolve => setTimeout(resolve, deleteDelayMs));
      deletes += 1;
      sessions.delete(id);
      for (const [name, owner] of exclusiveClaims) if (owner === id) exclusiveClaims.delete(name);
      return response.status(200).end();
    }
    if (request.body?.method === 'notifications/initialized') initializedNotifications += 1;
    if (heldRecoveryNotification && initialized > 1 && request.body?.method === 'notifications/initialized') {
      recoveryNotifications += 1;
      response.once('close', () => { if (!response.writableFinished) interruptedNotifications += 1; });
      await heldRecoveryNotification;
      if (response.destroyed) return;
    }
    if (failMutationResponse && request.body?.method === 'tools/call' && request.body.params?.name === 'call_tool') {
      mutations += 1;
      return response.status(502).json({ error: 'after_dispatch_failure' });
    }
    if (request.body?.method === 'tools/call' && request.body.params?.name === disconnectNextTool) {
      disconnectNextTool = null;
      if (request.body.params.name === 'call_tool') mutations += 1;
      request.socket.destroy();
      return;
    }
    if (request.body?.method === 'tools/call' && request.body.params?.name === disconnectAfterHeadersTool) {
      disconnectAfterHeadersTool = null;
      if (request.body.params.name === 'call_tool') mutations += 1;
      response.status(200).set('content-type', interruptedContentType);
      response.flushHeaders();
      response.write((interruptedContentType === 'text/event-stream' ? 'event: message\ndata: ' : '') + '{"jsonrpc":"2.0","result":');
      setTimeout(() => response.destroy(), 30);
      return;
    }
    await session.transport.handleRequest(request, response, request.body);
  });
  const sweep = idleTimeoutMs > 0 ? setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) if (now - session.lastActivityAt >= idleTimeoutMs) { sessions.delete(id); void session.transport.close(); }
  }, 10) : null;
  sweep?.unref?.();
  const listener = await new Promise((resolve, reject) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); server.once('error', reject); });
  return {
    port: listener.address().port,
    deletes: () => deletes,
    listCalls: () => listCalls,
    failHeartbeats: () => { failHeartbeatRequests = true; },
    expireSessions: async (status = 400) => {
      invalidSessionStatus = status;
      const existing = [...sessions.values()];
      sessions.clear();
      await Promise.all(existing.map(session => session.transport.close()));
    },
    initializations: () => initialized,
    invalidRequests: () => invalidRequests,
    delaySecondInvalidResponse: promise => { delayedInvalidResponse = promise; },
    mutations: () => mutations,
    claims: () => claims,
    failMutation: () => { failMutationResponse = true; },
    disconnectNext: tool => { disconnectNextTool = tool; },
    disconnectAfterHeaders: (tool, contentType = 'application/json') => {
      disconnectAfterHeadersTool = tool;
      interruptedContentType = contentType;
    },
    holdRecoveryNotification: promise => { heldRecoveryNotification = promise; },
    recoveryNotifications: () => recoveryNotifications,
    initializedNotifications: () => initializedNotifications,
    interruptedNotifications: () => interruptedNotifications,
    delayDeletes: milliseconds => { deleteDelayMs = milliseconds; },
    sessionCount: () => sessions.size,
    async close() {
      clearInterval(sweep);
      await new Promise(resolve => listener.close(resolve));
    }
  };
}

test('delayed old-session discovery receives its rejection before retirement', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-delayed-recovery-'));
  await writeFile(join(stateDir, 'owner.token'), 'delayed-recovery-token');
  const gateway = await startFakeGateway('delayed-recovery-token');
  let release;
  gateway.delaySecondInvalidResponse(new Promise(resolve => { release = resolve; }));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port)],
    stderr: 'pipe' });
  transport.stderr?.resume();
  const client = new Client({ name: 'delayed-recovery-test', version: '1' });
  try {
    await client.connect(transport);
    await gateway.expireSessions();
    const first = client.listTools(undefined, { timeout: 5000 });
    const second = client.callTool({ name: 'search_tools', arguments: { query: 'mail' } }, undefined, { timeout: 5000 });
    await waitFor(() => gateway.invalidRequests() === 2 && gateway.initializations() === 2, 5000);
    release();
    const results = await Promise.all([first, second]);
    assert.equal(results[0].tools.length, 6);
    assert.equal(gateway.initializations(), 2);
    assert.equal(gateway.mutations(), 0);
  } finally { release(); await client.close(); await gateway.close(); }
});

test('forwards tools and closes only its authenticated client session', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-connector-'));
  const token = 'connector-test-owner-token';
  await writeFile(join(stateDir, 'owner.token'), token);
  const gateway = await startFakeGateway(token);
  const connectorTransport = new StdioClientTransport({ command: process.execPath, args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port)], stderr: 'pipe' });
  const client = new Client({ name: 'connector-test', version: '1' });
  try {
    await client.connect(connectorTransport);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['call_tool', 'claim_server', 'get_tool_schema', 'list_servers', 'release_server', 'search_tools']);
    const result = await client.callTool({ name: 'call_tool', arguments: { server: 'fake', tool: 'echo', arguments: { text: 'hello' } } });
    assert.equal(result.content[0].text, 'hello');
    assert.deepEqual(result.structuredContent, { echoed: 'hello', nested: { preserved: true } });
    const started = Date.now();
    await client.close();
    assert.ok(Date.now() - started < 3000, 'connector close exceeded three seconds');

    const endpoint = new URL(`http://127.0.0.1:${gateway.port}/mcp`);
    const directTransport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { authorization: `Bearer ${token}` } } });
    const direct = new Client({ name: 'after-connector', version: '1' });
    await direct.connect(directTransport);
    assert.equal((await direct.listTools()).tools.length, 6);
    await direct.close();
  } finally {
    await Promise.allSettled([client.close(), gateway.close()]);
  }
});

for (const status of [400, 404]) {
  test(`rebuilds an expired HTTP session once for concurrent discovery (${status})`, async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gateway-session-recovery-'));
    const token = 'session-recovery-private-token';
    await writeFile(join(stateDir, 'owner.token'), token);
    const gateway = await startFakeGateway(token);
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port)],
      stderr: 'pipe' });
    let stderr = '';
    transport.stderr?.on('data', value => { stderr += value; });
    const client = new Client({ name: 'session-recovery-test', version: '1' });
    try {
      await client.connect(transport);
      await gateway.expireSessions(status);
      const results = await Promise.all([
        client.listTools(undefined, { timeout: 5000 }),
        client.callTool({ name: 'search_tools', arguments: { query: 'mail' } }, undefined, { timeout: 5000 }),
        client.callTool({ name: 'list_servers', arguments: {} }, undefined, { timeout: 5000 })
      ]);
      assert.equal(results[0].tools.length, 6);
      assert.equal(gateway.initializations(), 2, 'concurrent recovery must share one new initialization');
      assert.equal(gateway.mutations(), 0);
      assert.doesNotMatch(stderr, new RegExp(token));
      assert.match(stderr, /rebuilt an expired/);
    } finally { await client.close(); await gateway.close(); }
  });
}

for (const name of ['call_tool', 'claim_server', 'release_server']) {
  test(`does not replay ${name} after HTTP session loss`, async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gateway-no-replay-'));
    await writeFile(join(stateDir, 'owner.token'), 'no-replay-owner-token');
    const gateway = await startFakeGateway('no-replay-owner-token');
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port)],
      stderr: 'pipe' });
    transport.stderr?.resume();
    const client = new Client({ name: 'no-replay-test', version: '1' });
    try {
      await client.connect(transport);
      await gateway.expireSessions();
      const args = name === 'call_tool' ? { server: 'fake', tool: 'echo', arguments: { text: 'not executed' } } : { server: 'fake' };
      await assert.rejects(client.callTool({ name, arguments: args }, undefined, { timeout: 5000 }), /not replayed.*ownership may be lost/);
      assert.equal(gateway.mutations(), 0);
      assert.equal(gateway.claims(), 0);
      assert.equal(gateway.initializations(), 2);
      assert.equal((await client.listTools()).tools.length, 6);
    } finally { await client.close(); await gateway.close(); }
  });
}

test('heartbeat repairs an expired HTTP session without disconnecting the local client', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-heartbeat-recovery-'));
  await writeFile(join(stateDir, 'owner.token'), 'heartbeat-recovery-owner');
  const gateway = await startFakeGateway('heartbeat-recovery-owner');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port),
      '--heartbeat-interval-ms', '20', '--heartbeat-timeout-ms', '1000'], stderr: 'pipe' });
  transport.stderr?.resume();
  const client = new Client({ name: 'heartbeat-recovery-test', version: '1' });
  try {
    await client.connect(transport);
    await gateway.expireSessions();
    await waitFor(() => gateway.initializations() === 2 && gateway.listCalls() > 0, 5000);
    assert.equal((await client.listTools()).tools.length, 6);
  } finally { await client.close(); await gateway.close(); }
});

test('does not retry ambiguous post-dispatch HTTP failures', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-post-dispatch-'));
  await writeFile(join(stateDir, 'owner.token'), 'post-dispatch-owner');
  const gateway = await startFakeGateway('post-dispatch-owner');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port)],
    stderr: 'pipe' });
  transport.stderr?.resume();
  const client = new Client({ name: 'post-dispatch-test', version: '1' });
  try {
    await client.connect(transport);
    gateway.failMutation();
    await assert.rejects(client.callTool({ name: 'call_tool', arguments: {
      server: 'fake', tool: 'mutate', arguments: { text: 'once' }
    } }, undefined, { timeout: 5000     }), /Gateway request failed.*HTTP 502/);
    assert.equal(gateway.mutations(), 1);
    assert.equal(gateway.initializations(), 1);
  } finally { await client.close(); await gateway.close(); }
});

test('shutdown cancels a held retired-session request within a bounded close', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-retired-shutdown-'));
  await writeFile(join(stateDir, 'owner.token'), 'retired-shutdown-token');
  const gateway = await startFakeGateway('retired-shutdown-token');
  let release;
  gateway.delaySecondInvalidResponse(new Promise(resolve => { release = resolve; }));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port)],
    stderr: 'pipe' });
  transport.stderr?.resume();
  const client = new Client({ name: 'retired-shutdown-test', version: '1' });
  try {
    await client.connect(transport);
    await gateway.expireSessions();
    const first = client.listTools(undefined, { timeout: 5000 });
    const second = client.callTool({ name: 'search_tools', arguments: { query: 'held' } }, undefined, { timeout: 5000 });
    second.catch(() => {});
    await waitFor(() => gateway.invalidRequests() === 2 && gateway.initializations() === 2, 5000);
    await first;
    const started = Date.now();
    await client.close();
    assert.ok(Date.now() - started < 4000, 'held old-session request must not block connector shutdown');
    await assert.rejects(second);
    assert.equal(gateway.mutations(), 0);
  } finally { release(); await client.close(); await gateway.close(); }
});

test('rebuilds discovery after a confirmed local socket interruption', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-socket-recovery-'));
  await writeFile(join(stateDir, 'owner.token'), 'socket-recovery-token');
  const gateway = await startFakeGateway('socket-recovery-token');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port)],
    stderr: 'pipe' });
  transport.stderr?.resume();
  const client = new Client({ name: 'socket-recovery-test', version: '1' });
  try {
    await client.connect(transport);
    gateway.disconnectNext('search_tools');
    const result = await client.callTool({ name: 'search_tools', arguments: { query: 'mail' } }, undefined, { timeout: 5000 });
    assert.notEqual(result.isError, true);
    assert.equal(gateway.initializations(), 2);
    assert.equal(gateway.mutations(), 0);
  } finally { await client.close(); await gateway.close(); }
});

test('a socket interruption after dispatch never replays a downstream call', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-socket-no-replay-'));
  await writeFile(join(stateDir, 'owner.token'), 'socket-no-replay-token');
  const gateway = await startFakeGateway('socket-no-replay-token');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port)],
    stderr: 'pipe' });
  transport.stderr?.resume();
  const client = new Client({ name: 'socket-no-replay-test', version: '1' });
  try {
    await client.connect(transport);
    gateway.disconnectNext('call_tool');
    await assert.rejects(client.callTool({ name: 'call_tool', arguments: {
      server: 'fake', tool: 'mutate', arguments: { text: 'once' }
    } }, undefined, { timeout: 5000 }), /outcome is unknown.*not retried/);
    assert.equal(gateway.mutations(), 1);
    assert.equal(gateway.initializations(), 1);
  } finally { await client.close(); await gateway.close(); }
});

test('retirement deletes the previous valid session so an explicit idle claim can be reacquired', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-claim-recovery-'));
  await writeFile(join(stateDir, 'owner.token'), 'claim-recovery-token');
  const gateway = await startFakeGateway('claim-recovery-token');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port)],
    stderr: 'pipe' });
  transport.stderr?.resume();
  const client = new Client({ name: 'claim-recovery-test', version: '1' });
  try {
    await client.connect(transport);
    assert.notEqual((await client.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } })).isError, true);
    gateway.disconnectNext('search_tools');
    await client.callTool({ name: 'search_tools', arguments: {} }, undefined, { timeout: 5000 });
    assert.equal(gateway.deletes(), 1);
    assert.equal(gateway.claims(), 1, 'Recovery must not replay the previous claim');
    assert.notEqual((await client.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } })).isError, true);
    assert.equal(gateway.claims(), 2, 'Only the explicit caller reclaim may acquire ownership');
  } finally { await client.close(); await gateway.close(); }
});

test('EOF aborts a replacement handshake and deletes both minted HTTP sessions', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-handshake-eof-'));
  await writeFile(join(stateDir, 'owner.token'), 'handshake-eof-token');
  const gateway = await startFakeGateway('handshake-eof-token');
  let release;
  gateway.holdRecoveryNotification(new Promise(resolve => { release = resolve; }));
  const child = spawn(process.execPath, [join(process.cwd(), 'tools', 'connector.mjs'),
    '--state-dir', stateDir, '--port', String(gateway.port),
    '--heartbeat-interval-ms', '20', '--heartbeat-timeout-ms', '5000'], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.resume();
  let stderr = '';
  child.stderr.on('data', value => { stderr += value; });
  try {
    await waitFor(() => gateway.listCalls() > 0, 5000);
    gateway.delayDeletes(500);
    gateway.disconnectNext('list_servers');
    await waitFor(() => gateway.recoveryNotifications() === 1, 5000);
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.stdin.end();
    await waitFor(() => gateway.interruptedNotifications() === 1, 1000);
    release();
    const code = await Promise.race([exited,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Handshake EOF close exceeded bound')), 4000))]);
    assert.equal(code, 0);
    assert.equal(gateway.deletes(), 2, stderr);
    assert.equal(gateway.sessionCount(), 0);
    assert.equal(gateway.mutations(), 0);
  } finally { release(); if (child.exitCode === null) child.kill(); await gateway.close(); }
});

for (const contentType of ['application/json', 'text/event-stream']) {
for (const discovery of [true, false]) {
  test(`${contentType} body interruption after HTTP headers ${discovery ? 'recovers discovery' : 'never replays a downstream call'}`, async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gateway-body-interruption-'));
    await writeFile(join(stateDir, 'owner.token'), 'body-interruption-token');
    const gateway = await startFakeGateway('body-interruption-token');
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port)],
      stderr: 'pipe' });
    transport.stderr?.resume();
    const client = new Client({ name: 'body-interruption-test', version: '1' });
    try {
      await client.connect(transport);
      const name = discovery ? 'search_tools' : 'call_tool';
      gateway.disconnectAfterHeaders(name, contentType);
      const operation = client.callTool({ name, arguments: discovery ? { query: 'mail' } :
        { server: 'fake', tool: 'mutate', arguments: { text: 'once' } } }, undefined, { timeout: 5000 });
      if (discovery) {
        assert.notEqual((await operation).isError, true);
        assert.equal(gateway.initializations(), 2);
        assert.equal(gateway.mutations(), 0);
      } else {
        await assert.rejects(operation, /outcome is unknown.*not retried/);
        assert.equal(gateway.initializations(), 1);
        assert.equal(gateway.mutations(), 1);
      }
    } finally { await client.close(); await gateway.close(); }
  });
}
}




test('heartbeat keeps an idle connector session alive until EOF cleanup', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-heartbeat-'));
  const token = 'heartbeat-secret-token';
  await writeFile(join(stateDir, 'owner.token'), token);
  const gateway = await startFakeGateway(token, { idleTimeoutMs: 80 });
  const child = spawn(process.execPath, [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port), '--heartbeat-interval-ms', '20', '--heartbeat-timeout-ms', '50'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await waitFor(() => gateway.listCalls() >= 3, 3000);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(gateway.sessionCount(), 1, stderr);
    const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
    child.stdin.end();
    const code = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('heartbeat EOF exit exceeded bound')), 4000))]);
    assert.equal(code, 0, stderr);
    assert.equal(gateway.deletes(), 1, stderr);
    assert.doesNotMatch(stderr, new RegExp(token));
  } finally {
    if (child.exitCode === null) child.kill();
    await gateway.close();
  }
});


test('two consecutive heartbeat failures exit once with a sanitized diagnostic', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-heartbeat-failure-'));
  const token = 'heartbeat-failure-secret-token';
  await writeFile(join(stateDir, 'owner.token'), token);
  const gateway = await startFakeGateway(token);
  const child = spawn(process.execPath, [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port), '--heartbeat-interval-ms', '20', '--heartbeat-timeout-ms', '50'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await waitFor(() => gateway.sessionCount() === 1, 3000);
    gateway.failHeartbeats();
    const code = await Promise.race([
      new Promise(resolve => child.once('exit', exitCode => resolve(exitCode))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('heartbeat failure exit exceeded bound')), 4000))
    ]);
    assert.equal(code, 1, stderr);
    assert.equal((stderr.match(/Connector heartbeat failed twice/g) ?? []).length, 1);
    assert.doesNotMatch(stderr, new RegExp(token));
    assert.equal(gateway.deletes(), 1);
  } finally {
    if (child.exitCode === null) child.kill();
    await gateway.close();
  }
});

test('stdin EOF exits connector and deletes its remote session', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-eof-'));
  const token = 'eof-secret-token';
  await writeFile(join(stateDir, 'owner.token'), token);
  const gateway = await startFakeGateway(token);
  const child = spawn(process.execPath, [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir, '--port', String(gateway.port)], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await waitFor(() => gateway.initializedNotifications() === 1, 3000);
    const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
    child.stdin.end();
    const code = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('EOF exit exceeded bound')), 4000))]);
    assert.equal(code, 0, stderr);
    assert.equal(gateway.deletes(), 1);
    assert.doesNotMatch(stderr, new RegExp(token));
  } finally {
    if (child.exitCode === null) child.kill();
    await gateway.close();
  }
});

function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error('condition timed out'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

async function runConnector(args, timeoutMs = 5000) {
  const child = spawn(process.execPath, [join(process.cwd(), 'tools', 'connector.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const result = await Promise.race([
    new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))),
    new Promise((_, reject) => setTimeout(() => { child.kill(); reject(new Error('connector process exceeded test bound')); }, timeoutMs))
  ]);
  return result;
}

async function unusedPort() {
  const server = createNetServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('unreachable gateway exits bounded without leaking token', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-unreachable-'));
  const token = 'unreachable-secret-token';
  await writeFile(join(stateDir, 'owner.token'), token);
  const result = await runConnector(['--state-dir', stateDir, '--port', String(await unusedPort()), '--check', '--connect-timeout-ms', '500']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /connector failed/i);
  assert.doesNotMatch(result.stderr, new RegExp(token));
});

test('connection timeout closes transport and exits bounded without leaking token', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-timeout-'));
  const token = 'timeout-secret-token';
  await writeFile(join(stateDir, 'owner.token'), token);
  const server = createHttpServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const started = Date.now();
    const result = await runConnector(['--state-dir', stateDir, '--port', String(server.address().port), '--check', '--connect-timeout-ms', '200']);
    assert.equal(result.code, 1);
    assert.ok(Date.now() - started < 5000);
    assert.match(result.stderr, /did not become ready within 200ms/i);
    assert.doesNotMatch(result.stderr, new RegExp(token));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('missing token fails startup promptly without exposing config data', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-no-token-'));
  const result = await runConnector(['--state-dir', stateDir, '--port', '7319', '--check']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /connector failed/i);
  assert.doesNotMatch(result.stderr, /authorization|bearer/i);
});



test('auto-start requires an explicit config path', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-auto-config-'));
  const result = await runConnector(['--state-dir', stateDir, '--auto-start']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--config is required with --auto-start/);
});

test('auto-start-only paths are rejected when auto-start is absent', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'gateway-auto-only-'));
  const configResult = await runConnector(['--state-dir', stateDir, '--config', join(stateDir, 'config.json')]);
  assert.equal(configResult.code, 1);
  assert.match(configResult.stderr, /--config requires --auto-start/);

  const adaptersResult = await runConnector(['--state-dir', stateDir, '--adapters', join(stateDir, 'adapters.json')]);
  assert.equal(adaptersResult.code, 1);
  assert.match(adaptersResult.stderr, /--adapters requires --auto-start/);
});

test('retained connectors auto-start one owned replacement after a real daemon restart', async () => {
  const stateDir = await mkdtemp(join(process.cwd(), '.gateway-connector-restart-'));
  const configPath = join(stateDir, 'backends.json');
  const port = await unusedPort();
  await writeFile(configPath, JSON.stringify({ mcpServers: {
    fake: { command: process.execPath, args: [join(process.cwd(), 'test', 'fixtures', 'fake-stdio.js')], tools: ['echo'] }
  } }));
  const clients = [];
  let recoveryMessages = 0;
  const metadata = async () => JSON.parse(await readFile(join(stateDir, 'gateway-instance.json'), 'utf8'));
  try {
    for (let index = 0; index < 2; index += 1) {
      const transport = new StdioClientTransport({ command: process.execPath,
        args: [join(process.cwd(), 'tools', 'connector.mjs'), '--state-dir', stateDir,
          '--port', String(port), '--auto-start', '--config', configPath], stderr: 'pipe' });
      transport.stderr?.on('data', value => {
        if (String(value).includes('rebuilt an expired or interrupted')) recoveryMessages += 1;
      });

      const client = new Client({ name: `retained-restart-${index}`, version: '1' });
      clients.push(client);
      await client.connect(transport, { timeout: 90000 });
      assert.equal((await client.listTools(undefined, { timeout: 5000 })).tools.length, 6);
    }
    const before = await metadata();
    assert.equal(await stopOwnedGateway({ stateDir, port, timeoutMs: 5000 }), true);
    const discoveries = await Promise.all(clients.map(client => client.callTool({
      name: 'search_tools', arguments: { server: 'fake', query: 'echo' }
    }, undefined, { timeout: 90000, maxTotalTimeout: 90000 })));
    for (const result of discoveries) {
      assert.notEqual(result.isError, true);
      assert.equal(result.structuredContent.tools[0].name, 'echo');
    }
    const after = await metadata();
    assert.notEqual(after.pid, before.pid);
    assert.notEqual(after.nonce, before.nonce);
    assert.equal(recoveryMessages, 2);
    const result = await clients[0].callTool({ name: 'call_tool',
      arguments: { server: 'fake', tool: 'echo', arguments: { text: 'after restart' } }
    }, undefined, { timeout: 5000 });
    assert.equal(result.structuredContent.text, 'after restart');
    assert.equal((await metadata()).pid, after.pid);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    await stopOwnedGateway({ stateDir, port, timeoutMs: 5000 });
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('EOF cancels auto-start recovery waiting on a live lock without a later daemon launch', { timeout: 90_000 }, async t => {
  const stateDir = await mkdtemp(join(process.cwd(), '.gateway-connector-cancel-'));
  const configPath = join(stateDir, 'backends.json');
  const port = await unusedPort();
  await writeFile(configPath, JSON.stringify({ mcpServers: {} }));
  const child = spawn(process.execPath, [join(process.cwd(), 'tools', 'connector.mjs'),
    '--state-dir', stateDir, '--port', String(port), '--auto-start', '--config', configPath,
    '--heartbeat-interval-ms', '60000'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  const responses = new Map();
  let buffered = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      if (message.id !== undefined) responses.set(message.id, message);
    }
  });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  const send = message => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const lockPath = `${stateDir}.token-init.lock`;
  let timer;
  try {
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25',
      capabilities: {}, clientInfo: { name: 'cancel-recovery-fixture', version: '1' } } });
    await waitFor(() => responses.has(1), 60_000);
    assert.ok(responses.get(1).result, stderr);
    send({ method: 'notifications/initialized' });
    const before = JSON.parse(await readFile(join(stateDir, 'gateway-instance.json'), 'utf8'));
    assert.equal(await stopOwnedGateway({ stateDir, port, timeoutMs: 5000 }), true);
    const record = JSON.stringify({ nonce: 'live-recovery-fixture', pid: process.pid, createdAt: new Date().toISOString() });
    await writeFile(lockPath, record);
    send({ id: 2, method: 'tools/call', params: { name: 'search_tools', arguments: { query: 'mail' } } });
    const waitDeadline = Date.now() + 5000;
    while (!(await readdir(join(stateDir, '..'))).some(name =>
      name.startsWith(stateDir.split(/[\\/]/).at(-1) + '.token-init.lock.') && name.endsWith('.prepared'))) {
      assert.ok(Date.now() < waitDeadline, 'RPC must reach the real ensureGateway lock wait');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const started = Date.now();
    child.stdin.end();
    const code = await Promise.race([exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('recovery EOF exit exceeded bound')), 3000);
    })]).finally(() => clearTimeout(timer));
    assert.equal(code, 0, stderr);
    assert.ok(Date.now() - started < 3000);
    t.diagnostic(`Recovery EOF exit: ${Date.now() - started}ms; exit code ${code}`);
    assert.equal(await readFile(lockPath, 'utf8'), record, 'foreign lock stays untouched');
    assert.doesNotMatch(stderr, /connector failed|rebuilt an expired|heartbeat failed twice/);
    await rm(lockPath);
    await new Promise(resolve => setTimeout(resolve, 200));
    await assert.rejects(access(join(stateDir, 'gateway-instance.json')), { code: 'ENOENT' });
    assert.equal((await readFile(join(stateDir, 'gateway.stdout.log'), 'utf8')).match(/Shared MCP gateway listening/g)?.length, 1);
    assert.doesNotThrow(() => process.kill(process.pid, 0));
    assert.ok(before.pid > 0);
    assert.equal((await readdir(join(stateDir, '..'))).some(name =>
      name.startsWith(stateDir.split(/[\\/]/).at(-1) + '.token-init.lock.') && name.endsWith('.prepared')), false);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
    await stopOwnedGateway({ stateDir, port, timeoutMs: 5000 });
    await rm(lockPath, { force: true });
    await rm(stateDir, { recursive: true, force: true });
  }
});

async function heldInitialStartup(extraArgs = []) {
  const stateDir = await mkdtemp(join(process.cwd(), '.gateway-initial-cancel-'));
  const configPath = join(stateDir, 'backends.json');
  const port = await unusedPort();
  const lockPath = `${stateDir}.token-init.lock`;
  const lockRecord = JSON.stringify({ nonce: 'live-initial-fixture', pid: process.pid, createdAt: new Date().toISOString() });
  await writeFile(configPath, JSON.stringify({ mcpServers: {} }));
  await writeFile(lockPath, lockRecord);
  const child = spawn(process.execPath, [join(process.cwd(), 'tools', 'connector.mjs'),
    '--state-dir', stateDir, '--port', String(port), '--auto-start', '--config', configPath,
    '--heartbeat-interval-ms', '60000', ...extraArgs], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  return {
    stateDir, port, lockPath, lockRecord, child, exited,
    stdout: () => stdout,
    stderr: () => stderr,
    async waiting() {
      const deadline = Date.now() + 5000;
      while (!(await readdir(join(stateDir, '..'))).some(name =>
        name.startsWith(stateDir.split(/[\\/]/).at(-1) + '.token-init.lock.') && name.endsWith('.prepared'))) {
        assert.ok(Date.now() < deadline, 'initial ensureGateway must reach its live lock wait');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    async exitWithin(milliseconds = 3000) {
      let timer;
      return Promise.race([exited, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('initial startup exit exceeded bound')), milliseconds);
      })]).finally(() => clearTimeout(timer));
    },
    async cleanup() {
      if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
      await stopOwnedGateway({ stateDir, port, timeoutMs: 5000 });
      await rm(lockPath, { force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  };
}

const initialMessage = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'initial-buffer-fixture', version: '1' } } }) + '\n';

for (const shutdown of ['empty EOF', 'buffered initialize EOF', 'SIGTERM']) {
  test(`initial auto-start observes ${shutdown} before any HTTP initialization`, {
    timeout: 30_000, skip: shutdown === 'SIGTERM' && process.platform === 'win32'
  }, async t => {
    const fixture = await heldInitialStartup();
    try {
      await fixture.waiting();
      const started = Date.now();
      if (shutdown === 'SIGTERM') fixture.child.kill('SIGTERM');
      else fixture.child.stdin.end(shutdown === 'empty EOF' ? '' : initialMessage);
      const result = await fixture.exitWithin();
      assert.equal(result.code, 0, fixture.stderr());
      t.diagnostic(`Initial ${shutdown}: ${Date.now() - started}ms`);
      assert.equal(fixture.stdout(), '', 'no frontend initialize response after shutdown');
      assert.doesNotMatch(fixture.stderr(), /connector failed/);
      assert.equal(await readFile(fixture.lockPath, 'utf8'), fixture.lockRecord);
      await rm(fixture.lockPath);
      await new Promise(resolve => setTimeout(resolve, 150));
      await assert.rejects(access(join(fixture.stateDir, 'gateway-instance.json')), { code: 'ENOENT' });
      await assert.rejects(access(join(fixture.stateDir, 'gateway.stdout.log')), { code: 'ENOENT' });
      assert.equal((await readdir(join(fixture.stateDir, '..'))).some(name =>
        name.startsWith(fixture.stateDir.split(/[\\/]/).at(-1) + '.token-init.lock.') && name.endsWith('.prepared')), false);
    } finally { await fixture.cleanup(); }
  });
}

test('initial startup replays buffered MCP initialize and pipelined requests exactly once', { timeout: 60_000 }, async () => {
  const fixture = await heldInitialStartup();
  try {
    await fixture.waiting();
    const pipeline = initialMessage +
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_servers', arguments: {} } }) + '\n';
    fixture.child.stdin.write(pipeline.slice(0, 23));
    fixture.child.stdin.write(pipeline.slice(23));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(fixture.stdout(), '');
    await rm(fixture.lockPath);
    await waitFor(() => fixture.stdout().trim().split('\n').length === 3, 50_000);
    const responses = fixture.stdout().trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(responses.map(response => response.id).sort(), [1, 2, 3]);
    assert.ok(responses.find(response => response.id === 1).result);
    assert.equal(responses.find(response => response.id === 2).result.tools.length, 6);
    assert.deepEqual(responses.find(response => response.id === 3).result.structuredContent.servers, []);
    fixture.child.stdin.end();
    assert.equal((await fixture.exitWithin()).code, 0, fixture.stderr());
  } finally { await fixture.cleanup(); }
});

test('initial --check ignores stdin EOF while auto-start is pending', { timeout: 60_000 }, async () => {
  const fixture = await heldInitialStartup(['--check']);
  try {
    await fixture.waiting();
    fixture.child.stdin.end(initialMessage);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(fixture.child.exitCode, null, fixture.stderr());
    await rm(fixture.lockPath);
    assert.equal((await fixture.exitWithin(50_000)).code, 0, fixture.stderr());
    assert.match(fixture.stdout(), /Gateway ready/);
    assert.ok(JSON.parse(await readFile(join(fixture.stateDir, 'gateway-instance.json'), 'utf8')).pid > 0);
  } finally { await fixture.cleanup(); }
});

test('initial startup input is bounded and rejects overflow without launching a daemon', { timeout: 30_000 }, async () => {
  const fixture = await heldInitialStartup();
  try {
    await fixture.waiting();
    fixture.child.stdin.write(Buffer.alloc(1024 * 1024 + 1, 'x'));
    assert.equal((await fixture.exitWithin()).code, 1);
    assert.match(fixture.stderr(), /startup input exceeded the 1 MiB buffering limit/);
    assert.equal(await readFile(fixture.lockPath, 'utf8'), fixture.lockRecord);
    await assert.rejects(access(join(fixture.stateDir, 'gateway.stdout.log')), { code: 'ENOENT' });
  } finally { await fixture.cleanup(); }
});
