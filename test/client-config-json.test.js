import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CLIENT_CONFIG_DEFAULT_PATHS, extractClientBackends, prepareClientConfig, prepareClientMigration } from '../src/client-config-json.js';
import { assertLiteralClientValues } from '../src/client-config-values.js';

const connector = {
  command: 'C:\\Program Files\\nodejs\\node.exe',
  args: ['D:\\Gateway Runtime\\connector.mjs', '--auto-start', '--config', 'D:\\Private\\backends.json'],
  env: { GATEWAY_MODE: 'shared', OAUTH_CLIENT_ID: '${OAUTH_CLIENT_ID}' },
  timeout: 210000,
  tools: ['list_servers', 'call_tool']
};

const expectedEntries = {
  opencode: {
    type: 'local',
    command: [connector.command, ...connector.args],
    enabled: true,
    environment: connector.env
  },
  qwen: {
    command: connector.command,
    args: connector.args,
    env: connector.env,
    timeout: connector.timeout
  },
  kimi: {
    command: connector.command,
    args: connector.args,
    env: connector.env
  },
  antigravity: {
    command: connector.command,
    args: connector.args,
    env: connector.env
  }
};

for (const client of ['opencode', 'qwen', 'kimi', 'antigravity']) {
  test(`adds only the gateway connector for ${client} and preserves unrelated configuration`, () => {
    const collectionKey = client === 'opencode' ? 'mcp' : 'mcpServers';
    const source = {
      theme: 'dark',
      oauth: { provider: 'existing', tokenVariable: '${EXISTING_OAUTH_TOKEN}' },
      [collectionKey]: {
        other: {
          command: 'other-server',
          args: ['--filter', 'customer-a'],
          env: { OTHER_TOKEN: '${OTHER_TOKEN}' },
          tools: ['search'],
          cwd: 'D:\\Other Backend'
        }
      }
    };
    const result = prepareClientConfig({ client, configText: JSON.stringify(source), connector, configPath: 'config.json' });
    assert.equal(result.changed, true);
    assert.equal(result.updatedText.endsWith('\n'), true);
    assert.equal(result.updatedText, `${JSON.stringify(JSON.parse(result.updatedText), null, 2)}\n`);
    const updated = JSON.parse(result.updatedText);
    assert.deepEqual(updated.theme, source.theme);
    assert.deepEqual(updated.oauth, source.oauth);
    assert.deepEqual(updated[collectionKey].other, source[collectionKey].other);
    assert.deepEqual(updated[collectionKey]['shared-mcp-gateway'], expectedEntries[client]);
    assert.equal(JSON.stringify(updated).includes('owner.token'), false);
    assert.equal(JSON.stringify(updated).includes('Authorization'), false);
    assert.ok(result.warnings.some(value => value.includes('not a client approval or trust grant')));
    assert.equal(result.warnings.some(value => value.includes('timeout')), client !== 'qwen');
  });
}

test('returns the original bytes for a semantically exact existing connector', () => {
  const text = '{\n    "keep": true,\n    "mcpServers": {\n        "shared-mcp-gateway": {\n            "env": {"NESTED": "${UNCHANGED}"},\n            "args": ["connector.mjs", "--flag"],\n            "command": "node"\n        }\n    }\n}\n';
  const result = prepareClientConfig({
    client: 'kimi',
    configText: text,
    connector: { command: 'node', args: ['connector.mjs', '--flag'], env: { NESTED: '${UNCHANGED}' } }
  });
  assert.deepEqual(result, { updatedText: text, changed: false });
});

test('refuses a conflicting gateway alias unless replacement is explicit', () => {
  const text = JSON.stringify({ mcpServers: { 'shared-mcp-gateway': { command: 'user-command', args: [] } }, untouched: true });
  assert.throws(
    () => prepareClientConfig({ client: 'qwen', configText: text, connector: { command: 'node', args: ['connector.mjs'] } }),
    /different settings; refusing to overwrite/
  );
  const replaced = prepareClientConfig({
    client: 'qwen', configText: text, connector: { command: 'node', args: ['connector.mjs'] }, allowReplace: true
  });
  assert.deepEqual(JSON.parse(replaced.updatedText), {
    mcpServers: { 'shared-mcp-gateway': { command: 'node', args: ['connector.mjs'] } },
    untouched: true
  });
});

