import { validateConfig } from './config-schema.js';
import { assertLiteralClientValues } from './client-config-values.js';

const GATEWAY_ALIAS = 'shared-mcp-gateway';

export const CLIENT_CONFIG_DEFAULT_PATHS = Object.freeze({
  opencode: '~/.config/opencode/opencode.json',
  qwen: '~/.qwen/settings.json',
  antigravity: '~/.gemini/config/mcp_config.json'
});

const CLIENTS = new Set(['opencode', 'qwen', 'kimi', 'antigravity']);
const CLIENT_MANAGED_FIELDS = new Set([
  'auth', 'authentication', 'authProviderType', 'oauth', 'variables',
  'tools', 'allowedTools', 'disabledTools', 'includeTools', 'includes', 'excludeTools', 'excludes',
  'authProvider', 'bearerTokenEnvVar', 'deferred', 'discoveryTimeoutMs', 'enabledTools',
  'startupTimeoutMs', 'toolTimeoutMs', 'trust', 'versionNegotiation', 'executor', 'runtime_id'
]);
const EXTRACTION_FIELDS = Object.freeze({
  opencode: new Set(['type', 'command', 'environment', 'enabled', 'url', 'headers', 'timeout']),
  qwen: new Set(['type', 'command', 'args', 'cwd', 'env', 'httpUrl', 'headers', 'timeout', 'disabled']),
  kimi: new Set(['transport', 'command', 'args', 'cwd', 'env', 'url', 'headers', 'timeout', 'disabled', 'enabled']),
  antigravity: new Set(['command', 'args', 'cwd', 'env', 'serverUrl', 'headers', 'timeout', 'disabled'])
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function containsJsonComments(text) {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '/' && (text[index + 1] === '/' || text[index + 1] === '*')) return true;
  }
  return false;
}

function assertClient(client) {
  if (!CLIENTS.has(client)) throw new Error('Unsupported client; expected opencode, qwen, kimi, or antigravity');
}

function parseConfig(client, configText, configPath) {
  if (typeof configText !== 'string') throw new TypeError('configText must be a string');
  if (configText.trim() === '') return {};
  if (containsJsonComments(configText)) {
    throw new Error(`${client} config uses JSONC comments, which this adapter does not support; provide strict JSON${configPath ? ` at ${configPath}` : ''}`);
  }
  let config;
  try {
    config = JSON.parse(configText);
  } catch {
    throw new Error(`Cannot parse ${client} client config${configPath ? ` at ${configPath}` : ''}: invalid JSON`);
  }
  if (!isObject(config)) throw new Error(`${client} client config root must be a JSON object`);
  return config;
}

function copyEnvironment(environment) {
  if (environment === undefined) return undefined;
  if (!isObject(environment) || Object.values(environment).some(value => typeof value !== 'string')) {
    throw new TypeError('connector.env must be an object with string values');
  }
  return { ...environment };
}

function validateConnector(connector) {
  if (!isObject(connector)) throw new TypeError('connector must be an object');
  if (typeof connector.command !== 'string' || connector.command.length === 0) {
    throw new TypeError('connector.command must be a non-empty string');
  }
  if (!Array.isArray(connector.args) || connector.args.some(argument => typeof argument !== 'string')) {
    throw new TypeError('connector.args must be an array of strings');
  }
  if (connector.timeout !== undefined && (!Number.isInteger(connector.timeout) || connector.timeout < 1)) {
    throw new TypeError('connector.timeout must be a positive integer');
  }
  return copyEnvironment(connector.env);
}

function entryFor(client, connector, environment) {
  if (client === 'opencode') {
    return {
      type: 'local',
      command: [connector.command, ...connector.args],
      enabled: true,
      ...(environment === undefined ? {} : { environment })
    };
  }
  return {
    command: connector.command,
    args: [...connector.args],
    ...(environment === undefined ? {} : { env: environment }),
    ...(client === 'qwen' && connector.timeout !== undefined ? { timeout: connector.timeout } : {})
  };
}

function collectionFor(client, config) {
  const key = client === 'opencode' ? 'mcp' : 'mcpServers';
  const existing = config[key];
  if (existing !== undefined && !isObject(existing)) {
    throw new Error(`${client} client config ${key} must be a JSON object`);
  }
  return { key, collection: existing ?? {} };
}

function jsonEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonEqual(value, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
}

