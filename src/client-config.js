import { prepareClientConfig, extractClientBackends, prepareClientMigration as prepareJsonClientMigration } from './client-config-json.js';
import { prepareMainClientConfig, extractMainClientBackends, prepareMainClientMigration, codexRegistration } from './client-config-main.js';
import { extractCodexBackends, prepareCodexMigration } from './client-config-codex.js';
import { assertPortableBackendPaths } from './client-config-paths.js';

const JSON_CLIENTS = new Set(['opencode', 'qwen', 'kimi', 'antigravity']);
const MAIN_CLIENTS = new Set(['claude', 'vscode']);

export function clientCapabilities(client) {
  if (JSON_CLIENTS.has(client) || MAIN_CLIENTS.has(client)) {
    return { client, format: 'json', connectorRegistration: true, backendExtraction: true };
  }
  if (client === 'codex') {
    return { client, format: 'toml', connectorRegistration: 'native-cli', backendExtraction: true };
  }
  throw new Error(`Unsupported client: ${client}`);
}

export function prepareConnectorRegistration(options) {
  clientCapabilities(options.client);
  if (JSON_CLIENTS.has(options.client)) return prepareClientConfig(options);
  if (MAIN_CLIENTS.has(options.client)) return prepareMainClientConfig(options);
  return { client: 'codex', changed: false, requiresNativeCli: true, registrationCommand: codexRegistration(options.connector) };
}

export function prepareClientMigration(options) {
  clientCapabilities(options.client);
  const prepared = JSON_CLIENTS.has(options.client) ? prepareJsonClientMigration(options)
    : MAIN_CLIENTS.has(options.client) ? prepareMainClientMigration(options)
      : prepareCodexMigration(options);
  assertPortableBackendPaths(prepared.backends);
  return prepared;
}

export function extractConfiguredBackends(options) {
  clientCapabilities(options.client);
  const backends = JSON_CLIENTS.has(options.client) ? extractClientBackends(options)
    : MAIN_CLIENTS.has(options.client) ? extractMainClientBackends(options)
      : extractCodexBackends(options);
  return assertPortableBackendPaths(backends);
}
