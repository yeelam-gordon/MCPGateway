import { GatewayError } from './errors.js';

export function isValidAccessToken(value) {
  return typeof value === 'string' && value.length > 0 && !/[\s\x00-\x1f\x7f-\x9f\u0100-\uffff]/.test(value);
}

export function validateAccessToken(value) {
  if (!isValidAccessToken(value)) throw new GatewayError('oauth_invalid_token', 'OAuth returned an invalid access token');
  return value;
}

export async function validateTokenResponse(response) {
  if (!response.ok) return;
  let body;
  try { body = await response.clone().json(); }
  catch { throw new GatewayError('oauth_invalid_token', 'OAuth returned an invalid token response'); }
  validateAccessToken(body?.access_token);
}
