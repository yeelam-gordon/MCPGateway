import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, writeFile } from 'node:fs/promises';
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

async function startFakeGateway(token, { idleTimeoutMs = 0 } = {}) {
  const app = createMcpExpressApp({ host: '127.0.0.1', allowedHosts: undefined });
  const sessions = new Map();
  let deletes = 0;
  let listCalls = 0;
  let failHeartbeatRequests = false;
  app.use((request, response, next) => request.headers.authorization === `Bearer ${token}` ? next() : response.status(401).json({ error: 'unauthorized' }));
  app.use('/mcp', express.json({ limit: '64kb' }));
  app.all('/mcp', async (request, response) => {
    const id = request.headers['mcp-session-id'];
    let session = id ? sessions.get(id) : null;
    if (!session && request.method === 'POST' && request.body?.method === 'initialize') {
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
        async ({ arguments: args }) => ({
          content: [{ type: 'text', text: args.text }],
          structuredContent: { echoed: args.text, nested: { preserved: true } }
        })
      );
      server.registerTool('claim_server', { inputSchema: { server: z.string() } }, async () => ({ content: [{ type: 'text', text: 'claimed' }] }));
      server.registerTool('release_server', { inputSchema: { server: z.string() } }, async () => ({ content: [{ type: 'text', text: 'released' }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: sessionId => sessions.set(sessionId, { server, transport, lastActivityAt: Date.now() }) });
      transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
      await server.connect(transport);
      session = { server, transport };
    }
    if (!session) return response.status(400).json({ error: 'invalid_session' });
    if (request.method === 'POST') session.lastActivityAt = Date.now();
    if (failHeartbeatRequests && request.method === 'POST' && request.body?.method === 'tools/call' && request.body?.params?.name === 'list_servers') {
      return response.status(503).json({ error: token });
    }
    if (request.method === 'DELETE') {
      deletes += 1;
      sessions.delete(id);
      return response.status(200).end();
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
    sessionCount: () => sessions.size,
    async close() {
      clearInterval(sweep);
      await new Promise(resolve => listener.close(resolve));
    }
  };
}

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
    assert.equal(gateway.deletes(), 1);
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
    await waitFor(() => gateway.sessionCount() === 1, 3000);
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
