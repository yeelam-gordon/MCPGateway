import { parse, stringify } from 'smol-toml';
import { validateConfig } from './config-schema.js';
import { assertLiteralClientValues } from './client-config-values.js';

const GATEWAY_NAME = 'shared-mcp-gateway';
const SUPPORTED_FIELDS = new Set([
  'command', 'args', 'env', 'cwd', 'url', 'http_headers', 'enabled',
  'startup_timeout_sec', 'tool_timeout_sec', 'enabled_tools', 'disabled_tools'
]);
const CLIENT_MANAGED_FIELDS = new Set([
  'env_vars', 'experimental_environment', 'auth', 'bearer_token_env_var',
  'env_http_headers', 'http_headers_helper', 'required',
  'default_tools_approval_mode', 'tools', 'oauth'
]);
const REFORMAT_WARNING = 'Codex TOML comments and formatting are regenerated; non-MCP configuration is preserved semantically.';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message) {
  throw new Error(message);
}

function parseConfig(configText) {
  if (typeof configText !== 'string') throw new TypeError('configText must be a string');
  try {
    const config = parse(configText, { integersAsBigInt: 'asNeeded' });
    if (!object(config)) throw new Error();
    return config;
  } catch {
    throw new Error('Codex config is not valid TOML; no configuration was changed.');
  }
}

function assertStringMap(value, field) {
  if (!object(value) || Object.values(value).some(item => typeof item !== 'string'))
    fail(`Codex MCP ${field} must contain only string values.`);
}

function timeoutMilliseconds(entry) {
  if (entry.startup_timeout_sec !== undefined) {
    if (typeof entry.startup_timeout_sec !== 'number' || !Number.isFinite(entry.startup_timeout_sec) || entry.startup_timeout_sec <= 0)
      fail('Codex MCP startup_timeout_sec must be a positive finite number.');
    fail('Codex MCP startup_timeout_sec has startup-only semantics that cannot be represented by the canonical tool timeout.');
  }
  if (entry.tool_timeout_sec === undefined) return undefined;
  if (typeof entry.tool_timeout_sec !== 'number' || !Number.isFinite(entry.tool_timeout_sec) || entry.tool_timeout_sec <= 0)
    fail('Codex MCP tool_timeout_sec must be a positive finite number.');
  const milliseconds = entry.tool_timeout_sec * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0)
    fail('Codex MCP tool_timeout_sec cannot be represented safely in canonical milliseconds.');
  return milliseconds;
}

function normalizeEntry(entry) {
  if (!object(entry)) fail('Codex MCP server entries must be tables.');
  try { assertLiteralClientValues(entry, 'codex'); }
  catch { fail('Codex MCP server uses native variable or file references that cannot be migrated safely.'); }
  for (const field of Object.keys(entry)) {
    if (CLIENT_MANAGED_FIELDS.has(field))
      fail(`Codex MCP field ${field} requires client-managed semantics and cannot be migrated.`);
    if (!SUPPORTED_FIELDS.has(field))
      fail(`Codex MCP field ${field} is not supported for canonical migration.`);
  }

  const hasCommand = entry.command !== undefined;
  const hasUrl = entry.url !== undefined;
  if (hasCommand === hasUrl) fail('Codex MCP server must define exactly one of command or url.');
  const canonical = {};
  if (hasCommand) {
    if (typeof entry.command !== 'string' || entry.command.length === 0)
      fail('Codex MCP command must be a non-empty string.');
    canonical.command = entry.command;
    canonical.type = 'stdio';
    if (entry.args !== undefined) {
      if (!Array.isArray(entry.args) || entry.args.some(item => typeof item !== 'string'))
        fail('Codex MCP args must be an array of strings.');
      canonical.args = [...entry.args];
    }
    if (entry.env !== undefined) { assertStringMap(entry.env, 'env'); canonical.env = { ...entry.env }; }
    if (entry.cwd !== undefined) {
      if (typeof entry.cwd !== 'string' || entry.cwd.length === 0) fail('Codex MCP cwd must be a non-empty string.');
      canonical.cwd = entry.cwd;
    }
    if (entry.http_headers !== undefined) fail('Codex stdio MCP servers cannot define HTTP headers.');
  } else {
    if (typeof entry.url !== 'string' || entry.url.length === 0) fail('Codex MCP url must be a non-empty URL.');
    canonical.url = entry.url;
    canonical.type = 'http';
    if (entry.http_headers !== undefined) { assertStringMap(entry.http_headers, 'http_headers'); canonical.headers = { ...entry.http_headers }; }
    if (entry.args !== undefined || entry.env !== undefined || entry.cwd !== undefined)
      fail('Codex HTTP MCP servers cannot define stdio process fields.');
  }
  if (entry.enabled !== undefined) {
    if (typeof entry.enabled !== 'boolean') fail('Codex MCP enabled must be a boolean.');
    canonical.disabled = !entry.enabled;
  }
  const timeout = timeoutMilliseconds(entry);
  if (timeout !== undefined) canonical.timeout = timeout;
  if (entry.enabled_tools !== undefined) {
    if (!Array.isArray(entry.enabled_tools) || entry.enabled_tools.some(item => typeof item !== 'string' || item.length === 0))
      fail('Codex MCP enabled_tools must be an array of non-empty strings.');
    canonical.tools = [...entry.enabled_tools];
  }
  if (entry.disabled_tools !== undefined) {
    if (!Array.isArray(entry.disabled_tools) || entry.disabled_tools.some(item => typeof item !== 'string' || item.length === 0))
      fail('Codex MCP disabled_tools must be an array of non-empty strings.');
    if (entry.disabled_tools.length > 0)
      fail('Codex MCP disabled_tools applies a denylist after enabled_tools and cannot be represented canonically.');
  }
  return canonical;
}

