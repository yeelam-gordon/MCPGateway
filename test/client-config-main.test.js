import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codexRegistration, extractMainClientBackends, prepareMainClientConfig } from '../src/client-config-main.js';

const connector = { command: 'node', args: ['C:\\gateway\\connector.mjs', '--name', 'value with spaces'], env: { GATEWAY_MODE: '${env:GATEWAY_MODE}' } };

test('Claude adds one native entry while preserving unrelated root and nested configuration', () => {
  const source = {
    oauthAccount: { scopes: ['profile'] },
    projects: { demo: { mcpServers: { projectOnly: { command: 'project-server' } } } },
    profiles: { work: { allowedTools: ['Read'] } },
    mcpServers: { existing: { command: 'existing', args: [], unknown: true } }
  };
  const result = prepareMainClientConfig({ client: 'claude', configText: JSON.stringify(source), connector });
  const updated = JSON.parse(result.updatedText);
  assert.equal(result.changed, true);
  assert.deepEqual(updated.oauthAccount, source.oauthAccount);
  assert.deepEqual(updated.projects, source.projects);
  assert.deepEqual(updated.profiles, source.profiles);
  assert.deepEqual(updated.mcpServers.existing, source.mcpServers.existing);
  assert.deepEqual(updated.mcpServers['shared-mcp-gateway'], { command: connector.command, args: connector.args, env: connector.env });
  assert.equal(Object.hasOwn(updated.mcpServers['shared-mcp-gateway'], 'allowedTools'), false);
});

test('VS Code preserves inputs, variables, and unknown fields', () => {
  const source = {
    inputs: [{ id: 'token', type: 'promptString', password: true }],
    customSetting: { keep: '${input:token}' },
    servers: { existing: { type: 'stdio', command: '${env:EXISTING_COMMAND}', args: ['${input:token}'], futureField: 42 } }
  };
  const result = prepareMainClientConfig({ client: 'vscode', configText: `${JSON.stringify(source, null, 4)}\n`, connector });
  const updated = JSON.parse(result.updatedText);
  assert.deepEqual(updated.inputs, source.inputs);
  assert.deepEqual(updated.customSetting, source.customSetting);
  assert.deepEqual(updated.servers.existing, source.servers.existing);
  assert.deepEqual(updated.servers['shared-mcp-gateway'], { command: connector.command, args: connector.args, type: 'stdio', env: connector.env });
});

test('JSON client adapters are idempotent and preserve original bytes on rerun', () => {
  for (const client of ['claude', 'vscode']) {
    const first = prepareMainClientConfig({ client, configText: '{}', connector });
    const second = prepareMainClientConfig({ client, configText: first.updatedText, connector });
    assert.equal(second.changed, false);
    assert.equal(second.updatedText, first.updatedText);
    assert.equal(Object.isFrozen(second), true);
  }
});

test('matching alias is accepted but conflicting aliases and target entries fail closed', () => {
  const entry = { command: connector.command, args: connector.args, env: connector.env };
  const matchingAlias = JSON.stringify({ servers: { 'shared-mcp-gateway': entry }, mcpServers: {} });
  const added = prepareMainClientConfig({ client: 'claude', configText: matchingAlias, connector });
  assert.deepEqual(JSON.parse(added.updatedText).mcpServers['shared-mcp-gateway'], entry);

  const conflicting = JSON.stringify({ mcpServers: { 'shared-mcp-gateway': entry }, servers: { 'shared-mcp-gateway': { command: 'other', args: [] } } });
  assert.throws(() => prepareMainClientConfig({ client: 'claude', configText: conflicting, connector }), /conflicting shared-mcp-gateway entries/);
  const occupied = JSON.stringify({ servers: { 'shared-mcp-gateway': { type: 'stdio', command: 'other', args: [] } } });
  assert.throws(() => prepareMainClientConfig({ client: 'vscode', configText: occupied, connector }), /different shared-mcp-gateway entry/);
});

test('JSONC comments are rejected with actionable guidance and no modified output', () => {
  assert.throws(
    () => prepareMainClientConfig({ client: 'vscode', configText: '{\n  // keep this explanation\n  "servers": {}\n}', connector, configPath: 'settings/mcp.json' }),
    error => /JSONC comments/.test(error.message) && /not modified/.test(error.message) && /settings\/mcp\.json/.test(error.message)
  );
  const stringWithSlashes = prepareMainClientConfig({ client: 'claude', configText: '{"url":"https://example.test/*literal*/"}', connector });
  assert.equal(stringWithSlashes.changed, true);
});

test('parse and validation errors never echo config or connector secrets', () => {
  const secret = 'raw-secret-token';
  assert.throws(
    () => prepareMainClientConfig({ client: 'claude', configText: `{"${secret}":`, connector }),
    error => !error.message.includes(secret) && /not a valid JSON object/.test(error.message)
  );
  assert.throws(
    () => prepareMainClientConfig({ client: 'vscode', configText: '{}', connector: { command: 'node', args: [secret], env: { TOKEN: { secret } } } }),
    error => !error.message.includes(secret) && /env/.test(error.message)
  );
});

test('Codex returns a literal argv registration plan without parsing or changing TOML', () => {
  const toml = '[model]\nname = "keep"\n';
  const injection = '$(touch should-not-run); "quoted"';
  const codexConnector = { command: 'node', args: ['connector.mjs', injection] };
  const direct = codexRegistration(codexConnector);
  assert.deepEqual(direct, { command: 'codex', args: ['mcp', 'add', 'shared-mcp-gateway', '--', 'node', 'connector.mjs', injection] });
  assert.equal(Object.isFrozen(direct), true);
  assert.equal(Object.isFrozen(direct.args), true);
  assert.equal(Object.hasOwn(direct, 'owner'), false);

  const plan = prepareMainClientConfig({ client: 'codex', configText: toml, connector: codexConnector, configPath: 'config.toml' });
  assert.equal(plan.updatedText, toml);
  assert.equal(plan.changed, false);
  assert.equal(plan.requiresNativeCli, true);
  assert.deepEqual(plan.registrationCommand, direct);
  assert.match(plan.warnings[0], /does not parse or migrate config\.toml/);
});

