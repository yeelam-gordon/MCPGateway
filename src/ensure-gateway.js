import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadOrCreateToken } from './token.js';

const execFileAsync = promisify(execFile);
const IDENTITY = Object.freeze({ name: 'shared-mcp-gateway', version: '0.1.0' });
const LOCK_FILE = 'gateway-start.lock';
const INSTANCE_FILE = 'gateway-instance.json';
const POLL_MS = 75;

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
const remaining = deadline => Math.max(0, deadline - Date.now());

function assertOptions({ configPath, adaptersPath, stateDir, port, startupTimeoutMs }) {
  if (typeof configPath !== 'string' || !configPath) throw new TypeError('configPath must be a non-empty string');
  if (adaptersPath != null && (typeof adaptersPath !== 'string' || !adaptersPath)) throw new TypeError('adaptersPath must be null or a non-empty string');
  if (typeof stateDir !== 'string' || !stateDir) throw new TypeError('stateDir must be a non-empty string');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('port must be an integer from 1 to 65535');
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1) throw new RangeError('startupTimeoutMs must be a positive integer');
}

async function canonicalFile(path) {
  const canonicalPath = await realpath(resolve(path));
  const content = await readFile(canonicalPath);
  return { path: canonicalPath, hash: createHash('sha256').update(content).digest('hex') };
}

async function createLaunchSpec(configPath, adaptersPath, stateDir, port) {
  const config = await canonicalFile(configPath);
  const adapters = adaptersPath == null ? null : await canonicalFile(adaptersPath);
  const canonicalStateDir = resolve(stateDir);
  const value = { config, adapters, stateDir: canonicalStateDir, port };
  return { ...value, fingerprint: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}

async function processInfo(pid, timeoutMs = 2500) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'win32') {
    const script = `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($null -ne $p){[pscustomobject]@{creation=$p.StartTime.ToUniversalTime().ToString('o');executable=$p.Path}|ConvertTo-Json -Compress}; exit 0`;
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: timeoutMs });
      const text = stdout.trim();
      if (!text) return null;
      const parsed = JSON.parse(text);
      return { marker: parsed.creation, executable: parsed.executable ?? null, commandLine: parsed.commandLine ?? null };
    } catch (error) {
      if (error.killed) throw new Error(`Timed out checking process ${pid}`, { cause: error });
      throw new Error(`Cannot inspect process ${pid}: ${error.message}`, { cause: error });
    }
  }
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const marker = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
    const commandLine = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replaceAll('\0', ' ');
    return { marker, executable: null, commandLine };
  } catch {
    try { process.kill(pid, 0); return { marker: `pid:${pid}`, executable: null, commandLine: null }; } catch { return null; }
  }
}

