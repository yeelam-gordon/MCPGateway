import { prepareClientConfig, extractClientBackends } from './client-config-json.js';
import { prepareMainClientConfig, extractMainClientBackends, codexRegistration } from './client-config-main.js';

const JSON_CLIENTS = new Set(['opencode', 'qwen', 'kimi', 'antigravity']);
const MAIN_CLIENTS = new Set(['claude', 'vscode']);

export function clientCapabilities(client) {
  if (JSON_CLIENTS.has(client) || MAIN_CLIENTS.has(client)) {
    return { client, format: 'json', connectorRegistration: true, backendExtraction: true };
  }
  if (client === 'codex') {
    return { client, format: 'toml', connectorRegistration: 'native-cli', backendExtraction: false };
  }
  throw new Error(`Unsupported client: ${client}`);
}

export function prepareConnectorRegistration(options) {
  clientCapabilities(options.client);
  if (JSON_CLIENTS.has(options.client)) return prepareClientConfig(options);
  if (MAIN_CLIENTS.has(options.client)) return prepareMainClientConfig(options);
  return { client: 'codex', changed: false, requiresNativeCli: true, registrationCommand: codexRegistration(options.connector) };
}

export function extractConfiguredBackends(options) {
  clientCapabilities(options.client);
  if (JSON_CLIENTS.has(options.client)) return extractClientBackends(options);
  if (MAIN_CLIENTS.has(options.client)) return extractMainClientBackends(options);
  throw new Error('Codex uses TOML. Backend extraction requires a TOML-aware integration; no configuration was changed.');
}
