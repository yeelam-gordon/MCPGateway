import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BackendRegistry } from '../src/backend-registry.js';
import { loadConfig } from '../src/config.js';
import { createGateway } from '../src/gateway-server.js';
import { applyAgencyAdapters } from '../src/agency-adapters.js';

const configPath = process.env.MCP_GATEWAY_LIVE_CONFIG;
const decode = result => {
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return result.structuredContent ?? JSON.parse(result.content[0].text);
};

test('live: two clients discover configured aliases and reuse WebIQ', {
  skip: !configPath,
  timeout: 90_000,
}, async t => {
  const configs = await loadConfig(configPath);
  assert.ok(configs.has('webiq'), 'Live configuration must contain webiq');
  const registry = new BackendRegistry(configs, {
    connectTimeoutMs: 30_000, callTimeoutMs: 20_000, closeTimeoutMs: 3000,
  });
  const token = randomBytes(32).toString('base64url');
  const gateway = createGateway({ registry, token, port: 0 });
  const address = await gateway.listen();
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map(client => client.close()));
    await gateway.close();
  });
  const initializeStarted = performance.now();
  for (const name of ['live-A', 'live-B']) {
    const client = new Client({ name, version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
      { requestInit: { headers: { authorization: `Bearer ${token}` } } },
    ));
    clients.push(client);
  }
  t.diagnostic(`Two gateway clients initialized in ${Math.round(performance.now() - initializeStarted)} ms.`);

  const inventory = decode(await clients[0].callTool({ name: 'list_servers', arguments: {} }));
  assert.deepEqual(
    inventory.servers.map(server => server.name).sort(),
    [...configs.keys()].sort(),
  );
  assert.ok(inventory.servers.every(server => server.state === 'idle'));
  t.diagnostic(`Imported ${inventory.servers.length} aliases without launching backends.`);

  const firstStarted = performance.now();
  const first = decode(await clients[0].callTool({
    name: 'search_tools', arguments: { server: 'webiq' },
  }));
  const firstElapsed = Math.round(performance.now() - firstStarted);
  assert.ok(first.tools.length > 0, 'Wildcard allowlist must expose actual tools');
  const sharedClient = registry.entries.get('webiq').client;
  const secondStarted = performance.now();
  const second = decode(await clients[1].callTool({
    name: 'search_tools', arguments: { server: 'webiq' },
  }));
  t.diagnostic(`WebIQ first discovery ${firstElapsed} ms; shared discovery ${Math.round(performance.now() - secondStarted)} ms.`);
  assert.deepEqual(second.tools, first.tools);
  assert.equal(registry.entries.get('webiq').client, sharedClient);
  const schema = decode(await clients[1].callTool({
    name: 'get_tool_schema',
    arguments: { server: 'webiq', tool: first.tools[0].name },
  }));
  assert.equal(schema.tool.name, first.tools[0].name);
  assert.ok(schema.tool.inputSchema);
  await clients[0].close();
  const afterDisconnect = decode(await clients[1].callTool({
    name: 'search_tools', arguments: { server: 'webiq' },
  }));
  assert.equal(afterDisconnect.tools.length, first.tools.length);
  t.diagnostic(`WebIQ exposes ${first.tools.length} tools; client B survives client A disconnect.`);
});

test('live: unauthenticated M365 endpoint is reported, not treated as connected', {
  skip: !configPath,
  timeout: 60_000,
}, async t => {
  const configs = await loadConfig(configPath);
  assert.ok(configs.has('M365-Profile'));
  const registry = new BackendRegistry(configs, {
    connectTimeoutMs: 30_000, callTimeoutMs: 15_000, closeTimeoutMs: 3000,
  });
  t.after(() => registry.close());
  await assert.rejects(
    () => registry.searchTools('M365-Profile'),
    error => error.code === 'auth_required',
  );
});

const stdioNames = process.env.MCP_GATEWAY_LIVE_STDIO?.split(',').filter(Boolean) ?? [];
for (const name of stdioNames) {
test(`live: ${name} exposes its allowed tools through a shared stdio backend`, {
  skip: !configPath,
  timeout: 90_000,
}, async t => {
  const configs = await loadConfig(configPath);
  assert.ok(configs.get(name)?.command, 'Selected alias must be a configured stdio backend');
  const registry = new BackendRegistry(configs, {
    connectTimeoutMs: 40_000, callTimeoutMs: 30_000, closeTimeoutMs: 3000,
  });
  t.after(() => registry.close());
  const result = await registry.searchTools(name);
  assert.ok(result.tools.length > 0);
  const client = registry.entries.get(name).client;
  await registry.searchTools(name);
  assert.equal(registry.entries.get(name).client, client);
  t.diagnostic(`${name}: ${result.tools.length} tools discovered; backend reused.`);
});
}

test('live: opt-in authenticated adapters preserve configured aliases and allowlists', {
  skip: !configPath || !process.env.MCP_GATEWAY_LIVE_ADAPTERS,
  timeout: 240_000,
}, async t => {
  const original = await loadConfig(configPath);
  const adapted = await applyAgencyAdapters(original, process.env.MCP_GATEWAY_LIVE_ADAPTERS);
  assert.deepEqual([...adapted.keys()], [...original.keys()]);
  const registry = new BackendRegistry(adapted, {
    connectTimeoutMs: 40_000, callTimeoutMs: 30_000, closeTimeoutMs: 3000,
  });
  t.after(() => registry.close());
  const pending = [...adapted].filter(([name, settings]) => (
    settings.command === 'agency' && original.get(name).url
  ));
  assert.ok(pending.length > 0, 'Adapter profile must select at least one HTTP backend');
  const failures = [];
  async function worker() {
    while (pending.length) {
      const [name] = pending.shift();
      try {
        const discovered = await registry.searchTools(name);
        assert.ok(discovered.tools.length > 0, `${name}: tools must not be empty`);
        const allowed = original.get(name).tools;
        if (allowed && !allowed.includes('*')) {
          assert.deepEqual(
            discovered.tools.map(tool => tool.name).sort(),
            [...allowed].sort(),
            `${name}: exactly the originally allowed tools must be exposed`,
          );
        }
        t.diagnostic(`${name}: ${discovered.tools.length} authenticated tools; original allowlist preserved.`);
      } catch (error) {
        failures.push({ server: name, code: error.code ?? error.name });
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  assert.deepEqual(failures, [], 'All explicitly selected live adapters must succeed');
});
