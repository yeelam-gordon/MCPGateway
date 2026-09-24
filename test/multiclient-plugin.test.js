import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const clientNames = /\b(?:Copilot|Claude|Qwen|Codex|VS\s*Code)\b/i;
const unsupportedRuntimeFields = [
  'agents',
  'channels',
  'commands',
  'contextFileName',
  'entry',
  'hooks',
  'mcpServers',
  'settings',
  'workflows'
];

const assertMetadataOnly = manifest => {
  assert.doesNotMatch(manifest.description, clientNames);
  for (const field of unsupportedRuntimeFields) {
    assert.equal(manifest[field], undefined, `${field} must not embed client runtime logic`);
  }
};

test('portable Agent Plugins manifest uses canonical fixed skill discovery', async () => {
  const plugin = await readJson('plugin.json');
  const pkg = await readJson('package.json');

  assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(plugin.name, 'shared-mcp-gateway');
  assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.license, pkg.license);
  assert.equal(plugin.skills, undefined);
  assert.deepEqual(Object.keys(plugin).sort(), [
    '$schema',
    'description',
    'keywords',
    'license',
    'name',
    'repository',
    'version'
  ]);
  assertMetadataOnly(plugin);

  await access(resolve(root, 'skills/mcp-gateway-setup/SKILL.md'));
});

test('Claude and Qwen manifests stay thin, official client adapters', async () => {
  const portable = await readJson('plugin.json');
  const claude = await readJson('.claude-plugin/plugin.json');
  const qwen = await readJson('qwen-extension.json');

  for (const manifest of [claude, qwen]) {
    assert.equal(manifest.name, portable.name);
    assert.equal(manifest.version, portable.version);
    assert.equal(manifest.description, portable.description);
    assertMetadataOnly(manifest);
  }

  assert.deepEqual(Object.keys(claude).sort(), [
    'author',
    'description',
    'keywords',
    'license',
    'name',
    'repository',
    'version'
  ]);
  assert.deepEqual(Object.keys(qwen).sort(), ['description', 'name', 'skills', 'version']);
  assert.equal(claude.skills, undefined, 'Claude discovers the plugin-root skills directory by default');
  assert.equal(qwen.skills, 'skills');
  assert.equal(claude.$schema, undefined);
  assert.equal(qwen.$schema, undefined);

  for (const path of ['.mcp.json', 'mcp.json', 'hooks.json', 'agents']) {
    await assert.rejects(access(resolve(root, path)), { code: 'ENOENT' });
  }
});
