import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { exportConfig, importConfig, parseTransferArgs } from '../tools/transfer-config.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))));

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'transfer-config-'));
  roots.push(root);
  return root;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function exported(config) {
  const root = await temporary();
  const source = join(root, 'source.json');
  const output = join(root, 'package');
  await writeJson(source, config);
  const sourceBytes = await readFile(source);
  const result = await exportConfig({ source, output });
  assert.deepEqual(await readFile(source), sourceBytes);
  const template = JSON.parse(await readFile(join(output, 'template.json'), 'utf8'));
  const requirements = JSON.parse(await readFile(join(output, 'requirements.json'), 'utf8'));
  return { root, source, output, result, template, requirements };
}

const sourceConfig = {
  theme: 'dark',
  mcpServers: {
    WorkIQ: {
      command: 'npx',
      args: ['@microsoft/workiq-mcp', '--org', 'explicit-microsoft', '--token=argument-secret', '--config', 'C:\\Users\\person\\private.json'],
      cwd: 'C:\\Users\\person\\gateway',
      env: { TENANT: 'tenant-secret', EMPTY: '' },
      tools: ['search', 'profile'],
      disabled: false
    },
    Remote: {
      type: 'http',
      url: 'https://mcp.example.test/service',
      headers: { Authorization: 'Bearer private', 'X-Custom': 'also-private' },
      tools: ['lookup']
    },
    CredentialUrl: {
      url: 'https://user:password@example.test/mcp?token=query-secret'
    },
    Linux: {
      command: '/home/person/bin/server',
      args: ['--cache=/home/person/cache', '--password', 'separate-secret', '--mode', 'stable-name']
    }
  }
};

