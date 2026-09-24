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
