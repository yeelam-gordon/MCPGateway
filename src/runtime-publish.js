import { rename } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleepFor } from 'node:timers/promises';

const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);
const MAX_ATTEMPTS = 128;
const RETRY_DELAY_MS = 25;

function exhausted(error, staging, destination, attempts) {
  const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
  const message = `Unable to publish runtime directory from "${staging}" to "${destination}" after ${attempts} attempts${detail}`;
  if (error instanceof Error) { error.message = message; return error; }
  return Object.assign(new Error(message), { code: error?.code });
}

export async function publishRuntimeDirectory(staging, destination, {
  platform = process.platform, timeoutMs = 3_000, renameOperation = rename,
  sleep = sleepFor, now = () => performance.now()
} = {}) {
  const startedAt = now();
  let attempts = 0;
  let lastError;
  while (attempts < MAX_ATTEMPTS) {
    if (attempts && now() - startedAt >= timeoutMs) throw exhausted(lastError, staging, destination, attempts);
    attempts += 1;
    try { return await renameOperation(staging, destination); }
    catch (error) {
      if (platform !== 'win32' || !TRANSIENT.has(error?.code)) throw error;
      lastError = error;
      const remainingMs = timeoutMs - (now() - startedAt);
      if (remainingMs <= 0 || attempts >= MAX_ATTEMPTS) throw exhausted(error, staging, destination, attempts);
      await sleep(Math.min(RETRY_DELAY_MS, remainingMs));
    }
  }
  throw exhausted(lastError, staging, destination, attempts);
}
