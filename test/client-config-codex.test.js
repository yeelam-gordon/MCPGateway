import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'smol-toml';
import { extractCodexBackends, prepareCodexMigration } from '../src/client-config-codex.js';

const connector = { command: 'node', args: ['C:\\gateway runtime\\connector.mjs', '--auto-start'] };

function withoutServers(value) {
  const copy = structuredClone(value);
  delete copy.mcp_servers;
  return copy;
}

test('extracts quoted aliases, arrays, literals, enabled state, allowlists, and timeout units', () => {
  const configText = `title = "preserved"\n\n[mcp_servers."quoted.alias"]\ncommand = "node"\nargs = ["server.mjs", "value with spaces"]\nenv = { MODE = "literal" }\nenabled = false\nenabled_tools = ["read", "search"]\ntool_timeout_sec = 1.5\ndisabled_tools = []\n\n[mcp_servers.remote]\nurl = "https://example.test/mcp"\nhttp_headers = { Authorization = "Bearer literal" }\n`;
  assert.deepEqual(extractCodexBackends({ configText }), { mcpServers: {
    'quoted.alias': { command: 'node', type: 'stdio', args: ['server.mjs', 'value with spaces'], env: { MODE: 'literal' }, disabled: true, timeout: 1500, tools: ['read', 'search'] },
    remote: { url: 'https://example.test/mcp', type: 'http', headers: { Authorization: 'Bearer literal' } }
  } });
});

test('prepares migration while preserving all non-MCP TOML data semantically', () => {
  const source = `# comment is intentionally reformatted\r\ntitle = "demo"\r\nquoted = "value"\r\narray = ["one", "two"]\r\n\r\n[profile.deep]\r\nenabled = true\r\nvalues = [1, 2, 3]\r\n\r\n[mcp_servers.worker]\r\ncommand = "node"\r\nargs = ["worker.mjs"]\r\nenv = { MODE = "literal" }\r\n`;
  const before = parse(source, { integersAsBigInt: 'asNeeded' });
  const result = prepareCodexMigration({ configText: source, connector });
  const after = parse(result.updatedText, { integersAsBigInt: 'asNeeded' });
  assert.equal(result.client, 'codex');
  assert.equal(result.changed, true);
  assert.equal(result.updatedText.includes('\r\n'), true);
  assert.deepEqual(withoutServers(after), withoutServers(before));
  assert.deepEqual(after.mcp_servers['shared-mcp-gateway'], connector);
  assert.deepEqual(result.backends, { mcpServers: { worker: { command: 'node', type: 'stdio', args: ['worker.mjs'], env: { MODE: 'literal' } } } });
  assert.match(result.warnings[0], /comments and formatting are regenerated/);
});

test('preserves prototype-like aliases and nested root values safely', () => {
  const source = `root = "safe"\n[nested.table]\nvalue = "kept"\n[mcp_servers."__proto__"]\ncommand = "node"\nargs = ["server.mjs"]\n`;
  const extracted = extractCodexBackends({ configText: source });
  assert.equal(Object.hasOwn(extracted.mcpServers, '__proto__'), true);
  assert.deepEqual(extracted.mcpServers.__proto__, { command: 'node', type: 'stdio', args: ['server.mjs'] });
  const migrated = prepareCodexMigration({ configText: source, connector });
  assert.equal(parse(migrated.updatedText).nested.table.value, 'kept');
});

test('returns original bytes for an exact existing gateway and rejects conflicts', () => {
  const exact = `[mcp_servers.shared-mcp-gateway]\ncommand = "node"\nargs = ["C:\\\\gateway runtime\\\\connector.mjs", "--auto-start"]\n`;
  const same = prepareCodexMigration({ configText: exact, connector });
  assert.deepEqual(same, { client: 'codex', changed: false, updatedText: exact, backends: { mcpServers: {} }, warnings: [] });
  const secret = 'raw-secret-token';
  const conflicting = `[mcp_servers.shared-mcp-gateway]\ncommand = "${secret}"\nargs = []\n`;
  assert.throws(() => prepareCodexMigration({ configText: conflicting, connector }), error => /conflicting/.test(error.message) && !error.message.includes(secret));
});

test('serializes literal connector env into TOML rather than command argv', () => {
  const result = prepareCodexMigration({ configText: '', connector: { command: 'node', args: ['connector.mjs'], env: { REQUIRED: 'literal-value' } } });
  const parsed = parse(result.updatedText);
  assert.deepEqual(parsed.mcp_servers['shared-mcp-gateway'], { command: 'node', args: ['connector.mjs'], env: { REQUIRED: 'literal-value' } });
  assert.equal(parsed.mcp_servers['shared-mcp-gateway'].args.includes('literal-value'), false);
});

test('rejects placeholders, OAuth, forwarded secrets, denylists, approvals, and unknown fields without leaking values', () => {
  const secret = 'raw-secret-token';
  const cases = [
    `env = { TOKEN = "\${${secret}}" }`,
    `url = "https://example.test/mcp"\nauth = "oauth"`,
    `url = "https://example.test/mcp"\nbearer_token_env_var = "${secret}"`,
    `url = "https://example.test/mcp"\nenv_http_headers = { Authorization = "${secret}" }`,
    `command = "node"\ndisabled_tools = ["write"]`,
    `command = "node"\ndefault_tools_approval_mode = "approve"`,
    `command = "node"\nmagic = "${secret}"`
  ];
  for (const fields of cases) {
    const text = `[mcp_servers.server]\n${fields}\n`;
    assert.throws(() => extractCodexBackends({ configText: text }), error => !error.message.includes(secret));
  }
});

test('converts tool timeout seconds but rejects startup-only timeout semantics', () => {
  assert.deepEqual(extractCodexBackends({ configText: '[mcp_servers.server]\ncommand="node"\ntool_timeout_sec=2.5\n' }), {
    mcpServers: { server: { command: 'node', type: 'stdio', timeout: 2500 } }
  });
  assert.throws(
    () => extractCodexBackends({ configText: '[mcp_servers.server]\ncommand="node"\nstartup_timeout_sec=1\n' }),
    /startup-only semantics/
  );
});

test('preserves enabled false and rejects non-empty denylist semantics', () => {
  assert.deepEqual(extractCodexBackends({ configText: '[mcp_servers.server]\ncommand="node"\nenabled=false\ndisabled_tools=[]\n' }), {
    mcpServers: { server: { command: 'node', type: 'stdio', disabled: true } }
  });
  assert.throws(
    () => extractCodexBackends({ configText: '[mcp_servers.server]\ncommand="node"\ndisabled_tools=["write"]\n' }),
    /denylist after enabled_tools/
  );
});

test('rejects alias-scoped root startup policy before migration', () => {
  const text = 'mcp_optional_startup_grace_ms=250\n[mcp_servers.server]\ncommand="node"\n';
  assert.throws(() => extractCodexBackends({ configText: text }), /mcp_optional_startup_grace_ms/);
  assert.throws(() => prepareCodexMigration({ configText: text, connector }), /mcp_optional_startup_grace_ms/);
});

test('malformed TOML errors do not echo source values', () => {
  assert.throws(() => extractCodexBackends({ configText: 'secret = "raw-secret-token"\n[' }), error => /not valid TOML/.test(error.message) && !error.message.includes('raw-secret-token'));
});