import { validateConfig } from './config-schema.js';
import { assertLiteralClientValues } from './client-config-values.js';

const GATEWAY_ALIAS = 'shared-mcp-gateway';

export const CLIENT_CONFIG_DEFAULT_PATHS = Object.freeze({
  opencode: '~/.config/opencode/opencode.json',
  qwen: '~/.qwen/settings.json',
  kimi: '~/.kimi/mcp.json',
  antigravity: '~/.gemini/config/mcp_config.json'
});

const CLIENTS = new Set(Object.keys(CLIENT_CONFIG_DEFAULT_PATHS));
const CLIENT_MANAGED_FIELDS = new Set([
  'auth', 'authentication', 'authProviderType', 'oauth', 'variables',
  'tools', 'allowedTools', 'disabledTools', 'includeTools', 'includes', 'excludeTools', 'excludes'
]);
const EXTRACTION_FIELDS = Object.freeze({
  opencode: new Set(['type', 'command', 'environment', 'enabled', 'url', 'headers']),
  qwen: new Set(['type', 'command', 'args', 'cwd', 'env', 'httpUrl', 'headers', 'timeout', 'disabled']),
  kimi: new Set(['transport', 'command', 'args', 'cwd', 'env', 'url', 'headers', 'timeout', 'disabled']),
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
    if (CLIENT_MANAGED_FIELDS.has(field)) {
      throw new Error(`${client} MCP entry ${alias}.${field} requires client-managed interpretation and cannot be extracted automatically`);
    }
    if (!EXTRACTION_FIELDS[client].has(field)) {
      throw new Error(`${client} MCP entry ${alias}.${field} is not supported for canonical extraction`);
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
      ...disabled
    };
  }
  if (entry.command !== undefined || entry.environment !== undefined) {
    throw new Error(`opencode MCP entry ${alias} mixes remote URL fields with local command fields`);
  }
  return { type: 'http', url: entry.url, ...(entry.headers === undefined ? {} : { headers: entry.headers }), ...disabled };
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
  const canonical = commonEntry(entry, 'url');
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

export function extractClientBackends({ client, configText } = {}) {
  assertClient(client);
  const config = parseConfig(client, configText);
  const { collection } = collectionFor(client, config);
  const mcpServers = {};
  for (const [alias, entry] of Object.entries(collection)) {
    if (!alias) throw new Error(`${client} MCP collection contains an empty alias`);
    assertExtractionFields(client, alias, entry);
    assertLiteralClientValues(entry, client);
    mcpServers[alias] = EXTRACTORS[client](alias, entry);
  }
  const canonical = { mcpServers };
  validateConfig(canonical);
  return canonical;
}