test('accepts an empty source as an empty object and creates only the client collection', () => {
  assert.deepEqual(JSON.parse(prepareClientConfig({
    client: 'opencode', configText: '', connector: { command: 'node', args: [] }
  }).updatedText), {
    mcp: { 'shared-mcp-gateway': { type: 'local', command: ['node'], enabled: true } }
  });
});

test('rejects comments rather than stripping JSONC and never includes config contents in errors', () => {
  const secret = 'DO_NOT_ECHO_THIS_SECRET';
  assert.throws(
    () => prepareClientConfig({
      client: 'opencode',
      configText: `{\n  // ${secret}\n  "mcp": {}\n}`,
      connector: { command: 'node', args: [] },
      configPath: 'opencode.json'
    }),
    error => /JSONC comments/.test(error.message) && !error.message.includes(secret)
  );
  assert.throws(
    () => prepareClientConfig({ client: 'kimi', configText: `{"secret":"${secret}",`, connector: { command: 'node', args: [] } }),
    error => /invalid JSON/.test(error.message) && !error.message.includes(secret)
  );
});

test('comment markers inside strings remain valid JSON', () => {
  const result = prepareClientConfig({
    client: 'kimi',
    configText: JSON.stringify({ note: 'https://example.test/*not-a-comment*/' }),
    connector: { command: 'node', args: [] }
  });
  assert.equal(JSON.parse(result.updatedText).note, 'https://example.test/*not-a-comment*/');
});

test('validates client, connector, root, and collection shapes without leaking connector values', () => {
  assert.throws(
    () => prepareClientConfig({ client: 'UNKNOWN_SECRET', configText: '{}', connector: { command: 'node', args: [] } }),
    error => /Unsupported client/.test(error.message) && !error.message.includes('UNKNOWN_SECRET')
  );
  assert.throws(() => prepareClientConfig({ client: 'kimi', configText: '[]', connector: { command: 'node', args: [] } }), /root must be a JSON object/);
  assert.throws(() => prepareClientConfig({ client: 'qwen', configText: '{"mcpServers":[]}', connector: { command: 'node', args: [] } }), /mcpServers must be a JSON object/);
  assert.throws(
    () => prepareClientConfig({ client: 'kimi', configText: '{}', connector: { command: 'SECRET_COMMAND', args: null } }),
    error => /array of strings/.test(error.message) && !error.message.includes('SECRET_COMMAND')
  );
  assert.throws(
    () => prepareClientConfig({ client: 'kimi', configText: '{}', connector: { command: 'node', args: ['SECRET_ARGUMENT', 2] } }),
    error => /array of strings/.test(error.message) && !error.message.includes('SECRET_ARGUMENT')
  );
  assert.throws(
    () => prepareClientConfig({ client: 'qwen', configText: '{}', connector: { command: 'node', args: [], timeout: 0 } }),
    /timeout must be a positive integer/
  );
});

test('does not turn gateway tools into client trust, permission, or allowlist settings', () => {
  for (const client of ['opencode', 'qwen', 'kimi', 'antigravity']) {
    const result = prepareClientConfig({ client, configText: '{}', connector });
    const text = result.updatedText;
    assert.equal(text.includes('list_servers'), false);
    assert.equal(text.includes('call_tool'), false);
    assert.equal(text.includes('permission'), false);
    assert.equal(text.includes('trust'), false);
    assert.equal(text.includes('yolo'), false);
  }
});

test('reports only verified default paths and requires an explicit Kimi path', () => {
  assert.deepEqual(CLIENT_CONFIG_DEFAULT_PATHS, {
    opencode: '~/.config/opencode/opencode.json',
    qwen: '~/.qwen/settings.json',
    antigravity: '~/.gemini/config/mcp_config.json'
  });
  assert.equal(Object.hasOwn(CLIENT_CONFIG_DEFAULT_PATHS, 'kimi'), false);
  assert.equal(prepareClientConfig({ client: 'kimi', configText: '{}', connector: { command: 'node', args: [] } }).changed, true);
});