function warningsFor(client, connector) {
  const warnings = [];
  if (connector.tools !== undefined) {
    warnings.push(`Connector tools were not copied to ${client}; gateway backend filtering is not a client approval or trust grant.`);
  }
  if (client !== 'qwen' && connector.timeout !== undefined) {
    warnings.push(`Connector timeout was not copied because the ${client} adapter has no corresponding supported field.`);
  }
  return warnings;
}

function assertExtractionFields(client, alias, entry) {
  if (!isObject(entry)) throw new Error(`${client} MCP entry ${alias} must be an object`);
  for (const field of Object.keys(entry)) {
    if (client === 'qwen' && field === 'url') {
      throw new Error(`qwen MCP entry ${alias}.url uses SSE semantics and cannot be represented safely in canonical extraction`);
    }
    if (CLIENT_MANAGED_FIELDS.has(field)) {
      throw new Error(`${client} MCP entry ${alias}.${field} requires client-managed interpretation and cannot be extracted automatically`);
    }
    if (!EXTRACTION_FIELDS[client].has(field)) {
      throw new Error(`${client} MCP entry ${alias}.${field} is not supported for canonical extraction`);
    }
  }
  for (const field of ['enabled', 'disabled']) {
    if (entry[field] !== undefined && typeof entry[field] !== 'boolean') {
      throw new Error(`${client} MCP entry ${alias}.${field} must be a boolean`);
    }
  }
}

function commonEntry(entry, urlField) {
  return {
    ...(entry.command === undefined ? {} : { command: entry.command }),
    ...(entry.args === undefined ? {} : { args: entry.args }),
    ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
    ...(entry.env === undefined ? {} : { env: entry.env }),
    ...(entry[urlField] === undefined ? {} : { url: entry[urlField] }),
    ...(entry.headers === undefined ? {} : { headers: entry.headers }),
    ...(entry.timeout === undefined ? {} : { timeout: entry.timeout }),
    ...(entry.disabled === undefined ? {} : { disabled: entry.disabled })
  };
}

function extractOpenCode(alias, entry) {
  if (entry.type !== 'local' && entry.type !== 'remote') {
    throw new Error(`opencode MCP entry ${alias}.type must be documented type local or remote`);
  }
  const disabled = entry.enabled === undefined ? {} : { disabled: !entry.enabled };
  if (entry.type === 'local') {
    if (!Array.isArray(entry.command) || entry.command.length === 0) {
      throw new Error(`opencode MCP entry ${alias}.command must be a non-empty command array for type local`);
    }
    if (entry.url !== undefined || entry.headers !== undefined) {
      throw new Error(`opencode MCP entry ${alias} mixes local command fields with remote URL fields`);
    }
    const [command, ...args] = entry.command;
    return {
      type: 'local', command, args,
      ...(entry.environment === undefined ? {} : { env: entry.environment }),
      ...(entry.timeout === undefined ? {} : { timeout: entry.timeout }),
      ...disabled
    };
  }
  if (entry.command !== undefined || entry.environment !== undefined) {
    throw new Error(`opencode MCP entry ${alias} mixes remote URL fields with local command fields`);
  }
  return { type: 'http', url: entry.url, ...(entry.headers === undefined ? {} : { headers: entry.headers }), ...(entry.timeout === undefined ? {} : { timeout: entry.timeout }), ...disabled };
}

function extractQwen(alias, entry) {
  if (entry.type !== undefined && entry.type !== 'stdio' && entry.type !== 'http') {
    throw new Error(`qwen MCP entry ${alias}.type must be documented type stdio or http`);
  }
  const canonical = commonEntry(entry, 'httpUrl');
  if (entry.type !== undefined) canonical.type = entry.type;
  return canonical;
}

function extractKimi(alias, entry) {
  if (entry.transport !== undefined && entry.transport !== 'stdio' && entry.transport !== 'http') {
    throw new Error(`kimi MCP entry ${alias}.transport cannot be represented safely; only stdio and http are supported`);
  }
  if (entry.enabled !== undefined && entry.disabled !== undefined && entry.disabled === entry.enabled) {
    throw new Error(`kimi MCP entry ${alias} has conflicting enabled and disabled settings`);
  }
  const canonical = commonEntry(entry, 'url');
  if (entry.enabled !== undefined) canonical.disabled = !entry.enabled;
  if (entry.transport !== undefined) canonical.type = entry.transport;
  return canonical;
}

function extractAntigravity(_alias, entry) {
  return commonEntry(entry, 'serverUrl');
}

const EXTRACTORS = Object.freeze({
  opencode: extractOpenCode,
  qwen: extractQwen,
  kimi: extractKimi,
  antigravity: extractAntigravity
});

