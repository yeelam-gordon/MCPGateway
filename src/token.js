import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, chmod, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const aclTimeoutMs = 5_000;

async function secureOwnerOnly(path, directory) {
  if (process.platform !== 'win32') {
    await chmod(path, directory ? 0o700 : 0o600);
    return;
  }
  const options = { windowsHide: true, timeout: aclTimeoutMs };
  const { stdout } = await execFileAsync('whoami.exe', [], options);
  const identity = stdout.trim();
  if (!identity) throw new Error(`Cannot determine the Windows identity for ${path}`);
  try {
    await execFileAsync('icacls.exe', [path, '/reset'], options);
    await execFileAsync('icacls.exe', [path, '/inheritance:r'], options);
    await execFileAsync('icacls.exe', [path, '/grant:r', `${identity}:${directory ? '(OI)(CI)F' : 'F'}`], options);
  } catch (error) {
    throw new Error(`Cannot apply owner-only ACL to ${path}: ${error.message}`, { cause: error });
  }
}

export async function loadOrCreateToken(stateDir) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await secureOwnerOnly(stateDir, true);
  const path = join(stateDir, 'owner.token');
  try {
    await access(path);
    await secureOwnerOnly(path, false);
    const token = (await readFile(path, 'utf8')).trim();
    if (!token) throw new Error(`Owner token file is empty: ${path}`);
    return { token, path };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = randomBytes(32).toString('base64url');
  const file = await open(path, 'wx', 0o600);
  try {
    await secureOwnerOnly(path, false);
    await file.writeFile(`${token}\n`, 'utf8');
  } finally {
    await file.close();
  }
  return { token, path };
}
