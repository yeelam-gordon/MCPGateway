import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createGateway } from '../src/gateway-server.js';
import { downstreamTimeout } from '../src/time.js';
import { GatewayError } from '../src/errors.js';

const closers = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });
const decode = response => JSON.parse(response.content[0].text);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function registryFixture() {
  const configs = new Map([
    ['alpha', { name: 'alpha', requiresExclusiveAccess: true }],
    ['beta', { name: 'beta', requiresExclusiveAccess: true }],
    ['open', { name: 'open', requiresExclusiveAccess: false }]
  ]);
  const tools = new Map([...configs.keys()].map(name => [name, { name: 'work', description: `${name} work`, inputSchema: { type: 'object', properties: { mode: { type: 'string' } } } }]));
  const gates = new Map(); const calls = [];
  const requireConfig = name => { const config = configs.get(name); if (!config) throw new GatewayError('unknown_server', `Unknown backend: ${name}`); return config; };
  return {
    calls, tools, gates,
    list: () => [...configs.values()].map(config => ({ name: config.name, state: 'idle', requiresExclusiveAccess: config.requiresExclusiveAccess })),
    requiresExclusiveAccess: name => requireConfig(name).requiresExclusiveAccess,
    async searchTools(name) { const names = name ? [requireConfig(name).name] : []; return { tools: names.map(server => ({ server, name: 'work', description: `${server} work`, requiresExclusiveAccess: requireConfig(server).requiresExclusiveAccess })), note: null }; },
    async getTool(name, tool) { requireConfig(name); if (tool !== 'work') throw Object.assign(new Error('missing'), { code: 'tool_not_allowed' }); return tools.get(name); },
    async callTool(name, tool, args = {}) {
      requireConfig(name); calls.push({ name, tool, args });
      if (args.mode === 'wait' || args.mode === 'timeout') { const gate = deferred(); gates.set(`${name}:${args.mode}`, gate); await gate.promise; }
      if (args.mode === 'timeout') throw downstreamTimeout(`Call ${name}.${tool}`, 10, new Error('timed out'));
      return { content: [{ type: 'text', text: `${name}:${args.mode ?? 'ok'}` }], structuredContent: { server: name }, customResultField: 'preserved' };
    },
    async close() {}
  };
}

async function setup() {
  const registry = registryFixture(); const token = 'server-lease-test-token';
  const gateway = createGateway({ registry, token, port: 0 }); const address = await gateway.listen(); closers.push(() => gateway.close());
  const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
  async function connect(name) {
    const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { authorization: `Bearer ${token}` } } });
    const client = new Client({ name, version: '1' }); await client.connect(transport); client.testTransport = transport; closers.push(() => client.close()); return client;
  }
  return { registry, clients: await Promise.all([connect('a'), connect('b')]) };
}
async function waitFor(predicate) { for (let attempt = 0; attempt < 100; attempt += 1) { if (predicate()) return; await delay(5); } assert.fail('condition not reached'); }
async function eventuallyClaim(client, server) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = decode(await client.callTool({ name: 'claim_server', arguments: { server } }));
    if (value.claimed) return value;
    assert.equal(value.error, 'lease_busy'); await delay(5);
  }
  assert.fail(`could not claim ${server}`);
}

test('exposes exactly six tools and resolved metadata without mutating schemas', async () => {
  const { registry, clients: [client] } = await setup();
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['call_tool', 'claim_server', 'get_tool_schema', 'list_servers', 'release_server', 'search_tools']);
  const servers = decode(await client.callTool({ name: 'list_servers', arguments: {} })).servers;
  assert.deepEqual(Object.fromEntries(servers.map(server => [server.name, server.requiresExclusiveAccess])), { alpha: true, beta: true, open: false });
  assert.equal(decode(await client.callTool({ name: 'search_tools', arguments: { server: 'alpha' } })).tools[0].requiresExclusiveAccess, true);
  const original = structuredClone(registry.tools.get('alpha').inputSchema);
  const schema = decode(await client.callTool({ name: 'get_tool_schema', arguments: { server: 'alpha', tool: 'work' } }));
  assert.equal(schema.requiresExclusiveAccess, true); assert.deepEqual(schema.tool.inputSchema, original); assert.deepEqual(registry.tools.get('alpha').inputSchema, original);
  assert.equal(decode(await client.callTool({ name: 'claim_server', arguments: { server: 'open' } })).error, 'lease_not_required');
  assert.equal(decode(await client.callTool({ name: 'claim_server', arguments: { server: 'missing' } })).error, 'unknown_server');
});

