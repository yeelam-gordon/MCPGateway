import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('each client has linked install and upgrade sections in the guide and README', async () => {
  const [readme, guide] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/CLIENTS.md', import.meta.url), 'utf8')
  ]);
  assert.match(guide, /locate the installed plugin root and report its absolute path without applying changes/);
  assert.match(guide, /Replace `<plugin-root>`/);
  assert.match(guide, /Do not guess or hardcode a plugin-cache path/);
  for (const client of [
    'copilot-cli', 'vs-code', 'claude-code', 'codex',
    'opencode', 'qwen-code', 'kimi-cli', 'antigravity-cli'
  ]) {
    assert.ok(guide.includes(`](#${client})`), `${client}: guide contents entry`);
    assert.ok(guide.includes(`id="${client}"`), `${client}: section`);
    for (const action of ['install', 'upgrade']) {
      const anchor = `${client}-${action}`;
      assert.ok(guide.includes(`id="${anchor}"`), `${anchor}: subsection`);
      assert.ok(readme.includes(`](docs/CLIENTS.md#${anchor})`), `${anchor}: README entry`);
    }
  }
});

test('README presents one benefits table and delegates detailed guides without losing recovery', async () => {
  const [readme, guide, reference] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/CLIENTS.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/REFERENCE.md', import.meta.url), 'utf8')
  ]);
  const opening = readme.slice(0, readme.indexOf('## Contents'));
  assert.equal((opening.match(/^\| \*\*/gm) ?? []).length, 2);
  assert.match(opening, /\*\*Save RAM\*\*/);
  assert.match(opening, /\*\*Keep context for your work\. Tools on demand\.\*\*/);
  assert.doesNotMatch(opening, /MCP servers|backends/i);
  assert.match(opening, /6 gateway tools/);
  assert.match(opening, /Definition counts are not token savings/);
  assert.match(opening, /Illustrative example/);
  assert.doesNotMatch(readme, /^## Benefits$|^## How to install$/m);
  assert.doesNotMatch(readme, /copilot plugin install/);
  assert.match(guide, /copilot plugin install shared-mcp-gateway@mcp-gateway/);
  assert.match(guide, /Preview makes no changes/);
  assert.match(guide, /apply backs up both configurations/);
  assert.match(reference, /Move-Item -LiteralPath \$cache -Destination \$backup -ErrorAction Stop/);
  assert.match(reference, /rollbackCommand/);
  assert.match(reference, /unknown outcome/);
});