test('extracts OpenCode local and remote entries into validated canonical backends', () => {
  const canonical = extractClientBackends({ client: 'opencode', configText: JSON.stringify({
    ignoredTopLevel: { auth: 'client-only' },
    mcp: {
      local: { type: 'local', command: ['node', 'server.mjs', '--flag'], environment: { TOKEN: 'static-local-token' }, enabled: false },
      remote: { type: 'remote', url: 'https://example.test/mcp', headers: { Authorization: 'static-remote-token' }, enabled: true }
    }
  }) });
  assert.deepEqual(canonical, { mcpServers: {
    local: { type: 'local', command: 'node', args: ['server.mjs', '--flag'], env: { TOKEN: 'static-local-token' }, disabled: true },
    remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'static-remote-token' }, disabled: false }
  } });
});

test('extracts Qwen httpUrl and stdio entries without unrelated settings', () => {
  const canonical = extractClientBackends({ client: 'qwen', configText: JSON.stringify({
    permissions: { yolo: true },
    mcpServers: {
      web: { type: 'http', httpUrl: 'https://qwen.example.test/mcp', headers: { 'X-Tenant': 'one' }, timeout: 30000 },
      local: { type: 'stdio', command: 'node', args: ['qwen.mjs'], env: { MODE: 'safe' }, cwd: 'D:\\Qwen' }
    }
  }) });
  assert.deepEqual(canonical, { mcpServers: {
    web: { url: 'https://qwen.example.test/mcp', headers: { 'X-Tenant': 'one' }, timeout: 30000, type: 'http' },
    local: { command: 'node', args: ['qwen.mjs'], cwd: 'D:\\Qwen', env: { MODE: 'safe' }, type: 'stdio' }
  } });
});

test('extracts Kimi url and Antigravity serverUrl into the same canonical model', () => {
  assert.deepEqual(extractClientBackends({ client: 'kimi', configText: JSON.stringify({ mcpServers: {
    remote: { transport: 'http', url: 'https://kimi.example.test/mcp', headers: { 'X-Key': 'static-key' } }
  } }) }), { mcpServers: {
    remote: { url: 'https://kimi.example.test/mcp', headers: { 'X-Key': 'static-key' }, type: 'http' }
  } });
  assert.deepEqual(extractClientBackends({ client: 'antigravity', configText: JSON.stringify({ mcpServers: {
    remote: { serverUrl: 'https://anti.example.test/mcp', headers: { 'X-Key': 'static-key' } },
    local: { command: 'node', args: ['anti.mjs'], cwd: 'D:\\Anti', env: { MODE: 'shared' }, disabled: true }
  } }) }), { mcpServers: {
    remote: { url: 'https://anti.example.test/mcp', headers: { 'X-Key': 'static-key' } },
    local: { command: 'node', args: ['anti.mjs'], cwd: 'D:\\Anti', env: { MODE: 'shared' }, disabled: true }
  } });
});

test('blocks client-managed auth and tool-filter syntax with alias and field context', () => {
  for (const [client, entry, field] of [
    ['opencode', { type: 'remote', url: 'https://example.test/mcp', oauth: { clientId: 'secret' } }, 'oauth'],
    ['qwen', { command: 'node', args: [], includeTools: ['search'] }, 'includeTools'],
    ['kimi', { command: 'node', args: [], disabledTools: ['write'] }, 'disabledTools'],
    ['antigravity', { serverUrl: 'https://example.test/mcp', authProviderType: 'oauth' }, 'authProviderType']
  ]) {
    assert.throws(
      () => extractClientBackends({ client, configText: JSON.stringify({ [client === 'opencode' ? 'mcp' : 'mcpServers']: { sensitiveAlias: entry } }) }),
      error => error.message.includes(`sensitiveAlias.${field}`) && /client-managed interpretation/.test(error.message) && !error.message.includes('secret')
    );
  }
});

