import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const name = 'smol-toml';
const locked = lock.packages?.[`node_modules/${name}`];
if (!locked?.version || !locked?.resolved || !locked?.integrity?.startsWith('sha512-')) {
  throw new Error(`package-lock.json has no pinned ${name} version, URL, and SHA-512 integrity`);
}
if (new URL(locked.resolved).origin !== 'https://registry.npmjs.org') {
  throw new Error('Client dependency integrity must be generated from the public npm registry');
}
const response = await fetch(locked.resolved, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
if (!response.ok) throw new Error(`Cannot fetch ${locked.resolved}: HTTP ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const actualIntegrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
if (actualIntegrity !== locked.integrity) throw new Error(`${name} tarball SHA-512 does not match package-lock.json`);
const tar = gunzipSync(archive);
const files = Object.create(null);
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every(byte => byte === 0)) break;
  const text = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
  const namePart = text(0, 100);
  const prefix = text(345, 155);
  const archivePath = prefix ? `${prefix}/${namePart}` : namePart;
  const sizeText = text(124, 12).trim();
  const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid tar size for ${archivePath}`);
  const type = String.fromCharCode(header[156] || 48);
  const bodyStart = offset + 512;
  const bodyEnd = bodyStart + size;
  if (bodyEnd > tar.length) throw new Error(`Truncated tar entry ${archivePath}`);
  if ((type === '0' || type === '\0') && archivePath.startsWith('package/')) {
    const relativePath = archivePath.slice('package/'.length).replaceAll('\\', '/');
    if (!relativePath || relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
      throw new Error(`Unsafe tar path ${archivePath}`);
    }
    files[relativePath] = createHash('sha256').update(tar.subarray(bodyStart, bodyEnd)).digest('hex');
  }
  offset = bodyStart + Math.ceil(size / 512) * 512;
}
const manifest = {
  version: 1,
  generatedBy: 'node tools/generate-client-dependency-integrity.mjs',
  packages: {
    [name]: {
      version: locked.version,
      resolved: locked.resolved,
      integrity: locked.integrity,
      files: Object.fromEntries(Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    }
  }
};
const output = join(root, 'integrity', 'client-runtime-dependencies.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${output}\n${Object.keys(files).length} files\n`);
