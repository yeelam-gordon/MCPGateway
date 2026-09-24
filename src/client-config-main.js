import { validateConfig } from './config-schema.js';
import { assertLiteralClientValues } from './client-config-values.js';

const GATEWAY_NAME = 'shared-mcp-gateway';
const SUPPORTED_CLIENTS = new Set(['claude', 'vscode', 'codex']);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizedError(message) {
  return new Error(message);
}

function connectorEntry(connector, includeType) {
  if (!plainObject(connector) || typeof connector.command !== 'string' || connector.command.length === 0)
    throw sanitizedError('Connector must provide a non-empty command');
  if (!Array.isArray(connector.args) || connector.args.some(argument => typeof argument !== 'string'))
    throw sanitizedError('Connector args must be an array of strings');
  if (connector.env !== undefined && (!plainObject(connector.env) || Object.values(connector.env).some(value => typeof value !== 'string')))
    throw sanitizedError('Connector env must contain only string values');

  const entry = { command: connector.command, args: [...connector.args] };
  if (includeType) entry.type = 'stdio';
  if (connector.env !== undefined) entry.env = { ...connector.env };
  return entry;
}

function hasJsonComments(text) {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '/' && (text[index + 1] === '/' || text[index + 1] === '*')) return true;
  }
  return false;
}

function parseConfig(configText, client, configPath) {
  if (typeof configText !== 'string') throw sanitizedError('Client config text must be a string');
  if (hasJsonComments(configText)) {
    const location = configPath ? ` at ${configPath}` : '';
    throw sanitizedError(`${client} config${location} contains JSONC comments; remove comments or use a JSONC-aware editor, then retry. The config was not modified.`);
  }
  try {
    const parsed = JSON.parse(configText || '{}');
    if (!plainObject(parsed)) throw new Error();
    return parsed;
  } catch {
    throw sanitizedError(`${client} config is not a valid JSON object; the config was not modified.`);
  }
}

function structurallyEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => structurallyEqual(value, right[index]));
  if (!plainObject(left) || !plainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && structurallyEqual(left[key], right[key]));
}

function prepareJsonConfig({ client, configText, connector, configPath }) {
  const collectionKey = client === 'claude' ? 'mcpServers' : 'servers';
  const aliasKey = client === 'claude' ? 'servers' : 'mcpServers';
  const config = parseConfig(configText, client, configPath);
  if (config[collectionKey] !== undefined && !plainObject(config[collectionKey]))
    throw sanitizedError(`${client} config ${collectionKey} must be an object; the config was not modified.`);
  if (config[aliasKey] !== undefined && !plainObject(config[aliasKey]))
    throw sanitizedError(`${client} config ${aliasKey} must be an object; the config was not modified.`);

  const expected = connectorEntry(connector, client === 'vscode');
  const nativeEntry = config[collectionKey]?.[GATEWAY_NAME];
  const aliasEntry = config[aliasKey]?.[GATEWAY_NAME];
  if (nativeEntry !== undefined && aliasEntry !== undefined && !structurallyEqual(nativeEntry, aliasEntry))
    throw sanitizedError(`${client} config contains conflicting ${GATEWAY_NAME} entries; the config was not modified.`);
  const existing = nativeEntry ?? aliasEntry;
  if (existing !== undefined && !structurallyEqual(existing, expected))
    throw sanitizedError(`${client} config already contains a different ${GATEWAY_NAME} entry; the config was not modified.`);
  if (nativeEntry !== undefined && structurallyEqual(nativeEntry, expected))
    return Object.freeze({ updatedText: configText, changed: false });

  const updated = {
    ...config,
    [collectionKey]: { ...(config[collectionKey] ?? {}), [GATEWAY_NAME]: expected }
  };
  return Object.freeze({ updatedText: `${JSON.stringify(updated, null, 2)}\n`, changed: true });
}

function unsupportedVsCodeFeature(entry) {
  const runtimeFields = ['envFile', 'dev', 'sandbox', 'sandboxEnabled'];
  if (runtimeFields.some(field => Object.hasOwn(entry, field))) return 'client-managed environment or sandbox settings';
  const oauthFields = ['auth', 'authentication', 'authorization', 'oauth'];
  if (oauthFields.some(field => Object.hasOwn(entry, field))) return 'client-managed authentication or OAuth';
  const trustFields = ['alwaysAllow', 'autoApprove', 'trust', 'trusted'];
  if (trustFields.some(field => Object.hasOwn(entry, field))) return 'client-managed trust or approval settings';
  if (entry.type === 'sse') return 'the SSE transport';
  if (typeof entry.url === 'string' && entry.headers === undefined) return 'HTTP servers without explicit static headers because they may rely on client-managed OAuth';
  return null;
}