test('rejects unknown MCP fields and unsupported transport aliases instead of approximating them', () => {
  assert.throws(
    () => extractClientBackends({ client: 'qwen', configText: JSON.stringify({ mcpServers: { server: { command: 'node', args: [], magicMode: true } } }) }),
    /server\.magicMode is not supported for canonical extraction/
  );
  assert.throws(
    () => extractClientBackends({ client: 'kimi', configText: JSON.stringify({ mcpServers: { server: { transport: 'sse', url: 'https:\/\/example.test\/sse' } } }) }),
    /transport cannot be represented safely/
  );
});
test('rejects native client variable expansion syntax for every JSON adapter without leaking values', () => {
  const cases = [
    ['opencode', 'mcp', { type: 'local', command: ['node', 'server.mjs'], environment: { TOKEN: '${OPEN_SECRET_TOKEN}' } }],
    ['qwen', 'mcpServers', { command: 'node', args: [], env: { TOKEN: '${env:QWEN_SECRET_TOKEN}' } }],
    ['kimi', 'mcpServers', { command: 'node', args: [], env: { TOKEN: '${KIMI_SECRET_TOKEN}' } }],
    ['antigravity', 'mcpServers', { serverUrl: 'https://example.test/mcp', headers: { Authorization: '${ANTI_SECRET_TOKEN}' } }]
  ];
  for (const [client, collection, entry] of cases) {
    assert.throws(
      () => extractClientBackends({ client, configText: JSON.stringify({ [collection]: { backend: entry } }) }),
      error => /native variable or file-reference syntax/.test(error.message) && !error.message.includes('SECRET_TOKEN')
    );
  }
});

test('rejects OpenCode env and file references recursively while accepting ordinary literal values', () => {
  for (const value of [
    { nested: [{ token: '{env:OPEN_SECRET_TOKEN}' }] },
    { nested: { path: '{file:C:\\private\\secret.txt}' } }
  ]) {
    assert.throws(
      () => assertLiteralClientValues(value, 'opencode'),
      error => /native variable or file-reference syntax/.test(error.message)
        && !error.message.includes('OPEN_SECRET_TOKEN')
        && !error.message.includes('private')
    );
  }
  const literal = {
    url: 'https://example.test/mcp?mode=static',
    command: 'node',
    args: ['script.mjs', '--message', 'ordinary shell text'],
    env: { TOKEN: 'literal-token-value' },
    headers: { Authorization: 'Bearer literal-value' }
  };
  assert.equal(assertLiteralClientValues(literal, 'opencode'), literal);
  assert.equal(assertLiteralClientValues(literal, 'qwen'), literal);
  assert.equal(assertLiteralClientValues(literal, 'kimi'), literal);
  assert.equal(assertLiteralClientValues(literal, 'antigravity'), literal);
});

test('rejects Qwen documented unbraced environment references', () => {
  assert.throws(
    () => assertLiteralClientValues({ env: { TOKEN: '$QWEN_SECRET_TOKEN' } }, 'qwen'),
    error => /native variable or file-reference syntax/.test(error.message) && !error.message.includes('QWEN_SECRET_TOKEN')
  );
});
test('shared literal guard rejects brace references for non-OpenCode clients including Claude', () => {
  for (const value of ['{env:CLAUDE_SECRET_TOKEN}', '{file:C:\\private\\claude-secret.txt}']) {
    assert.throws(
      () => assertLiteralClientValues({ nested: [{ value }] }, 'claude'),
      error => /native variable or file-reference syntax/.test(error.message)
        && !error.message.includes('CLAUDE_SECRET_TOKEN')
        && !error.message.includes('private')
    );
  }
});
test('shared literal guard rejects general braced placeholders for VS Code and Qwen', () => {
  for (const [client, value, forbidden] of [
    ['vscode', '${input:token}', 'input:token'],
    ['qwen', '${workspaceFolder}', 'workspaceFolder']
  ]) {
    assert.throws(
      () => assertLiteralClientValues({ isolated: value }, client),
      error => /native variable or file-reference syntax/.test(error.message) && !error.message.includes(forbidden)
    );
  }
});
test('migration extracts ten native backends and leaves only one matching gateway entry', () => {
  const migrationConnector = { command: 'node', args: ['connector.mjs'], env: { MODE: '${env:GATEWAY_MODE}' } };
  const native = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`backend-${index + 1}`, {
    command: 'node', args: [`backend-${index + 1}.mjs`], env: { MODE: `literal-${index + 1}` }
  }]));
  const source = JSON.stringify({ theme: 'preserved', mcpServers: native });
  const result = prepareClientMigration({ client: 'qwen', configText: source, connector: migrationConnector });
  assert.equal(result.client, 'qwen');
  assert.equal(result.changed, true);
  assert.equal(Object.keys(result.backends.mcpServers).length, 10);
  assert.deepEqual(result.backends.mcpServers['backend-1'], native['backend-1']);
  const updated = JSON.parse(result.updatedText);
  assert.equal(updated.theme, 'preserved');
  assert.deepEqual(Object.keys(updated.mcpServers), ['shared-mcp-gateway']);
  assert.deepEqual(updated.mcpServers['shared-mcp-gateway'], {
    command: migrationConnector.command, args: migrationConnector.args, env: migrationConnector.env
  });
  const rerun = prepareClientMigration({ client: 'qwen', configText: result.updatedText, connector: migrationConnector });
  assert.deepEqual(rerun, { client: 'qwen', changed: false, updatedText: result.updatedText, backends: { mcpServers: {} } });
});

