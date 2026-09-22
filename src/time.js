import { GatewayError } from './errors.js';

export function isRequestTimeout(error) {
  if (error instanceof GatewayError && error.code === 'timeout') return true;
  if (error?.code === -32001) {
    const message = String(error.message ?? '');
    const data = error.data;
    if (/request timed out|maximum total timeout exceeded/i.test(message)) return true;
    if (Number.isFinite(data?.timeout) || Number.isFinite(data?.maxTotalTimeout)) return true;
  }
  return Boolean(error?.cause && isRequestTimeout(error.cause));
}

export function downstreamTimeout(label, milliseconds, cause) {
  const error = new GatewayError(
    'timeout',
    `${label} timed out after ${milliseconds}ms; downstream outcome is unknown and the request was not retried`,
    cause
  );
  error.outcomeUnknown = true;
  return error;
}

export async function withTimeout(operation, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new GatewayError('timeout', `${label} timed out after ${milliseconds}ms`)), milliseconds);
      timer.unref?.();
    })]);
  } finally { clearTimeout(timer); }
}
