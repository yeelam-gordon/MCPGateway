import { canonicalMicrosoftResource } from './microsoft-resource-binding.js';

export function safeOAuthUrl(value, httpsOnly = false) {
  const url = new URL(value);
  if (url.username || url.password || url.hash ||
      (url.protocol !== 'https:' && (httpsOnly || url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))) {
    throw new Error('OAuth requires HTTPS or loopback HTTP, without credentials or fragments');
  }
  return url;
}

const BACKEND_FIELDS = new Set(['disabled', 'type', 'command', 'args', 'cwd', 'env', 'url', 'headers', 'tools', 'timeout', 'requiresExclusiveAccess', 'oauth']);
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
  if (value.oauth !== undefined) {
    if (!hasUrl || !object(value.oauth)) fail(`${path}.oauth`, 'requires an HTTP backend and an object');
    safeOAuthUrl(value.url);
    for (const key of Object.keys(value.oauth)) if (!['resource', 'credentialProvider', 'provider', 'clientId', 'scopes', 'redirectPort', 'clientMetadataUrl', 'grantType', 'issuer', 'authority', 'certificateThumbprintSha256', 'tokenEndpointAuthMethod', 'secretEnv', 'privateKeyPath', 'alg', 'kid'].includes(key)) fail(`${path}.oauth`, 'contains an unapproved field');
    if (value.oauth.resource !== undefined) canonicalMicrosoftResource(value.oauth.resource);
    if (value.oauth.credentialProvider !== undefined && !['azure-cli', 'vscode'].includes(value.oauth.credentialProvider)) fail(`${path}.oauth.credentialProvider`, 'must be azure-cli or vscode');
    if (value.oauth.credentialProvider && (value.oauth.grantType === 'client_credentials' || value.oauth.clientMetadataUrl)) fail(`${path}.oauth`, 'Host credentials are delegated-only and do not use client metadata registration');
    if (value.oauth.provider !== undefined && value.oauth.provider !== 'entra') fail(`${path}.oauth.provider`, 'must be entra');
    if (value.oauth.clientId !== undefined && (typeof value.oauth.clientId !== 'string' || !value.oauth.clientId.trim())) fail(`${path}.oauth.clientId`, 'must be a non-empty public client ID');
    if (value.oauth.scopes !== undefined && (!Array.isArray(value.oauth.scopes) || value.oauth.scopes.some(scope => typeof scope !== 'string' || !scope || /\s/.test(scope)))) fail(`${path}.oauth.scopes`, 'must be an array of non-empty scope strings without whitespace');
    if (value.oauth.redirectPort !== undefined && (!Number.isInteger(value.oauth.redirectPort) || value.oauth.redirectPort < 1 || value.oauth.redirectPort > 65535)) fail(`${path}.oauth.redirectPort`, 'must be 1..65535');
    if (value.oauth.clientMetadataUrl !== undefined) {
      if (typeof value.oauth.clientMetadataUrl !== 'string') fail(`${path}.oauth.clientMetadataUrl`, 'must be an HTTPS URL');
      if (safeOAuthUrl(value.oauth.clientMetadataUrl, true).pathname === '/') fail(`${path}.oauth.clientMetadataUrl`, 'must have a non-root path');
    }
    const oauth = value.oauth;
    if (oauth.grantType !== undefined && !['authorization_code', 'client_credentials'].includes(oauth.grantType)) fail(`${path}.oauth.grantType`, 'must be authorization_code or client_credentials');
    if (oauth.tokenEndpointAuthMethod !== undefined && !['none', 'client_secret_basic', 'client_secret_post', 'private_key_jwt'].includes(oauth.tokenEndpointAuthMethod)) fail(`${path}.oauth.tokenEndpointAuthMethod`, 'unsupported method');
    const confidential = oauth.tokenEndpointAuthMethod && oauth.tokenEndpointAuthMethod !== 'none';
    const entra = oauth.provider === 'entra' || (oauth.issuer && new URL(oauth.issuer).hostname === 'login.microsoftonline.com');
    for (const key of ['issuer', 'authority', 'certificateThumbprintSha256', 'secretEnv', 'privateKeyPath', 'alg', 'kid']) {
      if (oauth[key] !== undefined && (typeof oauth[key] !== 'string' || !oauth[key].trim())) fail(`${path}.oauth.${key}`, 'must be a non-empty string');
    }
    if (confidential) {
      if (!oauth.clientId || (!entra && !oauth.issuer) || oauth.clientMetadataUrl) fail(`${path}.oauth`, 'confidential clients require registered clientId and explicit issuer (or Entra provider), without clientMetadataUrl');
      if (oauth.issuer) safeOAuthUrl(oauth.issuer);
      if (entra && oauth.grantType !== 'client_credentials') fail(`${path}.oauth`, 'Entra confidential authentication requires client_credentials');
      if (entra && oauth.tokenEndpointAuthMethod === 'private_key_jwt') {
        if (oauth.secretEnv || !oauth.privateKeyPath || !isAbsolute(oauth.privateKeyPath) ||
            !/^[0-9a-f]{64}$/i.test(oauth.certificateThumbprintSha256 ?? '') || oauth.alg || oauth.kid) {
          fail(`${path}.oauth`, 'Entra certificate authentication requires absolute privateKeyPath and certificateThumbprintSha256 (64 hex characters), without secretEnv, alg or kid');
        }
      } else if (oauth.tokenEndpointAuthMethod === 'private_key_jwt') {
        if (oauth.secretEnv || !oauth.privateKeyPath || !isAbsolute(oauth.privateKeyPath) || !['RS256', 'PS256'].includes(oauth.alg) || !oauth.kid) fail(`${path}.oauth`, 'private_key_jwt requires absolute privateKeyPath, alg RS256 or PS256, and kid; secretEnv is forbidden');
      } else if (!oauth.secretEnv || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(oauth.secretEnv) || oauth.privateKeyPath || oauth.alg || oauth.kid) {
        fail(`${path}.oauth`, 'secret authentication requires only a valid secretEnv credential reference');
      }
      if (entra && oauth.tokenEndpointAuthMethod === 'client_secret_basic') fail(`${path}.oauth`, 'MSAL Entra secret authentication requires client_secret_post');
    } else if (['issuer', 'secretEnv', 'privateKeyPath', 'alg', 'kid'].some(key => oauth[key] !== undefined)) {
      fail(`${path}.oauth`, 'credential references require an explicit confidential authentication method');
    }
    if ((oauth.authority !== undefined || oauth.certificateThumbprintSha256 !== undefined) && (!entra || !confidential)) fail(`${path}.oauth`, 'authority and certificate thumbprint are Entra confidential-only settings');
    if (oauth.certificateThumbprintSha256 && oauth.tokenEndpointAuthMethod !== 'private_key_jwt') fail(`${path}.oauth`, 'certificate thumbprint requires private_key_jwt');
    if (oauth.grantType === 'client_credentials' && (!confidential || oauth.redirectPort !== undefined)) fail(`${path}.oauth`, 'client_credentials requires confidential authentication and no redirectPort');
  }
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
import { isAbsolute } from 'node:path';