test('migration normalizes and removes native entries for every JSON adapter', () => {
  const migrationConnector = { command: 'node', args: ['connector.mjs'] };
  const cases = [
    ['opencode', 'mcp', { worker: { type: 'local', command: ['node', 'worker.mjs'], enabled: false } }, { type: 'local', command: 'node', args: ['worker.mjs'], disabled: true }],
    ['qwen', 'mcpServers', { worker: { type: 'stdio', command: 'node', args: ['worker.mjs'] } }, { type: 'stdio', command: 'node', args: ['worker.mjs'] }],
    ['kimi', 'mcpServers', { worker: { transport: 'stdio', command: 'node', args: ['worker.mjs'] } }, { command: 'node', args: ['worker.mjs'], type: 'stdio' }],
    ['antigravity', 'mcpServers', { worker: { serverUrl: 'https://example.test/mcp', headers: { Authorization: 'literal' } } }, { url: 'https://example.test/mcp', headers: { Authorization: 'literal' } }]
  ];
  for (const [client, key, servers, expected] of cases) {
    const original = JSON.stringify({ keep: { nested: true }, [key]: servers });
    const result = prepareClientMigration({ client, configText: original, connector: migrationConnector });
    assert.deepEqual(result.backends, { mcpServers: { worker: expected } });
    const updated = JSON.parse(result.updatedText);
    assert.deepEqual(updated.keep, { nested: true });
    assert.deepEqual(Object.keys(updated[key]), ['shared-mcp-gateway']);
    assert.deepEqual(JSON.parse(original), { keep: { nested: true }, [key]: servers });
  }
});

