import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

test('localized quickstarts retain the numbered benefits and canonical client navigation', async () => {
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
    for (const client of [
      'copilot-cli', 'vs-code', 'claude-code', 'codex',
      'opencode', 'qwen-code', 'kimi-cli', 'antigravity-cli'
    ]) {
      for (const action of ['install', 'upgrade']) {
        assert.ok(text.includes(`](../CLIENTS.md#${client}-${action})`), `${language.code}: ${client} ${action}`);
      }
    }
    assert.ok(text.includes('../REFERENCE.md'), language.code);
    assert.ok(text.includes('../CLIENTS.md#cross-client-migration'), language.code);
    for (const count of ['10', '2', '12']) {
      assert.ok(text.includes(`**${count}**`), `${language.code}: cross-client merge count`);
    }
    assert.ok(!text.includes('copilot plugin install'), `${language.code}: use the canonical install guide`);
    const firstTable = text.match(/^\|.+(?:\r?\n\|.+)+/m)?.[0];
    assert.ok(firstTable, `${language.code}: benefits table`);
    assert.equal(firstTable.split(/\r?\n/).length, 4, `${language.code}: exactly two benefit rows`);
    const highlighted = (firstTable.match(/\*\*[^*\r\n]+\*\*/g) ?? []).join(' ');
    for (const number of [/\b7[.,]5\b/, /\b1[.,]5\b/, /\b6\b/, /\b99[.,]4\s*%/, /\b1[., \u00a0\u202f]?000\b/]) {
      assert.match(highlighted, number, `${language.code}: highlighted illustrative figures`);
    }
    assert.ok(text.includes('../../README.md'), language.code);
    assert.ok(text.includes('../../LICENSE'), language.code);
    assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, language.code);
    for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (/^https?:/.test(match[1])) continue;
      await access(new URL(match[1], url));
    }
  }
});
