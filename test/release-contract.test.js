import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { VERSION } from '../src/version.js';

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('release metadata stays consistent', async () => {
  const [pkg, lock, plugin, marketplace, license] = await Promise.all([
    readJson('../package.json'),
    readJson('../package-lock.json'),
    readJson('../plugin.json'),
    readJson('../.github/plugin/marketplace.json'),
    readFile(new URL('../LICENSE', import.meta.url), 'utf8')
  ]);

  assert.match(pkg.version, /^0\.\d+\.\d+$/);
  assert.equal(pkg.license, 'MIT');
  assert.equal(plugin.license, 'MIT');
  assert.match(license, /^MIT License\r?\n/);

  assert.equal(plugin.name, pkg.name);
  assert.equal(plugin.version, pkg.version);
  assert.equal(VERSION, pkg.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[''].engines, pkg.engines);

  assert.equal(marketplace.metadata.version, pkg.version);
  assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0);
  for (const entry of marketplace.plugins) {
    assert.equal(entry.version, pkg.version);
  }

  if (process.env.RELEASE_TAG) {
    assert.equal(process.env.RELEASE_TAG, `v${pkg.version}`);
  }
});

test('CI keeps fresh setup and upgrade verification as an explicit gate', async () => {
  const pkg = await readJson('../package.json');
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(pkg.scripts['test:lifecycle'], /test\/lifecycle-e2e\.test\.js/);
  assert.match(workflow, /run: npm run test:lifecycle/);
  assert.match(pkg.scripts['test:sync'], /test\/backend-sync\.test\.js/);
  assert.match(workflow, /run: npm run test:sync/);
  assert.match(pkg.scripts['test:clients'], /test\/client-config\.test\.js/);
  assert.match(pkg.scripts['test:clients'], /test\/localization\.test\.js/);
  assert.match(workflow, /run: npm run test:clients/);
});
