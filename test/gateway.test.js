import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import { afterEach, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BackendRegistry } from '../src/backend-registry.js';
import { loadConfig } from '../src/config.js';
import { createGateway } from '../src/gateway-server.js';
import { loadOrCreateToken } from '../src/token.js';
const closers = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-gateway-')); const counter = join(directory, 'counter.txt'); const mutation = join(directory, 'mutation.txt'); const config = join(directory, 'config.json');
  const fake = join(process.cwd(), 'test', 'fixtures', 'fake-stdio.js');
  await writeFile(config, JSON.stringify({ mcpServers: {
    fake: { command: process.execPath, args: [fake], env: { COUNTER_FILE: counter, MUTATION_FILE: mutation }, tools: ['echo', 'mutate'] },
    playwright: { command: process.execPath, args: [fake], env: { COUNTER_FILE: counter }, tools: ['echo'] },
    disabled: { disabled: true, command: 'never' }, 'shared-mcp-gateway': { command: 'never' }
  } })); return { counter, mutation, config };
}
async function start() {
  const files = await fixture(); const registry = new BackendRegistry(await loadConfig(files.config), { connectTimeoutMs: 5000, callTimeoutMs: 3000, closeTimeoutMs: 1000 });
  const token = 'test-owner-token'; const gateway = createGateway({ registry, token, port: 0 }); const address = await gateway.listen(); closers.push(() => gateway.close());
  return { ...files, token, endpoint: new URL(`http://127.0.0.1:${address.port}/mcp`) };
}
async function connect(endpoint, token) {
  const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { authorization: `Bearer ${token}` } } });
  const client = new Client({ name: 'test-client', version: '1' }); await client.connect(transport); client.testTransport = transport; closers.push(() => client.close()); return client;
}
const jsonOf = response => JSON.parse(response.content[0].text);
const errorOf = response => jsonOf(response).error;
async function startHttpBackend() {
  const app = createMcpExpressApp({ host: '127.0.0.1', allowedHosts: undefined });
  const sessions = new Map(); let connects = 0;
  app.use((request, response, next) => request.headers['x-test-auth'] === 'approved' ? next() : response.status(401).json({ error: 'unauthorized' }));
  app.use('/mcp', express.json({ limit: '64kb' }));
  app.all('/mcp', async (request, response) => {
    const id = request.headers['mcp-session-id']; let session = id ? sessions.get(id) : null;
    if (!session && request.method === 'POST' && request.body?.method === 'initialize') {
      connects += 1;
      const server = new McpServer({ name: 'fake-http', version: '1' });
      server.registerTool('echo', { inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: 'text', text }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: sessionId => sessions.set(sessionId, { server, transport }) });
      await server.connect(transport); session = { server, transport };
    }
    if (!session) return response.status(400).json({ error: 'invalid_session' });
    await session.transport.handleRequest(request, response, request.body);
  });
  const listener = await new Promise((resolve, reject) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); server.once('error', reject); });
  closers.push(async () => { await Promise.allSettled([...sessions.values()].map(session => session.transport.close())); await new Promise(resolve => listener.close(resolve)); });
  return { url: `http://127.0.0.1:${listener.address().port}/mcp`, connects: () => connects };
}
test('creates and reuses the exact owner token file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-gateway-token-'));
  const first = await loadOrCreateToken(directory); const second = await loadOrCreateToken(directory);
  assert.equal(first.path, join(directory, 'owner.token')); assert.equal(first.token, second.token); assert.match(first.token, /^[A-Za-z0-9_-]{40,}$/);
});
test('validates config and skips disabled and self entries', async () => {
  const { config } = await fixture(); const loaded = await loadConfig(config); assert.deepEqual([...loaded.keys()], ['fake', 'playwright']);
  await assert.rejects(() => loadConfig(join(tmpdir(), 'missing-mcp-config.json')), /Cannot read MCP config/);
});
test('two clients single-flight one backend and disconnect independently', async () => {
  const { endpoint, token, counter } = await start(); const [a, b] = await Promise.all([connect(endpoint, token), connect(endpoint, token)]);
  const [one, two] = await Promise.all([
    a.callTool({ name: 'call_tool', arguments: { server: 'fake', tool: 'echo', arguments: { text: 'one' } } }),
    b.callTool({ name: 'call_tool', arguments: { server: 'fake', tool: 'echo', arguments: { text: 'two' } } })
  ]);
  assert.equal(one.content[0].text, 'one'); assert.equal(two.content[0].text, 'two'); assert.equal((await readFile(counter, 'utf8')).trim().split(/\r?\n/).length, 1);
  await a.close(); assert.equal((await b.callTool({ name: 'call_tool', arguments: { server: 'fake', tool: 'echo', arguments: { text: 'alive' } } })).content[0].text, 'alive');
});
test('shares an HTTP backend and sends only its configured headers', async () => {
  const backend = await startHttpBackend();
  const registry = new BackendRegistry(new Map([['httpfake', { name: 'httpfake', url: backend.url, headers: { 'x-test-auth': 'approved' }, tools: ['echo'] }]]), { connectTimeoutMs: 5000, callTimeoutMs: 3000, closeTimeoutMs: 1000 });
  closers.push(() => registry.close());
  const [one, two] = await Promise.all([registry.callTool('httpfake', 'echo', { text: 'one' }), registry.callTool('httpfake', 'echo', { text: 'two' })]);
  assert.equal(one.content[0].text, 'one'); assert.equal(two.content[0].text, 'two'); assert.equal(backend.connects(), 1);
});
test('bounds HTTP authentication failure cleanup without recursive close', async () => {
  const app = createMcpExpressApp({ host: '127.0.0.1', allowedHosts: undefined });
  app.all('/mcp', (_request, response) => response.status(401).set('www-authenticate', 'Bearer').json({ error: 'unauthorized' }));
  const listener = await new Promise((resolve, reject) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); server.once('error', reject); });
  const registry = new BackendRegistry(new Map([['unauthorized', { name: 'unauthorized', url: `http://127.0.0.1:${listener.address().port}/mcp`, tools: ['*'] }]]), { connectTimeoutMs: 3000, closeTimeoutMs: 500 });
  try {
    await assert.rejects(() => registry.searchTools('unauthorized'), error => error.code === 'auth_required');
    const started = Date.now();
    await registry.close();
    assert.ok(Date.now() - started < 1500);
  } finally {
    await registry.close();
    await new Promise(resolve => listener.close(resolve));
  }
});