test('migration skips the gateway during extraction and rejects conflicts or unsupported entries', () => {
  const migrationConnector = { command: 'node', args: ['connector.mjs'], env: { TOKEN: '${workspaceFolder}' } };
  const registered = prepareClientConfig({ client: 'kimi', configText: '{}', connector: migrationConnector }).updatedText;
  assert.deepEqual(extractClientBackends({ client: 'kimi', configText: registered }), { mcpServers: {} });
  assert.deepEqual(prepareClientMigration({ client: 'kimi', configText: registered, connector: migrationConnector }), {
    client: 'kimi', changed: false, updatedText: registered, backends: { mcpServers: {} }
  });
  assert.throws(
    () => prepareClientMigration({ client: 'kimi', configText: JSON.stringify({ mcpServers: {
      'shared-mcp-gateway': { command: 'other', args: [] }
    } }), connector: migrationConnector }),
    /different settings; refusing migration/
  );
  assert.throws(
    () => prepareClientMigration({ client: 'qwen', configText: JSON.stringify({ mcpServers: {
      unsupported: { command: 'node', args: [], futureField: true }
    } }), connector: migrationConnector }),
    /futureField is not supported/
  );
});
test('official JSON field semantics are preserved or rejected explicitly', () => {
  const openCode = extractClientBackends({ client: 'opencode', configText: JSON.stringify({ mcp: {
    remote: { type: 'remote', url: 'https://example.test/mcp', headers: { Authorization: 'literal' }, timeout: 45000 }
  } }) });
  assert.equal(openCode.mcpServers.remote.timeout, 45000);
  const kimi = extractClientBackends({ client: 'kimi', configText: JSON.stringify({ mcpServers: {
    worker: { transport: 'stdio', command: 'node', args: [], enabled: false }
  } }) });
  assert.equal(kimi.mcpServers.worker.disabled, true);
  for (const [client, entry, pattern] of [
    ['qwen', { url: 'https://example.test/sse' }, /SSE semantics/],
    ['qwen', { command: 'node', discoveryTimeoutMs: 1000 }, /discoveryTimeoutMs requires client-managed interpretation/],
    ['qwen', { command: 'node', versionNegotiation: true }, /versionNegotiation requires client-managed interpretation/],
    ['kimi', { command: 'node', startupTimeoutMs: 1000 }, /startupTimeoutMs requires client-managed interpretation/],
    ['kimi', { command: 'node', toolTimeoutMs: 2000 }, /toolTimeoutMs requires client-managed interpretation/],
    ['kimi', { command: 'node', deferred: true }, /deferred requires client-managed interpretation/],
    ['kimi', { command: 'node', bearerTokenEnvVar: 'TOKEN' }, /bearerTokenEnvVar requires client-managed interpretation/],
    ['kimi', { command: 'node', executor: 'custom' }, /executor requires client-managed interpretation/],
    ['kimi', { command: 'node', runtime_id: 'runtime' }, /runtime_id requires client-managed interpretation/]
  ]) {
    assert.throws(
      () => extractClientBackends({ client, configText: JSON.stringify({ mcpServers: { worker: entry } }) }),
      pattern
    );
  }
});

test('Qwen migration rejects root allow and exclude policies that would become ineffective', () => {
  const connector = { command: 'node', args: ['connector.mjs'] };
  for (const mcp of [{ allowed: ['worker'] }, { excluded: ['worker'] }]) {
    assert.throws(
      () => prepareClientMigration({ client: 'qwen', configText: JSON.stringify({ mcp, mcpServers: {
        worker: { command: 'node', args: [] }
      } }), connector }),
      /root mcp\.allowed or mcp\.excluded policy/
    );
  }
});
test('OpenCode migration rejects only MCP-applicable root and agent policies', () => {
  const migrationConnector = { command: 'node', args: ['connector.mjs'] };
  const worker = { type: 'local', command: ['node', 'worker.mjs'] };
  const blocked = [
    { permission: { 'payments_*': 'deny' }, mcp: { payments: worker } },
    { permission: { 'payments*': 'deny' }, mcp: { payments: worker } },
    { permission: { 'pay?ents_*': 'deny' }, mcp: { payments: worker } },
    { tools: { 'worker_*': false }, mcp: { worker } },
    { agent: { reviewer: { tools: { 'pay*': false } } }, mcp: { payments: worker } },
    { permission: { '*': 'ask' }, mcp: { worker } },
    { permission: ['unknown-nested-policy'], mcp: { worker } },
    { agent: { reviewer: { permission: { 'worker_*': { nested: 'deny' } } } }, mcp: { worker } },
    { agent: { reviewer: { tools: { '*': false } } }, mcp: { worker } }
  ];
  for (const config of blocked) {
    assert.throws(
      () => prepareClientMigration({ client: 'opencode', configText: JSON.stringify(config), connector: migrationConnector }),
      /permission or tools policy applies to migrated MCP aliases/
    );
  }
  const allowed = prepareClientMigration({ client: 'opencode', configText: JSON.stringify({
    permission: { bash: 'deny', read: 'allow' }, tools: { bash: false },
    agent: { reviewer: { permission: { read: 'allow' }, tools: { bash: false } } },
    mcp: { worker }
  }), connector: migrationConnector });
  assert.deepEqual(Object.keys(allowed.backends.mcpServers), ['worker']);
});

