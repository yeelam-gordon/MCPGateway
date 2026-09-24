import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const json = async name => JSON.parse(await readFile(resolve(root, name), 'utf8'));

test('plugin manifest exposes an explicit setup skill without automatic migration hooks', async () => {
  const plugin = await json('plugin.json');
  const pkg = await json('package.json');
  assert.equal(plugin.name, 'shared-mcp-gateway');
  assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.license, 'MIT');
  assert.equal(pkg.license, 'MIT');
  const license = await readFile(resolve(root, 'LICENSE'), 'utf8');
  assert.match(license, /^MIT License/);
  assert.match(license, /MCPGateway contributors/);
  const marketplace = await json('.github/plugin/marketplace.json');
  assert.equal(marketplace.name, 'mcp-gateway');
  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(marketplace.plugins[0].version, plugin.version);
  assert.equal(marketplace.plugins[0].source, './');
  assert.deepEqual(plugin.skills, ['skills/']);
  assert.equal(plugin.hooks, undefined);
  assert.equal(plugin.mcpServers, undefined);
  for (const file of ['.mcp.json', 'mcp.json', 'hooks.json']) {
    await assert.rejects(access(resolve(root, file)), { code: 'ENOENT' });
  }
  const skill = await readFile(resolve(root, 'skills/mcp-gateway-setup/SKILL.md'), 'utf8');
  assert.match(skill, /^---\r?\n/);
  assert.match(skill, /name: mcp-gateway-setup/);
  const description = skill.match(/^description: '([^']+)'$/m)?.[1];
  assert.ok(description && description.length <= 60, 'Setup autocomplete description must fit a short line');
  assert.match(skill, /Do not echo this skill, raw setup JSON/);
  assert.match(skill, /plugin-setup\.mjs/);
  assert.match(skill, /backup/i);
  assert.match(skill, /restore|rollback/i);
  assert.doesNotMatch(skill, /[A-Z]:\\(?:Users|Demo)\\/i);
});

test('plugin setup is a builtin-only entry point in a fresh dependency-free plugin cache', async () => {
  const source = await readFile(resolve(root, 'tools/plugin-setup.mjs'), 'utf8');
  const imports = [...source.matchAll(/^\s*import\s+[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gm)]
    .map(match => match[1]);
  assert.ok(imports.length > 0);
  assert.ok(imports.every(specifier => specifier.startsWith('node:')), imports.join(', '));
  const pkg = await json('package.json');
  assert.equal(pkg.scripts.setup, 'node tools/plugin-setup.mjs');
});