function nativeCollection(config, client) {
  const collectionKey = client === 'claude' ? 'mcpServers' : 'servers';
  const aliasKey = client === 'claude' ? 'servers' : 'mcpServers';
  if (config[collectionKey] !== undefined && !plainObject(config[collectionKey]))
    throw sanitizedError(`${client} config ${collectionKey} must be an object; no backends were extracted.`);
  if (config[aliasKey] !== undefined && !plainObject(config[aliasKey]))
    throw sanitizedError(`${client} config ${aliasKey} must be an object; no backends were extracted.`);
  if (config[collectionKey] === undefined && config[aliasKey] === undefined)
    throw sanitizedError(`${client} config does not contain an MCP server collection; no backends were extracted.`);
  if (config[collectionKey] !== undefined && config[aliasKey] !== undefined && !structurallyEqual(config[collectionKey], config[aliasKey]))
    throw sanitizedError(`${client} config contains conflicting MCP server collections; no backends were extracted.`);
  return config[collectionKey] ?? config[aliasKey];
}

function canonicalMainBackends(client, servers) {
  const entries = Object.entries(servers).filter(([name]) => name !== GATEWAY_NAME);
  for (const [, entry] of entries) {
    try { assertLiteralClientValues(entry, client); }
    catch { throw sanitizedError(`${client} backend extraction requires literal values; native variable and file references are unsupported, so keep this server client-managed.`); }
    if (client !== 'vscode' || !plainObject(entry)) continue;
    const unsupported = unsupportedVsCodeFeature(entry);
    if (unsupported) throw sanitizedError(`VS Code backend extraction does not support ${unsupported}; keep this server client-managed.`);
  }
  if (entries.some(([name]) => name === '')) throw sanitizedError('Invalid client MCP backend config: server names must be non-empty');
  const canonical = { mcpServers: Object.fromEntries(entries.map(([name, entry]) => [name, plainObject(entry) ? { ...entry } : entry])) };
  const validationNames = Object.fromEntries(Object.values(canonical.mcpServers).map((entry, index) => [`server-${index + 1}`, entry]));
  try { validateConfig({ mcpServers: validationNames }); }
  catch (error) { throw sanitizedError(`Invalid ${client} MCP backend config: ${error.message}`); }
  return canonical;
}

export function extractMainClientBackends({ client, configText } = {}) {
  if (!SUPPORTED_CLIENTS.has(client)) throw sanitizedError('Client must be one of: claude, vscode, codex');
  if (client === 'codex')
    throw sanitizedError('Codex backend extraction is unsupported because config.toml is TOML; use codexRegistration(connector) and the native Codex CLI instead.');
  const config = parseConfig(configText, client);
  return canonicalMainBackends(client, nativeCollection(config, client));
}

function collectMcpPermissions(value, result = []) {
  if (typeof value === 'string') {
    if (/^mcp(?:__|[:*])/i.test(value)) result.push(value);
    return result;
  }
  if (Array.isArray(value)) for (const item of value) collectMcpPermissions(item, result);
  else if (plainObject(value)) for (const item of Object.values(value)) collectMcpPermissions(item, result);
  return result;
}

function assertClaudeGatewayPolicy(value, field, existingGatewayMatches) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
    throw sanitizedError(`Claude root ${field} policy cannot be classified safely for migration.`);
  if (value.some(item => item !== GATEWAY_NAME) || (value.includes(GATEWAY_NAME) && !existingGatewayMatches))
    throw sanitizedError(`Claude root ${field} policy targets removed or unverified MCP aliases and cannot be preserved automatically.`);
}