test('scopes leases by backend and owner while preserving nonexclusive and full results', async () => {
  const { clients: [a, b] } = await setup();
  assert.deepEqual(decode(await a.callTool({ name: 'claim_server', arguments: { server: 'alpha' } })), { claimed: true, server: 'alpha' });
  assert.deepEqual(decode(await a.callTool({ name: 'claim_server', arguments: { server: 'alpha' } })), { claimed: true, server: 'alpha' });
  assert.deepEqual(decode(await a.callTool({ name: 'claim_server', arguments: { server: 'beta' } })), { claimed: true, server: 'beta' });
  assert.equal(decode(await b.callTool({ name: 'claim_server', arguments: { server: 'alpha' } })).error, 'lease_busy');
  assert.equal(decode(await b.callTool({ name: 'call_tool', arguments: { server: 'alpha', tool: 'work' } })).error, 'lease_required');
  assert.equal((await b.callTool({ name: 'call_tool', arguments: { server: 'open', tool: 'work' } })).customResultField, 'preserved');
  assert.equal((await a.callTool({ name: 'call_tool', arguments: { server: 'alpha', tool: 'work' } })).customResultField, 'preserved');
  assert.deepEqual(decode(await a.callTool({ name: 'release_server', arguments: { server: 'alpha' } })), { released: true, server: 'alpha' });
  assert.deepEqual(decode(await b.callTool({ name: 'claim_server', arguments: { server: 'alpha' } })), { claimed: true, server: 'alpha' });
});

test('release and disconnect wait for in-flight calls and block new starts', async () => {
  const { registry, clients: [a, b] } = await setup();
  await a.callTool({ name: 'claim_server', arguments: { server: 'alpha' } });
  const active = a.callTool({ name: 'call_tool', arguments: { server: 'alpha', tool: 'work', arguments: { mode: 'wait' } } }); await waitFor(() => registry.gates.has('alpha:wait'));
  const releasing = a.callTool({ name: 'release_server', arguments: { server: 'alpha' } }); await delay(10);
  assert.equal(decode(await a.callTool({ name: 'call_tool', arguments: { server: 'alpha', tool: 'work' } })).error, 'lease_releasing');
  assert.equal(decode(await a.callTool({ name: 'claim_server', arguments: { server: 'alpha' } })).error, 'lease_releasing');
  registry.gates.get('alpha:wait').resolve(); await active; assert.deepEqual(decode(await releasing), { released: true, server: 'alpha' });
  await a.callTool({ name: 'claim_server', arguments: { server: 'beta' } });
  const disconnected = a.callTool({ name: 'call_tool', arguments: { server: 'beta', tool: 'work', arguments: { mode: 'wait' } } }).catch(() => null); await waitFor(() => registry.gates.has('beta:wait'));
  await a.testTransport.terminateSession(); assert.equal(decode(await b.callTool({ name: 'claim_server', arguments: { server: 'beta' } })).error, 'lease_busy');
  registry.gates.get('beta:wait').resolve();
  assert.deepEqual(await eventuallyClaim(b, 'beta'), { claimed: true, server: 'beta' });
});

test('unknown timeout outcome latches backend globally across disconnect', async () => {
  const { registry, clients: [a, b] } = await setup(); await a.callTool({ name: 'claim_server', arguments: { server: 'alpha' } });
  const timed = a.callTool({ name: 'call_tool', arguments: { server: 'alpha', tool: 'work', arguments: { mode: 'timeout' } } }); await waitFor(() => registry.gates.has('alpha:timeout'));
  registry.gates.get('alpha:timeout').resolve(); assert.equal(decode(await timed).error, 'timeout');
  for (const request of [
    () => a.callTool({ name: 'call_tool', arguments: { server: 'alpha', tool: 'work' } }),
    () => b.callTool({ name: 'claim_server', arguments: { server: 'alpha' } }),
    () => a.callTool({ name: 'release_server', arguments: { server: 'alpha' } })
  ]) assert.equal(decode(await request()).error, 'server_outcome_unknown');
  await a.testTransport.terminateSession(); assert.equal(decode(await b.callTool({ name: 'claim_server', arguments: { server: 'alpha' } })).error, 'server_outcome_unknown');
  assert.equal(registry.calls.filter(call => call.name === 'alpha').length, 1);
});
