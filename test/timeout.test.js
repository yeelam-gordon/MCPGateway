import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BackendRegistry } from '../src/backend-registry.js';
import { createGateway } from '../src/gateway-server.js';
import {
  BACKEND_CALL_TIMEOUT_MS,
  CLIENT_REQUEST_TIMEOUT_MS,
  CONNECTOR_REQUEST_TIMEOUT_MS,
  requestOptions
} from '../src/request-budget.js';
import { downstreamTimeout } from '../src/time.js';

const closers = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

function readyRegistry(client, callTimeoutMs = 25, tools = ['slow', 'fast']) {
  const name = 'workiq';
  const registry = new BackendRegistry(
    new Map([[name, { name, command: 'unused', tools: ['*'] }]]),
    { callTimeoutMs, closeTimeoutMs: 50 }
  );
  const entry = {
    state: 'ready', client, transport: null,
    tools: new Map(tools.map(tool => [tool, { name: tool, inputSchema: { type: 'object' } }])),
    connecting: null, closing: null, transportError: null, retireScheduled: null
  };
  registry.entries.set(name, entry);
  closers.push(() => registry.close());
  return { registry, entry };
}

const decode = response => JSON.parse(response.content[0].text);

test('exports finite ordered request budgets and bounded SDK options', () => {
  assert.equal(BACKEND_CALL_TIMEOUT_MS, 120_000);
  assert.equal(CONNECTOR_REQUEST_TIMEOUT_MS, 180_000);
  assert.equal(CLIENT_REQUEST_TIMEOUT_MS, 210_000);
  assert.ok(BACKEND_CALL_TIMEOUT_MS < CONNECTOR_REQUEST_TIMEOUT_MS);
  assert.ok(CONNECTOR_REQUEST_TIMEOUT_MS < CLIENT_REQUEST_TIMEOUT_MS);
  const controller = new AbortController();
  assert.deepEqual(requestOptions(37, controller.signal), {
    timeout: 37,
    maxTotalTimeout: 37,
    resetTimeoutOnProgress: false,
    signal: controller.signal
  });
  assert.throws(() => requestOptions(Infinity), /positive finite/);
});

test('passes explicit backend SDK deadlines for discovery and calls', async () => {
  const observed = {};
  const client = {
    async listTools(params, options) {
      observed.list = { params, options };
      return { tools: [{ name: 'fast', inputSchema: { type: 'object' } }] };
    },
    async callTool(params, schema, options) {
      observed.call = { params, schema, options };
      return { content: [{ type: 'text', text: 'ok' }] };
    },
    async close() {}
  };
  const { registry, entry } = readyRegistry(client, 41, []);
  entry.tools = null;
  assert.equal((await registry.callTool('workiq', 'fast', {})).content[0].text, 'ok');
  assert.deepEqual(observed.list.params, undefined);
  assert.deepEqual(observed.list.options, requestOptions(41));
  assert.deepEqual(observed.call.params, { name: 'fast', arguments: {} });
  assert.deepEqual(observed.call.options, requestOptions(41));
});

test('normalizes backend timeout context without replay or retirement', async () => {
  const calls = [];
  const client = {
    callTool(params, _schema, options) {
      calls.push({ params, options });
      if (params.name === 'fast') return Promise.resolve({ content: [{ type: 'text', text: 'healthy' }] });
      return new Promise((_, reject) => setTimeout(() => {
        reject(Object.assign(new Error('Request timed out'), { code: -32001 }));
      }, options.timeout));
    },
    async close() {}
  };
  const { registry, entry } = readyRegistry(client, 30);
  const slow = registry.callTool('workiq', 'slow', { mutation: true });
  await delay(5);
  assert.equal((await registry.callTool('workiq', 'fast', {})).content[0].text, 'healthy');
  await assert.rejects(slow, error => {
    assert.equal(error.code, 'timeout');
    assert.equal(error.outcomeUnknown, true);
    assert.match(error.message, /Call workiq\.slow timed out after 30ms/);
    assert.match(error.message, /outcome is unknown/);
    assert.match(error.message, /not retried/);
    return true;
  });
  assert.equal(calls.filter(call => call.params.name === 'slow').length, 1);
  assert.equal(registry.entries.get('workiq'), entry);
  assert.equal((await registry.callTool('workiq', 'fast', {})).content[0].text, 'healthy');
});

test('retires a stale session error without classifying or replaying it as a timeout', async () => {
  let calls = 0;
  let closes = 0;
  const client = {
    async callTool() {
      calls += 1;
      throw Object.assign(new Error('MCP error -32001: Session not found'), { code: -32001 });
    },
    async close() { closes += 1; }
  };
  const { registry } = readyRegistry(client, 30, ['search']);
  await assert.rejects(() => registry.callTool('workiq', 'search', {}), error => {
    assert.equal(error.code, 'call_failed');
    assert.match(error.message, /Session not found/);
    assert.equal(error.outcomeUnknown, undefined);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(registry.entries.has('workiq'), false);
  assert.equal(closes, 1);
});
test('keeps Playwright locked after a timeout with unknown outcome', async () => {
  let downstreamCalls = 0;
  const registry = {
    list: () => [],
    searchTools: async () => ({ tools: [] }),
    getTool: async () => ({ name: 'mutate' }),
    async callTool() {
      downstreamCalls += 1;
      throw downstreamTimeout('Call playwright.mutate', 12, Object.assign(new Error('Request timed out'), { code: -32001 }));
    },
    async close() {}
  };
  const token = 'timeout-test-owner-token';
  const gateway = createGateway({ registry, token, port: 0 });
  const address = await gateway.listen();
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  });
  const client = new Client({ name: 'timeout-test', version: '1' });
  await client.connect(transport);
  closers.push(() => client.close(), () => gateway.close());

  await client.callTool({ name: 'claim_playwright', arguments: {} });
  const first = decode(await client.callTool({ name: 'call_tool', arguments: { server: 'playwright', tool: 'mutate', arguments: {} } }));
  assert.equal(first.error, 'timeout');
  assert.match(first.message, /outcome is unknown/);
  const second = decode(await client.callTool({ name: 'call_tool', arguments: { server: 'playwright', tool: 'mutate', arguments: {} } }));
  assert.equal(second.error, 'playwright_outcome_unknown');
  assert.equal(downstreamCalls, 1);
  const release = decode(await client.callTool({ name: 'release_playwright', arguments: {} }));
  assert.deepEqual(release, { released: false, pending: true });
});

test('connector forwards abort and the larger explicit request budget', async () => {
  const source = await readFile(join(process.cwd(), 'tools', 'connector.mjs'), 'utf8');
  assert.match(source, /requestOptions\(CONNECTOR_REQUEST_TIMEOUT_MS, extra\.signal\)/);
  assert.match(source, /remote\.callTool\([\s\S]*CallToolResultSchema,[\s\S]*requestOptions\(CONNECTOR_REQUEST_TIMEOUT_MS, extra\.signal\)/);
  assert.match(source, /downstream outcome is unknown and the request was not retried/);
  assert.doesNotMatch(source, /JSON\.stringify\(request\.params\?\.arguments/);
});
