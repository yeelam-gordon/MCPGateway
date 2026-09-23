import { readFile } from 'node:fs/promises';
import { validateConfig } from './config-schema.js';

export function requiresExclusiveAccess(config) {
  return config.requiresExclusiveAccess ?? config.name === 'playwright';
}

export async function loadConfig(path, ownNames = new Set(['shared-mcp-gateway'])) {
  let json;
  try { json = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`Cannot read MCP config ${path}: ${error.message}`, { cause: error }); }
  let collection;
  try { collection = validateConfig(json); }
  catch (error) { throw new Error(`Invalid MCP config ${path}: ${error.message}`, { cause: error }); }
  const backends = new Map();
  for (const [name, settings] of Object.entries(collection.servers)) {
    if (!settings.disabled && !ownNames.has(name)) {
      const { timeout: _nativeClientTimeout, ...backendSettings } = settings;
      backends.set(name, Object.freeze({ name, ...backendSettings }));
    }
  }
  return backends;
}

export function redactedMetadata(config, state) {
  return { name: config.name, transport: config.url ? 'http' : 'stdio', state,
    toolAllowlistConfigured: Array.isArray(config.tools), allowedToolCount: config.tools?.length ?? null,
    requiresExclusiveAccess: requiresExclusiveAccess(config) };
}