test('handles synchronous reentrant HTTP onclose without unhandled rejection', async () => {
  const backend = await startHttpBackend();
  const registry = new BackendRegistry(new Map([['reentrant', { name: 'reentrant', url: backend.url, headers: { 'x-test-auth': 'approved' }, tools: ['echo'] }]]), { connectTimeoutMs: 3000, callTimeoutMs: 3000, closeTimeoutMs: 1000 });
  await registry.callTool('reentrant', 'echo', { text: 'ready' });
  const transport = registry.entries.get('reentrant').transport;
  const originalClose = transport.close.bind(transport);
  transport.close = async () => {
    transport.onclose?.();
    await originalClose();
    transport.onclose?.();
  };
  const unhandled = [];
  const recordUnhandled = error => { unhandled.push(error); };
  process.on('unhandledRejection', recordUnhandled);
  try {
    await registry.close();
    await delay(20);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', recordUnhandled);
    await registry.close();
  }
});

test('implements wildcard, explicit, and empty tool allowlists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-gateway-allowlist-'));
  const fake = join(process.cwd(), 'test', 'fixtures', 'fake-stdio.js');
  const wildcard = new BackendRegistry(new Map([['wildcard', { name: 'wildcard', command: process.execPath, args: [fake], tools: ['*'] }]]));
  const empty = new BackendRegistry(new Map([['empty', { name: 'empty', command: process.execPath, args: [fake], tools: [] }]]));
  closers.push(() => wildcard.close(), () => empty.close());
  assert.equal((await wildcard.getTool('wildcard', 'hidden')).name, 'hidden');
  assert.deepEqual((await empty.searchTools('empty')).tools, []);
  await assert.rejects(() => empty.getTool('empty', 'echo'), error => error.code === 'tool_not_allowed');
});