export function prepareClientConfig({ client, configText, connector, configPath, allowReplace = false } = {}) {
  assertClient(client);
  if (configPath !== undefined && (typeof configPath !== 'string' || configPath.length === 0)) {
    throw new TypeError('configPath must be a non-empty string when provided');
  }
  if (typeof allowReplace !== 'boolean') throw new TypeError('allowReplace must be a boolean');

  const environment = validateConnector(connector);
  const config = parseConfig(client, configText, configPath);
  const { key, collection } = collectionFor(client, config);
  const expected = entryFor(client, connector, environment);
  const existing = collection[GATEWAY_ALIAS];
  const warnings = warningsFor(client, connector);

  if (existing !== undefined && jsonEqual(existing, expected)) {
    return { updatedText: configText, changed: false, ...(warnings.length ? { warnings } : {}) };
  }
  if (existing !== undefined && !allowReplace) {
    throw new Error(`${client} client config already defines ${GATEWAY_ALIAS} with different settings; refusing to overwrite it`);
  }

  const updated = { ...config, [key]: { ...collection, [GATEWAY_ALIAS]: expected } };
  return {
    updatedText: `${JSON.stringify(updated, null, 2)}\n`,
    changed: true,
    ...(warnings.length ? { warnings } : {})
  };
}

function canonicalBackends(client, collection) {
  const entries = [];
  for (const [alias, entry] of Object.entries(collection)) {
    if (alias === GATEWAY_ALIAS) continue;
    if (!alias) throw new Error(`${client} MCP collection contains an empty alias`);
    assertExtractionFields(client, alias, entry);
    assertLiteralClientValues(entry, client);
    entries.push([alias, EXTRACTORS[client](alias, entry)]);
  }
  const canonical = { mcpServers: Object.fromEntries(entries) };
  validateConfig(canonical);
  return canonical;
}

export function extractClientBackends({ client, configText } = {}) {
  assertClient(client);
  const config = parseConfig(client, configText);
  return canonicalBackends(client, collectionFor(client, config).collection);
}

function openCodePolicyMatches(policy, aliases) {
  if (policy === undefined) return false;
  if (!isObject(policy)) return true;
  return Object.keys(policy).some(name => /[*?]/.test(name)
    || aliases.some(alias => name === alias || name.startsWith(`${alias}_`)));
}

function assertOpenCodePolicies(config, aliases) {
  if (openCodePolicyMatches(config.permission, aliases) || openCodePolicyMatches(config.tools, aliases)) {
    throw new Error('opencode root permission or tools policy applies to migrated MCP aliases and cannot be preserved automatically');
  }
  if (!isObject(config.agent)) return;
  for (const agent of Object.values(config.agent)) {
    if (!isObject(agent)) continue;
    if (openCodePolicyMatches(agent.permission, aliases) || openCodePolicyMatches(agent.tools, aliases)) {
      throw new Error('opencode agent permission or tools policy applies to migrated MCP aliases and cannot be preserved automatically');
    }
  }
}

function assertMigrationRootPolicies(client, config, aliases) {
  if (client === 'qwen' && isObject(config.mcp)
      && (Object.hasOwn(config.mcp, 'allowed') || Object.hasOwn(config.mcp, 'excluded'))) {
    throw new Error('qwen root mcp.allowed or mcp.excluded policy affects migrated servers and cannot be preserved automatically');
  }
  if (client === 'opencode') assertOpenCodePolicies(config, aliases);
}
export function prepareClientMigration({ client, configText, connector } = {}) {
  assertClient(client);
  const environment = validateConnector(connector);
  const config = parseConfig(client, configText);
  const { key, collection } = collectionFor(client, config);
  assertMigrationRootPolicies(client, config, Object.keys(collection).filter(alias => alias !== GATEWAY_ALIAS));
  const expected = entryFor(client, connector, environment);
  const existing = collection[GATEWAY_ALIAS];
  if (existing !== undefined && !jsonEqual(existing, expected)) {
    throw new Error(`${client} client config already defines ${GATEWAY_ALIAS} with different settings; refusing migration`);
  }

  const backends = canonicalBackends(client, collection);
  const migratedCollection = { [GATEWAY_ALIAS]: expected };
  if (jsonEqual(collection, migratedCollection)) {
    return { client, changed: false, updatedText: configText, backends };
  }
  const updated = { ...config, [key]: migratedCollection };
  return { client, changed: true, updatedText: `${JSON.stringify(updated, null, 2)}\n`, backends };
}