test('extracts Claude and VS Code collections into canonical validated backend config', () => {
  const claude = extractMainClientBackends({ client: 'claude', configText: JSON.stringify({
    profile: { keep: true },
    mcpServers: {
      local: { type: 'local', command: 'node', args: ['local.mjs'], env: { MODE: 'safe' } },
      remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer secret' }, unknown: undefined }
    }
  }) });
  assert.deepEqual(claude, { mcpServers: {
    local: { type: 'local', command: 'node', args: ['local.mjs'], env: { MODE: 'safe' } },
    remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer secret' } }
  } });

  const vscode = extractMainClientBackends({ client: 'vscode', configText: JSON.stringify({
    otherTopLevel: 'retained by prepare, irrelevant to extraction',
    servers: { worker: { type: 'stdio', command: 'node', args: ['worker.mjs'], cwd: 'C:\\work' } }
  }) });
  assert.deepEqual(vscode, { mcpServers: { worker: { type: 'stdio', command: 'node', args: ['worker.mjs'], cwd: 'C:\\work' } } });
});

test('extraction preserves unknown backend fields for schema rejection instead of dropping them', () => {
  assert.throws(
    () => extractMainClientBackends({ client: 'claude', configText: JSON.stringify({ mcpServers: { worker: { command: 'node', args: [], futureSecretField: 'raw-secret-token' } } }) }),
    error => /not an approved field/.test(error.message) && !error.message.includes('raw-secret-token')
  );
});

test('VS Code extraction explicitly rejects client-managed variables, OAuth, trust, and SSE', () => {
  const unsupported = [
    { command: '${env:COMMAND}', args: ['${input:token}'] },
    { type: 'http', url: 'https://example.test/mcp', oauth: { clientId: 'raw-secret-token' } },
    { command: 'node', args: [], alwaysAllow: ['tool'] },
    { type: 'sse', url: 'https://example.test/sse' },
    { type: 'http', url: 'https://example.test/oauth-capable' }
  ];
  for (const entry of unsupported) assert.throws(
    () => extractMainClientBackends({ client: 'vscode', configText: JSON.stringify({ inputs: [{ id: 'token' }], servers: { worker: entry } }) }),
    error => /keep this server client-managed/.test(error.message) && !error.message.includes('raw-secret-token')
  );
});

test('extraction rejects conflicting aliases, invalid values, and Codex TOML without leaking values', () => {
  assert.throws(
    () => extractMainClientBackends({ client: 'claude', configText: JSON.stringify({ mcpServers: { one: { command: 'node' } }, servers: { two: { command: 'other' } } }) }),
    /conflicting MCP server collections/
  );
  assert.throws(
    () => extractMainClientBackends({ client: 'vscode', configText: JSON.stringify({ servers: { 'raw-secret-token': { command: '', env: { TOKEN: 'raw-secret-token' } } } }) }),
    error => /Invalid vscode MCP backend config/.test(error.message) && !error.message.includes('raw-secret-token')
  );
  assert.throws(
    () => extractMainClientBackends({ client: 'codex', configText: '[mcp_servers.secret]' }),
    error => /config\.toml is TOML/.test(error.message) && /codexRegistration/.test(error.message) && !error.message.includes('secret')
  );
});

test('VS Code extraction permits HTTP only with explicit static headers', () => {
  const extracted = extractMainClientBackends({ client: 'vscode', configText: JSON.stringify({ servers: {
    remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer literal-value' } }
  } }) });
  assert.deepEqual(extracted, { mcpServers: {
    remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer literal-value' } }
  } });
});

test('Claude extraction rejects client placeholders without exposing their contents', () => {
  for (const placeholder of ['${RAW_SECRET}', '${env:RAW_SECRET}', '{env:RAW_SECRET}', '{file:secret-path}']) {
    assert.throws(
      () => extractMainClientBackends({ client: 'claude', configText: JSON.stringify({ mcpServers: {
        remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: placeholder } }
      } }) }),
      error => /literal values/.test(error.message) && !error.message.includes('RAW_SECRET') && !error.message.includes('secret-path')
    );
  }
});

test('Claude extraction accepts literal environment and header values', () => {
  const extracted = extractMainClientBackends({ client: 'claude', configText: JSON.stringify({ mcpServers: {
    local: { type: 'stdio', command: 'node', args: ['server.mjs'], env: { MODE: 'literal-value' } },
    remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer literal-value' } }
  } }) });
  assert.equal(extracted.mcpServers.local.env.MODE, 'literal-value');
  assert.equal(extracted.mcpServers.remote.headers.Authorization, 'Bearer literal-value');
});

test('Codex rejects non-empty connector env instead of silently dropping it', () => {
  assert.throws(
    () => codexRegistration({ command: 'node', args: ['connector.mjs'], env: { REQUIRED: 'raw-secret-token' } }),
    error => /does not support connector env/.test(error.message) && !error.message.includes('raw-secret-token')
  );
  assert.deepEqual(codexRegistration({ command: 'node', args: ['connector.mjs'], env: {} }), {
    command: 'codex', args: ['mcp', 'add', 'shared-mcp-gateway', '--', 'node', 'connector.mjs']
  });
});