test('export redacts credentials and machine paths while preserving aliases, tools, flags, orgs, and ordinary URLs', async () => {
  const item = await exported(sourceConfig);
  assert.equal(item.result.serverCount, 4);
  assert.deepEqual(Object.keys(item.template.config.mcpServers), ['WorkIQ', 'Remote', 'CredentialUrl', 'Linux']);
  const workiq = item.template.config.mcpServers.WorkIQ;
  assert.equal(workiq.command, 'npx');
  assert.match(workiq.args[0], /^\{\{MCP_GATEWAY_VALUE_/);
  assert.deepEqual(workiq.args.slice(1, 3), ['--org', 'explicit-microsoft']);
  assert.match(workiq.args[3], /^\{\{MCP_GATEWAY_VALUE_/);
  assert.equal(workiq.args[4], '--config');
  assert.match(workiq.args[5], /^\{\{MCP_GATEWAY_VALUE_/);
  assert.match(workiq.cwd, /^\{\{MCP_GATEWAY_VALUE_/);
  assert.deepEqual(workiq.tools, ['search', 'profile']);
  assert.equal(workiq.disabled, false);
  assert.equal(item.template.config.mcpServers.Remote.url, 'https://mcp.example.test/service');
  assert.deepEqual(item.template.config.mcpServers.Remote.tools, ['lookup']);
  assert.match(item.template.config.mcpServers.CredentialUrl.url, /^\{\{MCP_GATEWAY_VALUE_/);
  assert.match(item.template.config.mcpServers.Linux.command, /^\{\{MCP_GATEWAY_VALUE_/);
  assert.equal(item.template.config.mcpServers.Linux.args[1], '--password');
  assert.match(item.template.config.mcpServers.Linux.args[2], /^\{\{MCP_GATEWAY_VALUE_/);
  assert.equal(item.template.config.mcpServers.Linux.args[3], '--mode');
  assert.match(item.template.config.mcpServers.Linux.args[4], /^\{\{MCP_GATEWAY_VALUE_/);
  assert.equal(item.template.placeholderCount, item.requirements.length);
});

test('exported package contains no original secret values, hashes, or source machine paths', async () => {
  const item = await exported(sourceConfig);
  const packageText = `${await readFile(join(item.output, 'template.json'), 'utf8')}\n${await readFile(join(item.output, 'requirements.json'), 'utf8')}`;
  for (const forbidden of ['argument-secret', 'person', 'private.json', 'C:\\\\Users\\\\person\\\\gateway', 'tenant-secret', 'oauth-secret',
    'Bearer private', 'also-private', 'user:password', 'query-secret', 'separate-secret']) {
    assert.equal(packageText.includes(forbidden), false, `package leaked ${forbidden}`);
  }
  for (const requirement of item.requirements) {
    assert.deepEqual(Object.keys(requirement), ['id', 'server', 'field', 'reason']);
  }
});

test('import requires every and only requirement value and materializes a normal usable config', async () => {
  const item = await exported(sourceConfig);
  const values = Object.fromEntries(item.requirements.map(requirement => [requirement.id, requirement.field === 'url' ? 'https://restored.example.test/mcp' : `value-for-${requirement.id}`]));
  const valuesPath = join(item.root, 'values.json');
  const destination = join(item.root, 'remote', 'mcp-config.json');
  await writeJson(valuesPath, values);
  const result = await importConfig({ input: item.output, output: destination, values: valuesPath });
  assert.equal(result.materializedValueCount, item.template.placeholderCount);
  const restored = JSON.parse(await readFile(destination, 'utf8'));
  assert.equal(Object.hasOwn(restored, 'format'), false);
  assert.deepEqual(Object.keys(restored.mcpServers), Object.keys(sourceConfig.mcpServers));
  assert.equal(restored.mcpServers.WorkIQ.args[2], 'explicit-microsoft');
  assert.deepEqual(restored.mcpServers.WorkIQ.tools, ['search', 'profile']);
  assert.equal(restored.mcpServers.Remote.url, 'https://mcp.example.test/service');
  const tenantRequirement = item.requirements.find(value => value.server === 'WorkIQ' && value.field === 'env.TENANT');
  assert.equal(restored.mcpServers.WorkIQ.env.TENANT, values[tenantRequirement.id]);
});

test('17-alias config sanitizes absolute Node and Agency adapter paths and restores all aliases', async () => {
  const connectorPath = 'D:\\portable-source\\tools\\connector.mjs';
  const adapterPath = 'D:\\portable-source\\adapters\\agency.json';
  const servers = Object.fromEntries(Array.from({ length: 17 }, (_, index) => {
    const alias = `alias-${index + 1}`;
    if (index === 0) return [alias, {
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [connectorPath, '--adapters', adapterPath, '--org', 'shine-oss'],
      tools: ['profile'],
      disabled: false
    }];
    return [alias, { type: 'http', url: `https://backend-${index + 1}.example.test/mcp`, tools: [`tool-${index + 1}`] }];
  }));
  const source = { mcpServers: servers };
  const item = await exported(source);
  assert.equal(item.result.serverCount, 17);
  assert.equal(Object.keys(item.template.config.mcpServers).length, 17);
  const first = item.template.config.mcpServers['alias-1'];
  assert.match(first.command, /^\{\{MCP_GATEWAY_VALUE_/);
  assert.match(first.args[0], /^\{\{MCP_GATEWAY_VALUE_/);
  assert.equal(first.args[1], '--adapters');
  assert.match(first.args[2], /^\{\{MCP_GATEWAY_VALUE_/);
  assert.deepEqual(first.args.slice(3), ['--org', 'shine-oss']);
  assert.deepEqual(first.tools, ['profile']);
  const packageText = `${JSON.stringify(item.template)}\n${JSON.stringify(item.requirements)}`;
  assert.equal(packageText.includes('Program Files'), false);
  assert.equal(packageText.includes('portable-source'), false);

  const originalValues = {
    command: servers['alias-1'].command,
    'args[0]': connectorPath,
    'args[2]': adapterPath
  };
  const values = Object.fromEntries(item.requirements.map(requirement => [requirement.id, originalValues[requirement.field]]));
  const valuesPath = join(item.root, '17-values.json');
  const outputPath = join(item.root, '17-restored.json');
  await writeJson(valuesPath, values);
  await importConfig({ input: item.output, output: outputPath, values: valuesPath });
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), source);
});

test('transfer preserves explicit server ownership settings and rejects invalid values', async () => {
  const config = { mcpServers: {
    browser: { command: 'node', requiresExclusiveAccess: true, tools: ['navigate'] },
    isolated: { command: 'node', requiresExclusiveAccess: false },
    shared: { command: 'node' }
  } };
  const item = await exported(config);
  assert.equal(item.template.config.mcpServers.browser.requiresExclusiveAccess, true);
  assert.equal(item.template.config.mcpServers.isolated.requiresExclusiveAccess, false);
  assert.equal(Object.hasOwn(item.template.config.mcpServers.shared, 'requiresExclusiveAccess'), false);
  const valuesPath = join(item.root, 'values.json');
  const outputPath = join(item.root, 'restored.json');
  await writeJson(valuesPath, {});
  await importConfig({ input: item.output, output: outputPath, values: valuesPath });
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), config);
  await assert.rejects(
    () => exported({ mcpServers: { browser: { command: 'node', requiresExclusiveAccess: 'true' } } }),
    /requiresExclusiveAccess.*must be a boolean/
  );
});
test('values replace exact value positions without injecting object fields', async () => {
  const item = await exported({ mcpServers: { one: { command: '/opt/private/server', env: { TOKEN: 'secret' } } } });
  const ids = item.requirements.map(value => value.id);
  const valuesPath = join(item.root, 'values.json');
  const destination = join(item.root, 'output.json');
  await writeJson(valuesPath, { [ids[0]]: { injected: true }, [ids[1]]: '{{MCP_GATEWAY_VALUE_9999}}' });
  await assert.rejects(() => importConfig({ input: item.output, output: destination, values: valuesPath }), /command/);
  await assert.rejects(() => stat(destination), error => error.code === 'ENOENT');
});

test('import rejects missing and extra value keys without writing output', async () => {
  const item = await exported({ servers: { one: { command: 'node', env: { TOKEN: 'secret' } } } });
  const id = item.requirements[0].id;
  const destination = join(item.root, 'output.json');
  const missing = join(item.root, 'missing.json');
  const extra = join(item.root, 'extra.json');
  await writeJson(missing, {});
  await writeJson(extra, { [id]: 'replacement', EXTRA: 'not-allowed' });
  await assert.rejects(() => importConfig({ input: item.output, output: destination, values: missing }), /missing: 1, extra: 0/);
  await assert.rejects(() => importConfig({ input: item.output, output: destination, values: extra }), /missing: 0, extra: 1/);
  await assert.rejects(() => stat(destination), error => error.code === 'ENOENT');
});

test('export and import refuse existing destinations', async () => {
  const root = await temporary();
  const source = join(root, 'source.json');
  const output = join(root, 'package');
  await writeJson(source, { mcpServers: { one: { command: 'node' } } });
  await mkdir(output);
  await writeFile(join(output, 'keep.txt'), 'keep');
  await assert.rejects(() => exportConfig({ source, output }), /Refusing to overwrite/);
  assert.equal(await readFile(join(output, 'keep.txt'), 'utf8'), 'keep');

  const fresh = join(root, 'fresh-package');
  await exportConfig({ source, output: fresh });
  const values = join(root, 'values.json');
  const destination = join(root, 'existing.json');
  await writeJson(values, {});
  await writeFile(destination, 'original');
  await assert.rejects(() => importConfig({ input: fresh, output: destination, values }), /Refusing to overwrite/);
  assert.equal(await readFile(destination, 'utf8'), 'original');
});

test('invalid config shape and entries fail before creating export output', async () => {
  const root = await temporary();
  const source = join(root, 'source.json');
  const output = join(root, 'package');
  await writeJson(source, { mcpServers: {}, servers: {} });
  await assert.rejects(() => exportConfig({ source, output }), /exactly one/);
  await writeJson(source, { mcpServers: { broken: { command: 'node', url: 'https://example.test' } } });
  await assert.rejects(() => exportConfig({ source, output }), /exactly one of command or url/);
  await assert.rejects(() => stat(output), error => error.code === 'ENOENT');
});


test('canonical transfer validation rejects invalid runtime fields before creating output', async () => {
  const cases = [
    [{ mcpServers: { bad: { command: 'node', timeout: 0 } } }, /timeout/],
    [{ mcpServers: { bad: { url: 'not a url' } } }, /url/],
    [{ mcpServers: { bad: { command: 'node', env: { TOKEN: 7 } } } }, /env\.TOKEN/],
    [{ mcpServers: { bad: { command: 'node', type: 'remote' } } }, /type/],
    [{ mcpServers: { bad: { command: 'node', unknown: true } } }, /unknown/]
  ];
  for (const [config, pattern] of cases) {
    const root = await temporary();
    const source = join(root, 'source.json');
    const output = join(root, 'package');
    await writeJson(source, config);
    await assert.rejects(() => exportConfig({ source, output }), pattern);
    await assert.rejects(() => stat(output), error => error.code === 'ENOENT');
  }
});

test('typed URL placeholders validate as templates and require a valid materialized URL without echoing it', async () => {
  const item = await exported({ mcpServers: { remote: { type: 'http', url: 'https://user:private@example.test/mcp' } } });
  const requirement = item.requirements.find(value => value.field === 'url');
  assert.ok(requirement);
  const valuesPath = join(item.root, 'values.json');
  const destination = join(item.root, 'output.json');
  await writeJson(valuesPath, { [requirement.id]: 'private-malformed-url' });
  await assert.rejects(() => importConfig({ input: item.output, output: destination, values: valuesPath }), error => {
    assert.match(error.message, /url/);
    assert.equal(error.message.includes('private-malformed-url'), false);
    return true;
  });
  await writeJson(valuesPath, { [requirement.id]: 'https://restored.example.test/mcp' });
  await importConfig({ input: item.output, output: destination, values: valuesPath });
  assert.equal(JSON.parse(await readFile(destination, 'utf8')).mcpServers.remote.url, 'https://restored.example.test/mcp');
});

test('CLI parser is strict for operations, required flags, duplicates, and stray arguments', () => {
  assert.deepEqual(parseTransferArgs(['export', '--source', 'a', '--output', 'b']), { operation: 'export', source: 'a', output: 'b' });
  assert.deepEqual(parseTransferArgs(['import', '--input', 'a', '--output', 'b', '--values', 'c']), { operation: 'import', input: 'a', output: 'b', values: 'c' });
  assert.throws(() => parseTransferArgs(['export', '--source', 'a']), /Usage:/);
  assert.throws(() => parseTransferArgs(['export', '--source', 'a', '--source', 'b', '--output', 'c']), /Usage:/);
  assert.throws(() => parseTransferArgs(['import', '--input', 'a', '--output', 'b', '--values', 'c', 'stray']), /Usage:/);
  assert.throws(() => parseTransferArgs(['preview']), /Usage:/);
});
