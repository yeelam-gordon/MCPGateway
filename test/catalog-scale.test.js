import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BackendRegistry } from '../src/backend-registry.js';
import { createGateway } from '../src/gateway-server.js';

test('1,000 backend tools remain behind six gateway tools and focused discovery', { timeout: 10_000 }, async t => {
  const tools = Array.from({ length: 1000 }, (_, index) => ({
    name: `tool_${String(index).padStart(4, '0')}`,
    description: `Synthetic capability ${index}`,
    inputSchema: {
      type: 'object',
      properties: { input: { type: 'string' } },
      required: ['input']
    }
  }));
  const registry = new BackendRegistry(new Map([
    ['catalog', { name: 'catalog', command: 'not-launched', tools: ['*'] }]
  ]));
  let discoveryCalls = 0;
  let executed = 0;
  const backend = {
    async listTools() { discoveryCalls += 1; return { tools }; },
    async callTool(params) {
      executed += 1;
      assert.equal(params.name, 'tool_0999');
      return { content: [{ type: 'text', text: params.arguments.input }] };
    },
    async close() {}
  };
  registry.entries.set('catalog', {
    state: 'ready', client: backend, transport: null, tools: null,
    connecting: null, closing: null, retireScheduled: null
  });
  const token = 'synthetic-scale-test-token';
  const gateway = createGateway({ registry, token, port: 0 });
  const address = await gateway.listen();
  const clients = [];
  const transports = [];
  t.after(async () => {
    for (const transport of transports) await transport.terminateSession();
    await Promise.all(clients.map(client => client.close()));
    await gateway.close();
  });
  for (const name of ['scale-A', 'scale-B']) {
    const client = new Client({ name, version: '1' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
      { requestInit: { headers: { authorization: `Bearer ${token}` } } }
    );
    transports.push(transport);
    clients.push(client);
    await client.connect(transport);
  }
  const surface = await clients[0].listTools();
  assert.deepEqual(surface.tools.map(tool => tool.name).sort(), [
    'call_tool', 'claim_server', 'get_tool_schema', 'list_servers', 'release_server', 'search_tools'
  ]);
  assert.equal(discoveryCalls, 0);

  const decode = result => {
    assert.notEqual(result.isError, true, result.content?.[0]?.text);
    return result.structuredContent ?? JSON.parse(result.content[0].text);
  };
  const coldStarted = performance.now();
  const first = decode(await clients[0].callTool({
    name: 'search_tools', arguments: { server: 'catalog', query: 'tool_0999' }
  }));
  const coldMs = performance.now() - coldStarted;
  assert.equal(first.tools.length, 1);
  assert.equal(first.tools[0].name, 'tool_0999');
  assert.equal(Object.hasOwn(first.tools[0], 'inputSchema'), false);
  const warmStarted = performance.now();
  const second = decode(await clients[1].callTool({
    name: 'search_tools', arguments: { server: 'catalog', query: 'tool_0999' }
  }));
  const warmMs = performance.now() - warmStarted;
  assert.equal(second.tools.length, 1);
  assert.equal(discoveryCalls, 1);
  const selected = decode(await clients[1].callTool({
    name: 'get_tool_schema', arguments: { server: 'catalog', tool: 'tool_0999' }
  }));
  assert.deepEqual(selected.tool.inputSchema, tools[999].inputSchema);
  const called = await clients[1].callTool({
    name: 'call_tool',
    arguments: { server: 'catalog', tool: 'tool_0999', arguments: { input: 'ok' } }
  });
  assert.equal(called.content[0].text, 'ok');
  assert.equal(executed, 1);
  t.diagnostic(`Synthetic 1,000-tool catalog: cold search ${coldMs.toFixed(1)} ms; warm search ${warmMs.toFixed(1)} ms. Not a live-service benchmark.`);
});