function sameProcess(info, record) {
  if (!info || !record || info.marker !== record.processMarker) return false;
  if (process.platform === 'win32' && info.executable && record.executable) {
    return resolve(info.executable).toLowerCase() === resolve(record.executable).toLowerCase();
  }
  return true;
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try { await rename(temporary, path); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

function classifyProbeError(error) {
  const chain = [];
  for (let current = error; current && !chain.includes(current); current = current.cause) chain.push(current);
  const message = chain.map(item => item?.message ?? String(item)).join(' | ');
  const codes = chain.map(item => item?.code).filter(Boolean);
  if (codes.includes('ECONNREFUSED') || /ECONNREFUSED|fetch failed.*refused/i.test(message)) return 'absent';
  if (codes.includes(401) || /\b401\b|unauthorized/i.test(message)) return 'authentication';
  if (/timed out|aborted|aborterror/i.test(message)) return 'timeout';
  return 'listener';
}

async function probeGateway(port, token, timeoutMs) {
  const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: 'Bearer ' + token } },
    reconnectionOptions: { initialReconnectionDelay: 50, maxReconnectionDelay: 100, reconnectionDelayGrowFactor: 1, maxRetries: 0 }
  });
  const client = new Client({ name: 'shared-mcp-gateway-lifecycle', version: IDENTITY.version });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      void transport.close().catch(() => {});
      reject(new Error(`Gateway probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([client.connect(transport), timeout]);
    const identity = client.getServerVersion();
    if (identity?.name !== IDENTITY.name || identity?.version !== IDENTITY.version) {
      throw new Error(`Port ${port} is serving MCP identity ${identity?.name ?? '<unknown>'}@${identity?.version ?? '<unknown>'}, not ${IDENTITY.name}@${IDENTITY.version}`);
    }
    const tools = await Promise.race([client.listTools(), timeout]);
    if (!tools.tools.some(tool => tool.name === 'list_servers')) throw new Error(`Port ${port} does not expose the required list_servers tool`);
    const listed = await Promise.race([client.callTool({ name: 'list_servers', arguments: {} }), timeout]);
    const structured = listed.structuredContent;
    if (!structured || !Array.isArray(structured.servers)) throw new Error(`Port ${port} returned an invalid list_servers result`);
    return { kind: 'healthy', servers: structured.servers };
  } catch (error) {
    return { kind: classifyProbeError(error), error };
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}

async function matchingInstance(stateDir, spec, port) {
  const metadata = await readJson(join(stateDir, INSTANCE_FILE));
  if (!metadata || metadata.port !== port || metadata.fingerprint !== spec.fingerprint || metadata.identity?.name !== IDENTITY.name || metadata.identity?.version !== IDENTITY.version) {
    throw new Error(`Authenticated gateway on port ${port} was started with different config or adapter settings`);
  }
  if (metadata.pid == null) return { pid: null, reused: true };
  const info = await processInfo(metadata.pid);
  if (!sameProcess(info, metadata)) throw new Error(`Gateway metadata for port ${port} does not match the live process`);
  return { pid: metadata.pid, reused: true };
}

function probeFailure(port, probe) {
  if (probe.kind === 'authentication') return new Error(`Port ${port} is occupied by a listener that rejected the gateway owner token; refusing to replace it`);
  if (probe.kind === 'timeout') return new Error(`Listener on port ${port} did not complete an authenticated MCP handshake within the startup bound; refusing to start another gateway`);
  return new Error(`Port ${port} is occupied by a listener that is not ${IDENTITY.name}@${IDENTITY.version}; refusing to replace it`, { cause: probe.error });
}

async function inspectOrStartable(spec, token, deadline) {
  const timeoutMs = Math.max(1, Math.min(1500, remaining(deadline)));
  const probe = await probeGateway(spec.port, token, timeoutMs);
  if (probe.kind === 'healthy') return { result: await matchingInstance(spec.stateDir, spec, spec.port) };
  if (probe.kind === 'absent') return { startable: true };
  throw probeFailure(spec.port, probe);
}

async function acquireLock(lockPath, deadline) {
  const ownInfo = await processInfo(process.pid, Math.max(1, Math.min(2500, remaining(deadline))));
  if (!ownInfo) throw new Error('Cannot establish gateway lock process provenance');
  const record = { nonce: randomUUID(), pid: process.pid, processMarker: ownInfo.marker, executable: ownInfo.executable, createdAt: new Date().toISOString() };
  while (remaining(deadline) > 0) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await handle.close();
      return record;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let raw;
    let existing;
    try { raw = await readFile(lockPath, 'utf8'); existing = JSON.parse(raw); } catch { await delay(Math.min(POLL_MS, remaining(deadline))); continue; }
    if (!existing?.nonce || !Number.isInteger(existing.pid) || !existing.processMarker) {
      await delay(Math.min(POLL_MS, remaining(deadline)));
      continue;
    }
    let info;
    try { info = await processInfo(existing.pid, Math.max(1, Math.min(1000, remaining(deadline)))); } catch { await delay(Math.min(POLL_MS, remaining(deadline))); continue; }
    if (sameProcess(info, existing)) {
      await delay(Math.min(POLL_MS, remaining(deadline)));
      continue;
    }
    try {
      if (await readFile(lockPath, 'utf8') === raw) await unlink(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') await delay(Math.min(POLL_MS, remaining(deadline)));
    }
  }
  throw new Error('Gateway startup lock did not become available before the startup deadline');
}

async function releaseOwnedLock(lockPath, record) {
  try {
    const current = await readJson(lockPath);
    if (current?.nonce === record.nonce && current.pid === record.pid && current.processMarker === record.processMarker) await unlink(lockPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function spawnGateway(spec, nonce, deadline) {
  const cliPath = await realpath(join(import.meta.dirname, 'cli.js'));
  const stdoutPath = join(spec.stateDir, 'gateway.stdout.log');
  const stderrPath = join(spec.stateDir, 'gateway.stderr.log');
  const stdoutFd = openSync(stdoutPath, 'a', 0o600);
  const stderrFd = openSync(stderrPath, 'a', 0o600);
  const args = [cliPath, '--config', spec.config.path, '--port', String(spec.port), '--state-dir', spec.stateDir];
  if (spec.adapters) args.push('--adapters', spec.adapters.path);
  let child;
  try {
    child = spawn(process.execPath, args, { detached: true, windowsHide: true, stdio: ['ignore', stdoutFd, stderrFd], shell: false });
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn);
      child.once('error', rejectSpawn);
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  try {
    const info = await processInfo(child.pid, Math.max(1, Math.min(2500, remaining(deadline))));
    if (!info) throw new Error('spawned process is no longer running');
    const metadata = {
      nonce,
      pid: child.pid,
      processMarker: info.marker,
      executable: info.executable ?? process.execPath,
      cliPath,
      port: spec.port,
      fingerprint: spec.fingerprint,
      identity: IDENTITY,
      config: spec.config,
      adapters: spec.adapters,
      startedAt: new Date().toISOString()
    };
    child.unref();
    return { child, metadata, stdoutPath, stderrPath };
  } catch (error) {
    if (child.exitCode === null) {
      try { child.kill(); } catch {}
      await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(500)]);
    }
    throw new Error(`Gateway process exited or its provenance could not be recorded: ${error.message}`, { cause: error });
  }
}

async function terminateMetadata(metadata, timeoutMs = 3000) {
  if (!metadata?.pid || !metadata.processMarker) return false;
  const before = await processInfo(metadata.pid);
  if (!sameProcess(before, metadata)) return false;
  if (process.platform === 'win32') {
    try { process.kill(metadata.pid, 'SIGTERM'); } catch {}
    await delay(Math.min(250, timeoutMs));
    const stillRunning = await processInfo(metadata.pid);
    if (sameProcess(stillRunning, metadata)) {
      const guard = await processInfo(metadata.pid);
      if (!sameProcess(guard, metadata)) return false;
      await execFileAsync('taskkill.exe', ['/PID', String(metadata.pid), '/T', '/F'], { windowsHide: true, timeout: Math.max(500, timeoutMs) }).catch(() => {});
    }
  } else {
    try { process.kill(metadata.pid, 'SIGTERM'); } catch {}
    const gracefulDeadline = Date.now() + Math.min(500, timeoutMs);
    while (Date.now() < gracefulDeadline && sameProcess(await processInfo(metadata.pid), metadata)) await delay(25);
    if (sameProcess(await processInfo(metadata.pid), metadata)) {
      try { process.kill(-metadata.pid, 'SIGKILL'); } catch { try { process.kill(metadata.pid, 'SIGKILL'); } catch {} }
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!sameProcess(await processInfo(metadata.pid), metadata)) return true;
    await delay(30);
  }
  return !sameProcess(await processInfo(metadata.pid), metadata);
}

export async function stopOwnedGateway({ stateDir, port = 7319, timeoutMs = 3000 }) {
  const path = join(resolve(stateDir), INSTANCE_FILE);
  const metadata = await readJson(path);
  if (!metadata || metadata.port !== port) return false;
  const stopped = await terminateMetadata(metadata, timeoutMs);
  if (stopped) {
    const current = await readJson(path);
    if (current?.nonce === metadata.nonce && current?.processMarker === metadata.processMarker) await unlink(path).catch(() => {});
  }
  return stopped;
}

export async function ensureGateway({ configPath, adaptersPath = null, stateDir, port = 7319, startupTimeoutMs = 20_000 }) {
  assertOptions({ configPath, adaptersPath, stateDir, port, startupTimeoutMs });
  const deadline = Date.now() + startupTimeoutMs;
  await mkdir(resolve(stateDir), { recursive: true, mode: 0o700 });
  const spec = await createLaunchSpec(configPath, adaptersPath, stateDir, port);
  const tokenLockPath = `${spec.stateDir}.token-init.lock`;
  const tokenLock = await acquireLock(tokenLockPath, deadline);
  try {
    const { token } = await loadOrCreateToken(spec.stateDir);
    const initial = await inspectOrStartable(spec, token, deadline);
    if (initial.result) return initial.result;

    const lockPath = join(spec.stateDir, LOCK_FILE);
    let lock;
    let launched;
    try {
      lock = await acquireLock(lockPath, deadline);
      const afterLock = await inspectOrStartable(spec, token, deadline);
      if (afterLock.result) return afterLock.result;

      launched = await spawnGateway(spec, lock.nonce, deadline);
      while (remaining(deadline) > 0) {
        if (launched.child.exitCode !== null) {
          const stderr = await readFile(launched.stderrPath, 'utf8').catch(() => '');
          if (/EADDRINUSE/i.test(stderr)) throw new Error(`Port ${port} became occupied during gateway startup (EADDRINUSE); no existing listener was replaced`);
          throw new Error(`Gateway process exited with code ${launched.child.exitCode}; see ${launched.stderrPath}`);
        }
        const probe = await probeGateway(port, token, Math.max(1, Math.min(750, remaining(deadline))));
        if (probe.kind === 'healthy') {
          await writeJsonAtomic(join(spec.stateDir, INSTANCE_FILE), launched.metadata);
          return { pid: launched.metadata.pid, reused: false };
        }
        if (probe.kind !== 'absent') throw probeFailure(port, probe);
        await delay(Math.min(POLL_MS, remaining(deadline)));
      }
      throw new Error(`Gateway did not become ready within ${startupTimeoutMs}ms; see ${launched.stderrPath}`);
    } catch (error) {
      if (launched) {
        await terminateMetadata(launched.metadata, Math.min(3000, startupTimeoutMs)).catch(() => {});
        const metadataPath = join(spec.stateDir, INSTANCE_FILE);
        const current = await readJson(metadataPath).catch(() => null);
        if (current?.nonce === launched.metadata.nonce && current?.processMarker === launched.metadata.processMarker) await unlink(metadataPath).catch(() => {});
      }
      throw error;
    } finally {
      if (lock) await releaseOwnedLock(lockPath, lock);
    }
  } finally {
    await releaseOwnedLock(tokenLockPath, tokenLock);
  }
}
