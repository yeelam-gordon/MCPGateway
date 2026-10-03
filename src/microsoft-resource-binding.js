import { GatewayError } from './errors.js';

export const OIDC_SCOPES = new Set(['openid', 'profile', 'offline_access']);
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canonicalMicrosoftResource(value) {
  const invalid = () => { throw new GatewayError('entra_invalid_scope', 'Microsoft API resource must be an HTTPS or api:// identifier without credentials, query, fragment, whitespace or ambiguous path'); };
  if (typeof value !== 'string' || !value || /[\s\\%?#]/.test(value)) return invalid();
  if (guid.test(value)) return value.toLowerCase();
  let url;
  try { url = new URL(value); } catch { return invalid(); }
  if (!['https:', 'api:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
      url.search || url.hash || /\/{2}|(?:^|\/)\.{1,2}(?:\/|$)/.test(value.slice(value.indexOf('://') + 3)) ||
      !value.startsWith(`${url.protocol}//`)) return invalid();
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`;
}

export function microsoftScopeBase(scope) {
  if (typeof scope !== 'string' || /[\s\\%?#]/.test(scope)) throw new GatewayError('entra_invalid_scope', 'Microsoft scopes must be fully qualified API scopes');
  const slash = scope.lastIndexOf('/');
  if (slash < 1 || !/^(?:\.default|[A-Za-z][A-Za-z0-9._-]*)$/.test(scope.slice(slash + 1))) {
    throw new GatewayError('entra_invalid_scope', 'Microsoft scopes must have a canonical API base and a non-empty scope name');
  }
  return canonicalMicrosoftResource(scope.slice(0, slash));
}

export function trustedMicrosoftResource(provider) {
  const configured = provider.config.oauth ?? {};
  const bases = new Set((configured.scopes ?? []).filter(scope => !OIDC_SCOPES.has(scope)).map(microsoftScopeBase));
  if (bases.size > 1) throw new GatewayError('entra_invalid_scope', 'Configured Microsoft scopes must target one API');
  const explicit = configured.resource === undefined ? undefined : canonicalMicrosoftResource(configured.resource);
  const approved = provider.options.resource === undefined ? undefined : canonicalMicrosoftResource(provider.options.resource);
  const derived = [...bases][0];
  const resource = explicit ?? derived ?? approved ?? provider.saved.trustedMicrosoftResource;
  if (!resource) throw new GatewayError('oauth_resource_binding_required',
    'Microsoft sign-in requires an independently approved API identifier. Configure oauth.resource or resource-qualified oauth.scopes, or run the authenticate-backend helper with --resource API_ID from trusted operator configuration; server metadata alone is not authorization.');
  const canonical = canonicalMicrosoftResource(resource);
  if ([explicit, derived, approved].some(value => value && value !== canonical)) {
    throw new GatewayError('entra_invalid_scope', 'Approved Microsoft resource and configured scopes must target the same API');
  }
  return canonical;
}

export function boundMicrosoftScopes(provider, discovery, challenged) {
  const resource = trustedMicrosoftResource(provider);
  const advertised = discovery.resourceMetadata?.scopes_supported ?? [];
  const incoming = challenged ? challenged.split(/\s+/).filter(Boolean) : [];
  const requested = provider.options.scopes ?? [];
  if (!Array.isArray(requested) || requested.some(scope => typeof scope !== 'string' || !scope || /\s/.test(scope))) {
    throw new GatewayError('entra_invalid_scope', '--scope requires repeatable, fully qualified scope strings');
  }
  for (const scope of [...advertised, ...incoming, ...requested]) {
    if (!OIDC_SCOPES.has(scope) && microsoftScopeBase(scope) !== resource) {
      throw new GatewayError('entra_invalid_scope', 'Microsoft scopes do not match the independently approved API resource');
    }
  }
  const previous = (provider.pendingVSCode ?? provider.saved.vscode ?? provider.pendingAzureCli ?? provider.saved.azureCli ??
    provider.pendingEntra ?? provider.saved.entra)?.scopes ?? [];
  const configured = provider.config.oauth?.scopes;
  let scopes = incoming.length ? incoming : previous.length ? previous : configured?.length ? configured : advertised;
  const selected = previous.length ? previous : configured ?? [];
  if (incoming.length && incoming.filter(scope => !OIDC_SCOPES.has(scope)).every(scope => scope.endsWith('/.default')) &&
      selected.some(scope => !OIDC_SCOPES.has(scope) && !scope.endsWith('/.default'))) scopes = selected;
  if (requested.length) scopes = [...new Set([...scopes, ...previous, ...(configured ?? []), ...requested])]
    .filter(scope => !scope.endsWith('/.default'));
  for (const scope of scopes) {
    if (!OIDC_SCOPES.has(scope) && microsoftScopeBase(scope) !== resource) {
      throw new GatewayError('entra_invalid_scope', 'Selected Microsoft scopes do not match the approved API resource');
    }
  }
  if (!scopes.some(scope => !OIDC_SCOPES.has(scope))) throw new GatewayError('entra_invalid_scope', 'Microsoft sign-in requires at least one resource-qualified API scope');
  return { scopes, trustedResource: resource };
}
