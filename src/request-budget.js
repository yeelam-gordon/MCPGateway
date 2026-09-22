export const BACKEND_CALL_TIMEOUT_MS = 120_000;
export const CONNECTOR_REQUEST_TIMEOUT_MS = 180_000;
export const CLIENT_REQUEST_TIMEOUT_MS = 210_000;

export function requestOptions(timeoutMs, signal) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Request timeout must be a positive finite number');
  return {
    timeout: timeoutMs,
    maxTotalTimeout: timeoutMs,
    resetTimeoutOnProgress: false,
    ...(signal ? { signal } : {})
  };
}
