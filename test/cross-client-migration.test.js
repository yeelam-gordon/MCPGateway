import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { stopOwnedGateway } from '../src/ensure-gateway.js';
import { prepareClientMigration } from '../src/client-config.js';

const execute = promisify(execFile);
const connectorScript = fileURLToPath(new URL('../tools/connector.mjs', import.meta.url));
const migrationScript = fileURLToPath(new URL('../tools/connect-client.mjs', import.meta.url));
const echoScript = fileURLToPath(new URL('./fixtures/lifecycle-backend.mjs', import.meta.url));
const clientsToMigrate = ['claude', 'vscode', 'opencode', 'qwen', 'kimi', 'antigravity', 'codex'];

function bounded(promise, label, milliseconds = 30_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function nativeDocument(client, entries) {
  if (client === 'codex') {
    const tables = Object.entries(entries).map(([alias, entry]) => [
      `[mcp_servers.${JSON.stringify(alias)}]`,
      `command = ${JSON.stringify(entry.command)}`,
      `args = ${JSON.stringify(entry.args)}`,
      `[mcp_servers.${JSON.stringify(alias)}.env]`,
      ...Object.entries(entry.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    ].join('\n'));
    return `migration_marker = "keep-this-setting"\n\n${tables.join('\n\n')}\n`;
  }
  const collection = client === 'vscode' ? 'servers' : client === 'opencode' ? 'mcp' : 'mcpServers';
  const native = Object.fromEntries(Object.entries(entries).map(([alias, entry]) => [
    alias,
    client === 'opencode'
      ? { type: 'local', command: [entry.command, ...entry.args], environment: entry.env, enabled: true }
      : client === 'vscode' ? { type: 'stdio', ...entry } : entry
  ]));
  return JSON.stringify({ migration_marker: 'keep-this-setting', [collection]: native }, null, 2);
}

async function migrate(client, config, gateway, apply = false) {
  const args = [migrationScript, '--client', client, '--config', config, '--gateway-config', gateway, '--migrate'];
  if (apply) args.push('--apply');
  const result = await execute(process.execPath, args, { timeout: 45_000, windowsHide: true });
  return JSON.parse(result.stdout);
}

test('seven native client formats merge into one catalog and two SDK clients share the imported connection', {
  timeout: 180_000
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'gateway-cross-client-'));
  const stateDir = join(root, 'private state');
  const catalogPath = join(stateDir, 'backends.json');
  const gatewayPath = join(root, 'copilot.json');
  const counterPath = join(root, 'echo-starts.txt');
  const port = await unusedPort();
  const connected = [];
  await mkdir(stateDir);

  t.after(async () => {
    const failures = [];
    for (const client of connected) {
      try { await bounded(client.close(), 'SDK client cleanup', 5_000); }
      catch (error) { failures.push(error); }
    }
    try {
      await access(join(stateDir, 'gateway-instance.json'));
      await bounded(stopOwnedGateway({ stateDir, port, timeoutMs: 5_000 }), 'owned gateway cleanup', 15_000);
    } catch (error) {
      if (error.code !== 'ENOENT') failures.push(error);
    }
    if (failures.length) throw new AggregateError(failures, `Cleanup failed; fixtures retained at ${root}`);
    await rm(root, { recursive: true, force: true });
  });

  const entry = {
    command: process.execPath,
    args: [echoScript],
    env: { COUNTER_FILE: counterPath, SYNTHETIC_SECRET: 'fixture-only-do-not-print' }
  };
  const initialEntries = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`shared-${index}`, entry]));
  await writeFile(catalogPath, JSON.stringify({ catalog_marker: 'preserved', mcpServers: initialEntries }));
  const connector = {
    command: process.execPath,
    args: [connectorScript, '--auto-start', '--config', catalogPath, '--state-dir', stateDir, '--port', String(port)],
    tools: ['*'],
    timeout: 210_000
  };
  await writeFile(gatewayPath, JSON.stringify({ mcpServers: { 'shared-mcp-gateway': connector } }));
  const originalGateway = await readFile(gatewayPath);

  for (const client of clientsToMigrate) {
    const configPath = join(root, `${client}.${client === 'codex' ? 'toml' : 'json'}`);
    const original = nativeDocument(client, {
      'shared-0': entry,
      'added-one': entry,
      'added-two': entry
    });
    await writeFile(configPath, original);
    const beforeCatalog = await readFile(catalogPath);
    const preview = await migrate(client, configPath, gatewayPath);
    assert.equal(JSON.stringify(preview).includes(entry.env.SYNTHETIC_SECRET), false, client);
    assert.equal(await readFile(configPath, 'utf8'), original, `${client}: preview source`);
    assert.deepEqual(await readFile(catalogPath), beforeCatalog, `${client}: preview catalog`);

    await migrate(client, configPath, gatewayPath, true);
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    assert.equal(Object.keys(catalog.mcpServers).length, 12, `${client}: ten plus two, never duplicated`);
    assert.equal(catalog.catalog_marker, 'preserved', client);
    for (const alias of [...Object.keys(initialEntries), 'added-one', 'added-two']) {
      assert.deepEqual(catalog.mcpServers[alias], entry, `${client}: ${alias}`);
    }
    const updated = await readFile(configPath, 'utf8');
    assert.ok(updated.includes('keep-this-setting'), `${client}: unrelated native setting`);
    const repeatedPlan = prepareClientMigration({ client, configText: updated, connector });
    assert.deepEqual(repeatedPlan.backends, { mcpServers: {} }, `${client}: no direct MCP entries remain`);
    assert.equal(repeatedPlan.changed, false, `${client}: correct shared gateway registration`);
    const stableCatalog = await readFile(catalogPath);
    await migrate(client, configPath, gatewayPath, true);
    assert.equal(await readFile(configPath, 'utf8'), updated, `${client}: repeat preserves source bytes`);
    assert.deepEqual(await readFile(catalogPath), stableCatalog, `${client}: repeat preserves catalog bytes`);
    assert.deepEqual(await readFile(gatewayPath), originalGateway, `${client}: source gateway unchanged`);
  }

  for (const name of ['first-agent-proof', 'second-agent-proof']) {
    const client = new Client({ name, version: '1' });
    const transport = new StdioClientTransport({ command: connector.command, args: connector.args, stderr: 'pipe' });
    connected.push(client);
    await bounded(client.connect(transport), `${name} initialization`);
    assert.equal((await bounded(client.listTools(), `${name} tool discovery`)).tools.length, 6);
  }
  const echoResults = [];
  for (const client of connected) {
    const result = await bounded(client.callTool({
      name: 'call_tool',
      arguments: { server: 'added-one', tool: 'echo', arguments: { text: 'shared-import-proof' } }
    }), 'imported echo call');
    assert.notEqual(result.isError, true);
    echoResults.push(JSON.parse(result.content[0].text));
  }
  assert.equal(echoResults[0].text, 'shared-import-proof');
  assert.deepEqual(echoResults[0], echoResults[1]);
  assert.deepEqual((await readFile(counterPath, 'utf8')).trim().split(/\r?\n/).map(Number), [echoResults[0].pid]);
});
