import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { publishRuntimeDirectory } from '../src/runtime-publish.js';

const fixtures = [];
afterEach(async () => Promise.allSettled(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true }))));
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'runtime-publish-')); fixtures.push(root); return root; }
function codedError(code, message = code) { return Object.assign(new Error(message), { code }); }

test('retries two transient Windows failures before a real rename', async () => {
  const root = await fixture();
  const staging = join(root, 'staging');
  const destination = join(root, 'immutable-hash');
  await mkdir(staging);
  await writeFile(join(staging, 'runtime.txt'), 'complete');
  let attempts = 0;
  let clock = 0;
  const delays = [];
  const result = await publishRuntimeDirectory(staging, destination, {
    platform: 'win32',
    renameOperation: async (...paths) => {
      attempts += 1;
      if (attempts <= 2) throw codedError(attempts === 1 ? 'EPERM' : 'EACCES');
      return rename(...paths);
    },
    now: () => clock,
    sleep: async milliseconds => { delays.push(milliseconds); clock += milliseconds; }
  });
  assert.equal(result, undefined);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [25, 25]);
  assert.equal(await readFile(join(destination, 'runtime.txt'), 'utf8'), 'complete');
  await assert.rejects(stat(staging), { code: 'ENOENT' });
});

test('bounds permanent failures by deadline and attempt cap while preserving code', async () => {
  let attempts = 0;
  let clock = 0;
  const failure = codedError('EBUSY', 'directory remains locked');
  await assert.rejects(publishRuntimeDirectory('C:\\staging-runtime', 'C:\\runtime-hash', {
    platform: 'win32', timeoutMs: 50,
    renameOperation: async () => { attempts += 1; throw failure; },
    now: () => clock, sleep: async milliseconds => { clock += milliseconds; }
  }), error => {
    assert.equal(error, failure);
    assert.equal(error.code, 'EBUSY');
    assert.match(error.message, /C:\\staging-runtime/);
    assert.match(error.message, /C:\\runtime-hash/);
    return true;
  });
  assert.equal(attempts, 2);

  attempts = 0;
  await assert.rejects(publishRuntimeDirectory('staging', 'destination', {
    platform: 'win32', timeoutMs: 10_000,
    renameOperation: async () => { attempts += 1; throw codedError('EPERM'); },
    now: () => 0, sleep: async () => {}
  }), { code: 'EPERM' });
  assert.equal(attempts, 128);
});

test('does not retry transient codes on non-Windows platforms', async () => {
  let attempts = 0;
  let sleeps = 0;
  const failure = codedError('EPERM');
  await assert.rejects(publishRuntimeDirectory('/staging', '/destination', {
    platform: 'linux', renameOperation: async () => { attempts += 1; throw failure; },
    sleep: async () => { sleeps += 1; }
  }), error => error === failure);
  assert.equal(attempts, 1);
  assert.equal(sleeps, 0);
});

test('does not retry EEXIST or remove source and destination content', async () => {
  const root = await fixture();
  const staging = join(root, 'staging');
  const destination = join(root, 'immutable-hash');
  await mkdir(staging);
  await mkdir(destination);
  await writeFile(join(staging, 'source.txt'), 'source');
  await writeFile(join(destination, 'unknown.txt'), 'unknown');
  let attempts = 0;
  const failure = codedError('EEXIST');
  await assert.rejects(publishRuntimeDirectory(staging, destination, {
    platform: 'win32', renameOperation: async () => { attempts += 1; throw failure; }
  }), error => error === failure);
  assert.equal(attempts, 1);
  assert.equal(await readFile(join(staging, 'source.txt'), 'utf8'), 'source');
  assert.equal(await readFile(join(destination, 'unknown.txt'), 'utf8'), 'unknown');
});

test('returns a successful rename result without delay', async () => {
  const expected = Object.freeze({ published: true });
  let attempts = 0;
  let sleeps = 0;
  const result = await publishRuntimeDirectory('staging', 'destination', {
    platform: 'win32', renameOperation: async () => { attempts += 1; return expected; },
    sleep: async () => { sleeps += 1; }
  });
  assert.equal(result, expected);
  assert.equal(attempts, 1);
  assert.equal(sleeps, 0);
});