function assertMigrationRootPolicies(config, client, existingGatewayMatches) {
  if (client === 'vscode' && Object.hasOwn(config, 'sandbox'))
    throw sanitizedError('VS Code top-level sandbox settings may affect migrated MCP servers and cannot be preserved automatically.');
  if (client !== 'claude') return;
  if (config.enableAllProjectMcpServers !== undefined && config.enableAllProjectMcpServers !== false)
    throw sanitizedError('Claude root enableAllProjectMcpServers policy is wildcard behavior and cannot be preserved automatically.');
  const listFields = ['enabledMcpjsonServers', 'disabledMcpjsonServers', 'enabledMcpServers',
    'disabledMcpServers', 'allowedMcpServers', 'deniedMcpServers'];
  for (const field of listFields) if (Object.hasOwn(config, field))
    assertClaudeGatewayPolicy(config[field], field, existingGatewayMatches);
  for (const rule of collectMcpPermissions(config.permissions)) {
    const exactGatewayRule = /^mcp__shared-mcp-gateway__[^*]+$/.test(rule);
    if (!existingGatewayMatches || !exactGatewayRule)
      throw sanitizedError('Claude root MCP trust or permission policy targets removed, wildcard, or unverified MCP aliases.');
  }
}
export function prepareMainClientMigration({ client, configText, connector } = {}) {
  if (client !== 'claude' && client !== 'vscode') throw sanitizedError('Client migration must target claude or vscode');
  const config = parseConfig(configText, client);
  const collectionKey = client === 'claude' ? 'mcpServers' : 'servers';
  const aliasKey = client === 'claude' ? 'servers' : 'mcpServers';
  if (config[collectionKey] !== undefined && !plainObject(config[collectionKey]))
    throw sanitizedError(`${client} config ${collectionKey} must be an object; the config was not modified.`);
  if (config[aliasKey] !== undefined && !plainObject(config[aliasKey]))
    throw sanitizedError(`${client} config ${aliasKey} must be an object; the config was not modified.`);
  if (config[collectionKey] !== undefined && config[aliasKey] !== undefined && !structurallyEqual(config[collectionKey], config[aliasKey]))
    throw sanitizedError(`${client} config contains conflicting MCP server collections; the config was not modified.`);

  const expected = connectorEntry(connector, client === 'vscode');
  const nativeEntry = config[collectionKey]?.[GATEWAY_NAME];
  const aliasEntry = config[aliasKey]?.[GATEWAY_NAME];
  if (nativeEntry !== undefined && aliasEntry !== undefined && !structurallyEqual(nativeEntry, aliasEntry))
    throw sanitizedError(`${client} config contains conflicting ${GATEWAY_NAME} entries; the config was not modified.`);
  const existing = nativeEntry ?? aliasEntry;
  if (existing !== undefined && !structurallyEqual(existing, expected))
    throw sanitizedError(`${client} config already contains a different ${GATEWAY_NAME} entry; the config was not modified.`);
  assertMigrationRootPolicies(config, client, existing !== undefined && structurallyEqual(existing, expected));

  const servers = config[collectionKey] ?? config[aliasKey] ?? {};
  const backends = canonicalMainBackends(client, servers);
  const updated = { ...config, [collectionKey]: { [GATEWAY_NAME]: expected } };
  delete updated[aliasKey];
  if (structurallyEqual(config, updated)) return Object.freeze({ client, changed: false, updatedText: configText, backends });
  return Object.freeze({ client, changed: true, updatedText: `${JSON.stringify(updated, null, 2)}\n`, backends });
}
export function codexRegistration(connector) {
  const entry = connectorEntry(connector, false);
  if (entry.env !== undefined && Object.keys(entry.env).length > 0)
    throw sanitizedError('Codex native registration does not support connector env without exposing values; use a connector without env.');
  const args = Object.freeze(['mcp', 'add', GATEWAY_NAME, '--', entry.command, ...entry.args]);
  return Object.freeze({ command: 'codex', args });
}

export function prepareMainClientConfig({ client, configText, connector, configPath } = {}) {
  if (!SUPPORTED_CLIENTS.has(client)) throw sanitizedError('Client must be one of: claude, vscode, codex');
  if (client === 'codex') {
    if (typeof configText !== 'string') throw sanitizedError('Client config text must be a string');
    return Object.freeze({
      updatedText: configText,
      changed: false,
      warnings: Object.freeze(['Codex registration uses `codex mcp add`; this plan does not parse or migrate config.toml.']),
      registrationCommand: codexRegistration(connector),
      requiresNativeCli: true
    });
  }
  return prepareJsonConfig({ client, configText, connector, configPath });
}