test('paginates all tools, supports draft 2020 schemas, and resets cursor cycles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-gateway-pages-'));
  const counter = join(directory, 'counter.txt'); const cycleOnce = join(directory, 'cycle.txt');
  const fixturePath = join(process.cwd(), 'test', 'fixtures', 'fake-paged-stdio.js');
  const registry = new BackendRegistry(new Map([['paged', { name: 'paged', command: process.execPath, args: [fixturePath], env: { COUNTER_FILE: counter, CYCLE_ONCE_FILE: cycleOnce }, tools: ['*'] }]]), { maxToolPages: 5, callTimeoutMs: 3000, closeTimeoutMs: 1000 });
  closers.push(() => registry.close());
  await assert.rejects(() => registry.getTool('paged', 'page_two'), error => error.code === 'pagination_cycle');
  assert.equal((await registry.callTool('paged', 'page_two', { text: 'page two' })).content[0].text, 'page two');
  await assert.rejects(() => registry.callTool('paged', 'page_two', { text: 9 }), error => error.code === 'invalid_arguments');
  await assert.rejects(() => registry.callTool('paged', 'unsupported', {}), error => error.code === 'schema_error');
  assert.equal((await readFile(counter, 'utf8')).trim().split(/\r?\n/).length, 2);
});

test('drains stdio stderr and closes a pending connection during shutdown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-gateway-lifecycle-'));
  const fake = join(process.cwd(), 'test', 'fixtures', 'fake-stdio.js');
  const noisy = new BackendRegistry(new Map([['noisy', { name: 'noisy', command: process.execPath, args: [fake], env: { STDERR_BYTES: '2097152' }, tools: ['*'] }]]), { connectTimeoutMs: 5000, callTimeoutMs: 5000, closeTimeoutMs: 1500 });
  assert.equal((await noisy.callTool('noisy', 'echo', { text: 'drained' })).content[0].text, 'drained');
  await noisy.close();

  const counter = join(directory, 'hanging.txt'); const hangingPath = join(process.cwd(), 'test', 'fixtures', 'fake-hanging-stdio.js');
  const hanging = new BackendRegistry(new Map([['hanging', { name: 'hanging', command: process.execPath, args: [hangingPath], env: { COUNTER_FILE: counter }, tools: ['*'] }]]), { connectTimeoutMs: 10000, closeTimeoutMs: 1500 });
  const pending = hanging.connect('hanging').then(() => null, error => error);
  for (let attempt = 0; attempt < 50; attempt += 1) { try { await readFile(counter, 'utf8'); break; } catch { await delay(20); } }
  const childPid = Number((await readFile(counter, 'utf8')).trim());
  const started = Date.now(); await hanging.close(); const error = await pending;
  assert.ok(error); assert.ok(Date.now() - started < 3000);
  let alive = true;
  for (let attempt = 0; attempt < 50 && alive; attempt += 1) { try { process.kill(childPid, 0); await delay(20); } catch { alive = false; } }
  assert.equal(alive, false);
});