test('reserved aliases survive canonical extraction and migration for all four JSON clients', () => {
  const connector = { command: 'node', args: ['connector.mjs'] };
  const aliases = ['__proto__', 'constructor', 'prototype'];
  const cases = [
    ['opencode', 'mcp', alias => ({ type: 'local', command: ['node', `${alias}.mjs`] })],
    ['qwen', 'mcpServers', alias => ({ command: 'node', args: [`${alias}.mjs`] })],
    ['kimi', 'mcpServers', alias => ({ transport: 'stdio', command: 'node', args: [`${alias}.mjs`] })],
    ['antigravity', 'mcpServers', alias => ({ command: 'node', args: [`${alias}.mjs`] })]
  ];
  for (const [client, key, makeEntry] of cases) {
    const rawEntries = aliases.map(alias => `${JSON.stringify(alias)}:${JSON.stringify(makeEntry(alias))}`).join(',');
    const configText = `{"keep":true,"${key}":{${rawEntries}}}`;
    const result = prepareClientMigration({ client, configText, connector });
    for (const alias of aliases) {
      assert.equal(Object.hasOwn(result.backends.mcpServers, alias), true);
      assert.equal(result.backends.mcpServers[alias].command, 'node');
    }
    const updated = JSON.parse(result.updatedText);
    assert.equal(updated.keep, true);
    assert.deepEqual(Object.keys(updated[key]), ['shared-mcp-gateway']);
    assert.equal({}.polluted, undefined);
  }
});

test('OpenCode local timeout is retained in canonical milliseconds', () => {
  const extracted = extractClientBackends({ client: 'opencode', configText: JSON.stringify({ mcp: {
    worker: { type: 'local', command: ['node', 'worker.mjs'], timeout: 45000 }
  } }) });
  assert.equal(extracted.mcpServers.worker.timeout, 45000);
});

test('actual OpenCode migration apply preserves reserved aliases and blocks applicable policies before writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'json-migration-apply-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDir = join(root, 'state');
  const privatePath = join(stateDir, 'backends.json');
  const gatewayPath = join(root, 'copilot.json');
  const configPath = join(root, 'opencode.json');
  const connectorScript = fileURLToPath(new URL('../tools/connector.mjs', import.meta.url));
  const connector = { command: process.execPath, args: [connectorScript, '--auto-start', '--config', privatePath,
    '--port', '7319', '--state-dir', stateDir], timeout: 210000 };
  const aliases = ['__proto__', 'constructor', 'prototype'];
  const rawEntries = aliases.map(alias => `${JSON.stringify(alias)}:${JSON.stringify({ type: 'local', command: [process.execPath, join(root, `${alias}.mjs`)] })}`).join(',');
  const original = `{"theme":"keep","mcp":{${rawEntries}}}`;
  await mkdir(dirname(privatePath), { recursive: true });
  await writeFile(privatePath, '{"mcpServers":{}}\n');
  await writeFile(gatewayPath, `${JSON.stringify({ mcpServers: { 'shared-mcp-gateway': connector } })}\n`);
  await writeFile(configPath, original);
  const { connectClient } = await import('../src/client-connect.js');
  const fastToken = async directory => {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'owner.token'), 'token\n', { flag: 'wx' }).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
  };
  const options = { client: 'opencode', config: configPath, 'gateway-config': gatewayPath, migrate: true };
  const applied = await connectClient({ ...options, apply: true, tokenLoader: fastToken });
  assert.equal(applied.status, 'synchronized');
  const catalog = JSON.parse(await readFile(privatePath, 'utf8'));
  for (const alias of aliases) assert.equal(Object.hasOwn(catalog.mcpServers, alias), true);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(configPath, 'utf8')).mcp), ['shared-mcp-gateway']);

  const blocked = JSON.stringify({ permission: { 'payments*': 'deny' }, mcp: {
    payments: { type: 'local', command: [process.execPath, join(root, 'payments.mjs')] }
  } });
  await writeFile(configPath, blocked);
  const privateBefore = await readFile(privatePath);
  await assert.rejects(() => connectClient(options), /permission or tools policy applies/);
  assert.equal(await readFile(configPath, 'utf8'), blocked);
  assert.deepEqual(await readFile(privatePath), privateBefore);
  await assert.rejects(() => connectClient({ ...options, apply: true, tokenLoader: fastToken }), /permission or tools policy applies/);
  assert.equal(await readFile(configPath, 'utf8'), blocked);
  assert.deepEqual(await readFile(privatePath), privateBefore);
});