function nativeServers(config) {
  if (config.mcp_servers === undefined) return Object.create(null);
  if (!object(config.mcp_servers)) fail('Codex mcp_servers must be a TOML table.');
  return config.mcp_servers;
}

function assertRootPolicies(config, servers) {
  const migratingAliases = Object.keys(servers).filter(name => name !== GATEWAY_NAME);
  if (migratingAliases.length > 0 && Object.hasOwn(config, 'mcp_optional_startup_grace_ms'))
    fail('Codex root field mcp_optional_startup_grace_ms would no longer apply per migrated alias behind the gateway.');
}
function validateCanonical(entries) {
  const validationEntries = Object.fromEntries(entries.map(([, entry], index) => [`server-${index + 1}`, entry]));
  try { validateConfig({ mcpServers: validationEntries }); }
  catch (error) { fail(`Invalid canonical Codex backend config: ${error.message}`); }
}

function extractEntries(config, excludeGateway) {
  const entries = [];
  for (const [name, entry] of Object.entries(nativeServers(config))) {
    if (!name) fail('Codex MCP server names must be non-empty.');
    if (excludeGateway && name === GATEWAY_NAME) continue;
    entries.push([name, normalizeEntry(entry)]);
  }
  validateCanonical(entries);
  return { mcpServers: Object.fromEntries(entries) };
}

function connectorEntry(connector) {
  if (!object(connector) || typeof connector.command !== 'string' || connector.command.length === 0)
    fail('Connector must provide a non-empty command.');
  if (!Array.isArray(connector.args) || connector.args.some(item => typeof item !== 'string'))
    fail('Connector args must be an array of strings.');
  if (connector.env !== undefined) assertStringMap(connector.env, 'connector env');
  try { assertLiteralClientValues(connector, 'codex'); }
  catch { fail('Connector uses native variable or file references that cannot be serialized safely.'); }
  return {
    command: connector.command,
    args: [...connector.args],
    ...(connector.env !== undefined && Object.keys(connector.env).length > 0 ? { env: { ...connector.env } } : {})
  };
}

function equal(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => equal(item, right[index]));
  if (!object(left) || !object(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

function serialize(config, configText) {
  try {
    const text = stringify(config);
    return configText.includes('\r\n') ? text.replaceAll('\n', '\r\n') : text;
  } catch {
    fail('Codex config could not be serialized safely; no configuration was changed.');
  }
}

export function extractCodexBackends({ configText } = {}) {
  const config = parseConfig(configText);
  const servers = nativeServers(config);
  assertRootPolicies(config, servers);
  return extractEntries(config, true);
}

export function prepareCodexMigration({ client = 'codex', configText, connector } = {}) {
  if (client !== 'codex') fail('prepareCodexMigration supports only the codex client.');
  const config = parseConfig(configText);
  const servers = nativeServers(config);
  assertRootPolicies(config, servers);
  const desired = connectorEntry(connector);
  const existing = servers[GATEWAY_NAME];
  if (existing !== undefined && !equal(existing, desired))
    fail('Codex config already contains a conflicting shared-mcp-gateway entry; no configuration was changed.');
  const backends = extractEntries(config, true);
  const alreadyMigrated = Object.keys(servers).length === 1 && existing !== undefined && equal(existing, desired);
  if (alreadyMigrated) return { client: 'codex', changed: false, updatedText: configText, backends, warnings: [] };

  const replacement = Object.create(null);
  replacement[GATEWAY_NAME] = desired;
  config.mcp_servers = replacement;
  return {
    client: 'codex',
    changed: true,
    updatedText: serialize(config, configText),
    backends,
    warnings: [REFORMAT_WARNING]
  };
}