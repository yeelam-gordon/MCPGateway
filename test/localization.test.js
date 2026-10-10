import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

test('localized quickstarts retain truthful benefits, first workflows and canonical client navigation', async () => {
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
    const selected = new Map([
      ['zh-CN', ['共享本地 MCP', 'Windows 是主要测试平台', '目前必须先通过 Copilot CLI', '只读任务', '空结果', '配置和备份可能含凭据', '共享不等于离线', '兼容性和验证程度不同', '未知结果的超时不能重试']],
      ['ja', ['ローカル MCP サーバーを共有', '主な検証環境は Windows', '初期導入は Copilot CLI', '承認済みの読み取り', '空の結果', '設定とバックアップには資格情報', 'オフライン動作', '互換性と検証範囲が異なります', '結果不明のタイムアウトは再試行せず']],
      ['es', ['servidores MCP locales', 'Windows es la plataforma principal de pruebas', 'arranque actual requiere Copilot CLI', 'lectura aprobada', 'resultado vacío', 'copias pueden contener credenciales', 'no implica funcionamiento sin conexión', 'verificación varían según el cliente', 'resultado desconocido, no reintentes']],
      ['pt-BR', ['servidores MCP locais', 'Windows é a principal plataforma testada', 'instalação inicial exige Copilot CLI', 'leitura aprovada', 'resultado vazio', 'backups podem conter credenciais', 'não significa operar offline', 'verificação variam entre clientes', 'resultado desconhecido, não repita']],
      ['fr', ['serveurs MCP locaux', 'Windows est la principale plateforme testée', 'initiale passe actuellement par Copilot CLI', 'lecture approuvée', 'résultat vide', 'sauvegardes peuvent contenir des identifiants', 'ne signifie pas un fonctionnement hors ligne', 'vérification diffèrent selon les clients', 'résultat inconnu, ne réessayez pas']],
      ['de', ['Lokale MCP-Server', 'Windows ist die hauptsächlich getestete Plattform', 'Ersteinrichtung erfolgt derzeit über Copilot CLI', 'genehmigten Lesezugriff', 'leeres Ergebnis', 'Sicherungen können Zugangsdaten enthalten', 'weder Offline-Betrieb', 'Prüftiefe unterscheiden sich je nach Client', 'unbekanntem Ergebnis nicht erneut aufrufen']]
    ]);
    if (selected.has(language.code)) {
      assert.match(text, /^# MCPGateway /m, language.code);
      const migration = text.split(/\r?\n\r?\n/).find(paragraph => paragraph.includes('**10**'));
      assert.ok(migration && !migration.includes('#cross-client-migration'), `${language.code}: short migration example separate from validation guidance`);
      assert.equal((text.match(/^- /gm) ?? []).length, 3, `${language.code}: scannable migration safeguards`);
      assert.match(text, /Node\.js 24/, language.code);
      for (const phrase of selected.get(language.code)) {
        assert.ok(text.includes(phrase), `${language.code}: ${phrase}`);
      }
      for (const required of [
        'copilot plugin marketplace add yeelam-gordon/MCPGateway',
        'copilot plugin install shared-mcp-gateway@mcp-gateway',
        '/mcp-gateway-setup', 'readinessCommand',
        'list_servers', 'search_tools', 'get_tool_schema', 'call_tool',
        'requiresExclusiveAccess: true', 'claim_server', 'release_server',
        '../../README.md#first-use', '../CLIENTS.md#compatibility-summary',
        '../REFERENCE.md#state-and-privacy', '../REFERENCE.md#setup-recovery',
        'Gemini CLI', 'Antigravity', 'Kimi'
      ]) {
        assert.ok(text.includes(required), `${language.code}: ${required}`);
      }
      assert.doesNotMatch(text, /\b(?:1[.,]5|7[.,]5)\s*GB/, `${language.code}: no hypothetical RAM promise`);
    } else {
      assert.ok(!text.includes('copilot plugin install'), `${language.code}: use the canonical install guide`);
      const firstTable = text.match(/^\|.+(?:\r?\n\|.+)+/m)?.[0];
      assert.ok(firstTable, `${language.code}: benefits table`);
      assert.equal(firstTable.split(/\r?\n/).length, 4, `${language.code}: exactly two benefit rows`);
      const highlighted = (firstTable.match(/\*\*[^*\r\n]+\*\*/g) ?? []).join(' ');
      for (const number of [/\b7[.,]5\b/, /\b1[.,]5\b/, /\b6\b/, /\b99[.,]4\s*%/, /\b1[., \u00a0\u202f]?000\b/]) {
        assert.match(highlighted, number, `${language.code}: highlighted illustrative figures`);
      }
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
