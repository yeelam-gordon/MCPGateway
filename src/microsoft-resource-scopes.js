import { GatewayError } from './errors.js';
import { validateMicrosoftDiscovery } from './entra-oauth.js';
import { boundMicrosoftScopes, microsoftScopeBase, OIDC_SCOPES } from './microsoft-resource-binding.js';

export function microsoftResourceScopes(discovery, scope, provider) {
  const authority = validateMicrosoftDiscovery(discovery);
  if (!discovery.resourceMetadata?.authorization_servers?.includes(discovery.authorizationServerUrl)) {
    throw new GatewayError('oauth_invalid_issuer', 'Host authority must be advertised by the verified MCP resource');
  }
  return { authority, ...boundMicrosoftScopes(provider, discovery, scope) };
}

export function requiredMicrosoftScopes(advertised, current, name) {
  if (!/^McpServers(?:\.[A-Za-z][A-Za-z0-9]{0,63}){2,4}$/.test(name)) {
    throw new GatewayError('entra_invalid_scope', 'Microsoft resource supplied an invalid required scope');
  }
  const api = advertised.filter(value => !OIDC_SCOPES.has(value));
  if (!api.length) {
    throw new GatewayError('entra_invalid_scope', 'Required Microsoft scope has no verified advertised API scope base');
  }
  const bases = new Set(api.map(microsoftScopeBase));
  if (bases.size !== 1) throw new GatewayError('entra_invalid_scope', 'Required Microsoft scope has ambiguous advertised API scope bases');
  return [...new Set([...current.filter(value => !value.endsWith('/.default')), `${[...bases][0]}/${name}`])];
}

export function selectedMicrosoftHostScope(discovery, challenged, selected, provider) {
  if (!challenged) return selected?.join(' ');
  const incoming = microsoftResourceScopes(discovery, challenged, provider).scopes;
  const api = incoming.filter(value => !['openid', 'profile', 'offline_access'].includes(value));
  if (selected?.some(value => !['openid', 'profile', 'offline_access'].includes(value) && !value.endsWith('/.default')) &&
      api.every(value => value.endsWith('/.default'))) {
    return microsoftResourceScopes(discovery, selected.join(' '), provider).scopes.join(' ');
  }
  return challenged;
}
