const BACKEND_FIELDS = new Set(['disabled', 'type', 'command', 'args', 'cwd', 'env', 'url', 'headers', 'tools', 'timeout', 'requiresExclusiveAccess']);
const TYPES = new Set(['http', 'stdio', 'local']);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function stringMap(value, path) {
  if (!object(value)) fail(path, 'must be an object of strings');
  for (const [key, item] of Object.entries(value)) if (typeof item !== 'string') fail(`${path}.${key}`, 'must be a string');
}

export function validateBackendConfig(value, path = 'server', options = {}) {
  if (!object(value)) fail(path, 'must be an object');
  if (!options.allowUnknown) for (const key of Object.keys(value)) if (!BACKEND_FIELDS.has(key)) fail(`${path}.${key}`, 'is not an approved field');
  if (value.disabled !== undefined && typeof value.disabled !== 'boolean') fail(`${path}.disabled`, 'must be a boolean');
  if (value.requiresExclusiveAccess !== undefined && typeof value.requiresExclusiveAccess !== 'boolean') fail(`${path}.requiresExclusiveAccess`, 'must be a boolean');
  if (value.type !== undefined && (typeof value.type !== 'string' || !TYPES.has(value.type))) fail(`${path}.type`, 'must be one of http, stdio, or local');
  if (value.command !== undefined && (typeof value.command !== 'string' || value.command.length === 0)) fail(`${path}.command`, 'must be a non-empty string');
  if (value.url !== undefined) {
    if (typeof value.url !== 'string' || value.url.length === 0) fail(`${path}.url`, 'must be a valid URL');
    try { new URL(value.url); } catch { fail(`${path}.url`, 'must be a valid URL'); }
  }
  const hasCommand = typeof value.command === 'string' && value.command.length > 0;
  const hasUrl = typeof value.url === 'string' && value.url.length > 0;
  if (hasCommand === hasUrl) fail(path, 'exactly one of command or url is required');
  if (value.type === 'http' && !hasUrl) fail(`${path}.type`, 'http requires url');
  if ((value.type === 'stdio' || value.type === 'local') && !hasCommand) fail(`${path}.type`, `${value.type} requires command`);
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some(item => typeof item !== 'string'))) fail(`${path}.args`, 'must be an array of strings');
  if (value.cwd !== undefined && (typeof value.cwd !== 'string' || value.cwd.length === 0)) fail(`${path}.cwd`, 'must be a non-empty string');
  if (value.env !== undefined) stringMap(value.env, `${path}.env`);
  if (value.headers !== undefined) stringMap(value.headers, `${path}.headers`);
  if (value.tools !== undefined && (!Array.isArray(value.tools) || value.tools.some(item => typeof item !== 'string' || item.length === 0))) fail(`${path}.tools`, 'must be an array of non-empty strings');
  if (value.timeout !== undefined && (!Number.isSafeInteger(value.timeout) || value.timeout <= 0)) fail(`${path}.timeout`, 'must be a positive safe integer');
  return value;
}

export function validateConfig(config, options = {}) {
  if (!object(config)) fail('config', 'must be a JSON object');
  const keys = ['mcpServers', 'servers'].filter(key => Object.hasOwn(config, key));
  if (keys.length !== 1 || !object(config[keys[0]])) fail('config', 'must contain exactly one of mcpServers or servers');
  const key = keys[0];
  for (const [name, entry] of Object.entries(config[key])) {
    if (!name) fail(key, 'server names must be non-empty');
    validateBackendConfig(entry, `${key}.${name}`, options);
  }
  return { key, servers: config[key] };
}