test('keeps caller timeouts independent without replacing the shared backend', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-gateway-timeout-')); const counter = join(directory, 'counter.txt');
  const fake = join(process.cwd(), 'test', 'fixtures', 'fake-stdio.js');
  const registry = new BackendRegistry(new Map([['timed', { name: 'timed', command: process.execPath, args: [fake], env: { COUNTER_FILE: counter }, tools: ['echo', 'slow'] }]]), { connectTimeoutMs: 5000, callTimeoutMs: 100, closeTimeoutMs: 1000 });
  closers.push(() => registry.close());
  const slow = registry.callTool('timed', 'slow', { milliseconds: 300 });
  await delay(20);
  assert.equal((await registry.callTool('timed', 'echo', { text: 'concurrent' })).content[0].text, 'concurrent');
  await assert.rejects(() => slow, error => error.code === 'timeout');
  await delay(250);
  assert.equal((await registry.callTool('timed', 'echo', { text: 'still-alive' })).content[0].text, 'still-alive');
  assert.equal((await readFile(counter, 'utf8')).trim().split(/\r?\n/).length, 1);
});

test('enforces allowlists and downstream argument validation', async () => {
  const { endpoint, token } = await start(); const client = await connect(endpoint, token);
  const search = await client.callTool({ name: 'search_tools', arguments: { server: 'fake' } }); assert.deepEqual(jsonOf(search).tools.map(tool => tool.name).sort(), ['echo', 'mutate']);
  assert.equal(errorOf(await client.callTool({ name: 'get_tool_schema', arguments: { server: 'fake', tool: 'hidden' } })), 'tool_not_allowed');
  assert.equal(errorOf(await client.callTool({ name: 'call_tool', arguments: { server: 'fake', tool: 'echo', arguments: { text: 3 } } })), 'invalid_arguments');
});
test('resets failed backend and never retries mutation', async () => {
  const { endpoint, token, counter, mutation } = await start(); const client = await connect(endpoint, token);
  assert.equal((await client.callTool({ name: 'call_tool', arguments: { server: 'fake', tool: 'mutate', arguments: {} } })).isError, true);
  assert.equal((await readFile(mutation, 'utf8')).trim().split(/\r?\n/).length, 1);
  assert.equal((await client.callTool({ name: 'call_tool', arguments: { server: 'fake', tool: 'echo', arguments: { text: 'reconnected' } } })).content[0].text, 'reconnected');
  assert.equal((await readFile(counter, 'utf8')).trim().split(/\r?\n/).length, 2);
  assert.equal((await client.callTool({ name: 'call_tool', arguments: { server: 'fake', tool: 'echo', arguments: { text: 'same-generation' } } })).content[0].text, 'same-generation');
  assert.equal((await readFile(counter, 'utf8')).trim().split(/\r?\n/).length, 2);
});
test('rejects bad auth, Origin, and Host without token leakage', async () => {
  const { endpoint, token } = await start();
  for (const item of [{ headers: {}, status: 401 }, { headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example' }, status: 403 }]) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...item.headers }, body: '{}' });
    assert.equal(response.status, item.status); assert.doesNotMatch(await response.text(), new RegExp(token));
  }
  const hostResult = await new Promise((resolve, reject) => {
    const request = httpRequest(endpoint, { method: 'POST', headers: { host: 'evil.example', authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(hostResult.status, 403); assert.doesNotMatch(hostResult.body, new RegExp(token));
});
test('isolates Playwright for a full client workflow', async () => {
  const { endpoint, token } = await start(); const a = await connect(endpoint, token); const b = await connect(endpoint, token);
  assert.equal((await a.callTool({ name: 'claim_playwright', arguments: {} })).content[0].text === '{"claimed":true}', true);
  assert.equal(errorOf(await b.callTool({ name: 'claim_playwright', arguments: {} })), 'lease_busy');
  assert.equal(errorOf(await b.callTool({ name: 'call_tool', arguments: { server: 'playwright', tool: 'echo', arguments: { text: 'blocked' } } })), 'lease_required');
  assert.equal((await a.callTool({ name: 'call_tool', arguments: { server: 'playwright', tool: 'echo', arguments: { text: 'owned' } } })).content[0].text, 'owned');
  await a.testTransport.terminateSession(); assert.equal((await b.callTool({ name: 'claim_playwright', arguments: {} })).content[0].text === '{"claimed":true}', true);
});
