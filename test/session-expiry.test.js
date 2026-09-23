import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createGateway } from '../src/gateway-server.js';
import { GatewayError } from '../src/errors.js';
import { LeaseManager } from '../src/lease-manager.js';

const closers = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });
const decode = response => JSON.parse(response.content[0].text);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function registryFixture() {
  const gate = deferred();
  const started = deferred();
  let waitForGate = false;
  let unknownOutcome = false;
  return {
    gate, started,
    startWaiting() { waitForGate = true; },
    makeUnknown() { unknownOutcome = true; },
    list: () => [{ name: 'exclusive', state: 'idle', requiresExclusiveAccess: true }],
    requiresExclusiveAccess(name) { if (name !== 'exclusive') throw new GatewayError('unknown_server', `Unknown backend: ${name}`); return true; },
    async searchTools() { return { tools: [], note: null }; },
    async getTool() { return { name: 'work', inputSchema: { type: 'object' } }; },
    async callTool() {
      if (waitForGate) { started.resolve(); await gate.promise; }
      if (unknownOutcome) throw Object.assign(new GatewayError('timeout', 'unknown downstream outcome'), { outcomeUnknown: true });
      return { content: [{ type: 'text', text: 'ok' }] };
    },
    async close() {}
  };
}

async function setup(clientCount = 2) {
  const registry = registryFixture();
  const token = 'session-expiry-token';
  const gateway = createGateway({ registry, token, port: 0, sessionIdleTimeoutMs: 60, sessionSweepIntervalMs: 10 });
  const address = await gateway.listen();
  closers.push(() => gateway.close());
  const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
  async function connect(name) {
    const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { authorization: `Bearer ${token}` } } });
    const client = new Client({ name, version: '1' });
    await client.connect(transport);
    client.testTransport = transport;
    closers.push(() => client.close());
    return client;
  }
  const clients = await Promise.all(Array.from({ length: clientCount }, (_, index) => connect(`client-${index + 1}`)));
  return { registry, token, endpoint, connect, clients };
}

async function waitForClaim(client, expectedError = null) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = decode(await client.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } }));
    if (!expectedError && value.claimed) return value;
    if (expectedError && value.error === expectedError) return value;
    await delay(10);
  }
  assert.fail(`claim did not reach ${expectedError ?? 'claimed'} state`);
}

test('expires an orphaned session without DELETE and releases its known lease', async () => {
  const { clients: [orphan, next] } = await setup();
  assert.equal(decode(await orphan.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } })).claimed, true);
  assert.equal(decode(await next.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } })).error, 'lease_busy');
  assert.deepEqual(await waitForClaim(next), { claimed: true, server: 'exclusive' });
});

test('does not expire a session while a backend operation is active', async () => {
  const { registry, connect, clients: [owner] } = await setup(1);
  await owner.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } });
  registry.startWaiting();
  const active = owner.callTool({ name: 'call_tool', arguments: { server: 'exclusive', tool: 'work' } })
    .then(value => ({ value }), error => ({ error }));
  await registry.started.promise;
  await delay(140);
  const next = await connect('late-competitor');
  try {
    assert.equal(decode(await next.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } })).error, 'lease_busy');
  } finally {
    registry.gate.resolve();
  }
  const settled = await active;
  assert.ifError(settled.error);
  assert.equal(settled.value.content[0].text, 'ok');
  assert.deepEqual(await waitForClaim(next), { claimed: true, server: 'exclusive' });
});

test('preserves the global unknown-outcome latch after idle expiry', async () => {
  const { registry, clients: [owner, next] } = await setup();
  await owner.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } });
  registry.makeUnknown();
  assert.equal(decode(await owner.callTool({ name: 'call_tool', arguments: { server: 'exclusive', tool: 'work' } })).error, 'timeout');
  assert.equal((await waitForClaim(next, 'server_outcome_unknown')).error, 'server_outcome_unknown');
});



test('disconnect keeps an active lease until settlement and preserves an unknown outcome', () => {
  const lease = new LeaseManager();
  lease.claim('exclusive', 'owner', true);
  lease.begin('exclusive', 'owner');
  lease.disconnect('owner');
  assert.throws(() => lease.claim('exclusive', 'next', true), error => error.code === 'lease_busy');
  lease.end('exclusive', 'owner', true);
  lease.end('exclusive', 'owner', false);
  assert.throws(() => lease.claim('exclusive', 'next', true), error => error.code === 'server_outcome_unknown');
});

test('explicit disconnect still releases a settled lease immediately', async () => {
  const { clients: [owner, next] } = await setup();
  await owner.callTool({ name: 'claim_server', arguments: { server: 'exclusive' } });
  await owner.close();
  assert.deepEqual(await waitForClaim(next), { claimed: true, server: 'exclusive' });
});
