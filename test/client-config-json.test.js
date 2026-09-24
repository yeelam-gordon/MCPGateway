import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLIENT_CONFIG_DEFAULT_PATHS, extractClientBackends, prepareClientConfig } from '../src/client-config-json.js';
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

test('reports documented user config paths without performing filesystem access', () => {
  assert.deepEqual(CLIENT_CONFIG_DEFAULT_PATHS, {
    opencode: '~/.config/opencode/opencode.json',
    qwen: '~/.qwen/settings.json',
    kimi: '~/.kimi/mcp.json',
    antigravity: '~/.gemini/config/mcp_config.json'
  });
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
