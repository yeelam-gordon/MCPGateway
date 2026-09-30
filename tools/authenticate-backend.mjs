import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { authenticateBackend } from '../src/backend-oauth.js';

const usage = `Usage: node '${fileURLToPath(import.meta.url).replaceAll("'", "''")}' --server ALIAS [--config PATH] [--state-dir PATH] [--timeout SECONDS] [--no-browser]`;
async function main() {
  const options = { config: resolve(homedir(), '.shared-mcp-gateway', 'backends.json'),
    stateDir: resolve(homedir(), '.shared-mcp-gateway'), timeoutMs: 180_000 };
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help') { console.log(usage); return; }
    if (flag === '--no-browser') { options.noBrowser = true; continue; }
    const value = argv[++index];
    if (!value || !['--server', '--config', '--state-dir', '--timeout'].includes(flag)) throw new Error(usage);
    if (flag === '--server') options.server = value;
    if (flag === '--config') options.config = resolve(value);
    if (flag === '--state-dir') options.stateDir = resolve(value);
    if (flag === '--timeout') options.timeoutMs = Number(value) * 1000;
  }
  if (!options.server) throw new Error(usage);
  const config = (await loadConfig(options.config)).get(options.server);
  if (!config) throw new Error('Requested backend is missing or disabled');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    console.log(JSON.stringify(await authenticateBackend(config, options.stateDir, { ...options, signal: controller.signal })));
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
