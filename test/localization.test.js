import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

test('localized quickstarts retain commands, canonical links, and language navigation', async () => {
  const { languages } = JSON.parse(await readFile(new URL('docs/i18n/languages.json', root), 'utf8'));
  assert.equal(languages.length, 16);
  assert.equal(new Set(languages.map(language => language.code)).size, 16);
  const english = await readFile(new URL('README.md', root), 'utf8');
  for (const language of languages) {
    assert.ok(language.name);
    const url = new URL(language.path, root);
    const text = await readFile(url, 'utf8');
    if (language.code === 'en') continue;
    assert.ok(english.includes(`](${language.path})`), language.code);
    for (const command of [
      'copilot plugin marketplace add yeelam-gordon/MCPGateway',
      'copilot plugin install shared-mcp-gateway@mcp-gateway',
      '/mcp-gateway-setup'
    ]) assert.ok(text.includes(command), `${language.code}: ${command}`);
    assert.ok(text.includes('../../README.md'), language.code);
    assert.ok(text.includes('../../LICENSE'), language.code);
    assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, language.code);
    for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (/^https?:/.test(match[1])) continue;
      await access(new URL(match[1], url));
    }
  }
});
