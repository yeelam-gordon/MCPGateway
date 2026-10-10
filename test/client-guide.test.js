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

test('README explains local sharing and a qualified first workflow without losing recovery', async () => {
  const [readme, guide, reference] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/CLIENTS.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/REFERENCE.md', import.meta.url), 'utf8')
  ]);
  const opening = readme.slice(0, readme.indexOf('## Contents'));
  assert.match(opening, /^# MCPGateway .*Share local MCP servers across coding-agent sessions/m);
  assert.match(opening, /shares configured backends across sessions/);
  assert.match(opening, /not an enterprise API-governance service/);
  assert.match(opening, /Node\.js 24\+, npm, Git, Copilot CLI with plugin support/);
  assert.match(opening, /existing MCP integrations with their required authentication/);
  assert.match(opening, /bootstrap starts through Copilot CLI/);
  assert.match(opening, /Windows is the primary tested platform/);
  assert.match(opening, /compatibility and verification levels/);
  assert.match(opening, /plugin installation alone does not merge their configurations/);
  assert.match(opening, /six gateway tools/);
  assert.match(opening, /No measured RAM or token savings are promised/);
  assert.match(opening, /neither enlarges the model's context window nor makes memory usage constant/);
  assert.match(opening, /native integration is not guaranteed/);
  assert.match(opening, /Gemini CLI has no documented setup route here \(Antigravity is a separate client\)/);
  assert.match(opening, /Kimi is adapter-tested only/);
  assert.doesNotMatch(readme, /^## Benefits$|^## How to install$/m);
  for (const command of [
    'copilot plugin marketplace add yeelam-gordon/MCPGateway',
    'copilot plugin install shared-mcp-gateway@mcp-gateway'
  ]) {
    assert.ok(readme.includes(command));
    assert.ok(guide.includes(command));
  }
  const workflow = readme.slice(readme.indexOf('## First useful workflow:'), readme.indexOf('## Safety and operations'));
  assert.match(workflow, /\/mcp-gateway-setup/);
  assert.match(workflow, /review the preview, and approve only intended changes/);
  assert.match(workflow, /Close and reopen Copilot.*exact returned `readinessCommand`/);
  assert.match(workflow, /A check-only command does not start an absent gateway/);
  assert.match(workflow, /backup and rollback commands/);
  assert.match(workflow, /tool inputs, not shell commands/);
  assert.match(workflow, /placeholders.*not shipped aliases/);
  assert.match(workflow, /do not submit the templates unchanged/);
  const discoveryTools = ['list_servers', 'search_tools', 'get_tool_schema', 'call_tool'];
  let previousIndex = -1;
  for (const tool of discoveryTools) {
    const index = workflow.indexOf('`' + tool + '`');
    assert.ok(index > previousIndex, `${tool}: ordered discovery/schema/call workflow`);
    previousIndex = index;
  }
  for (const field of ['`servers`', '`name`', '`state`', '`requiresExclusiveAccess`', '`tools`', '`tool.inputSchema`']) {
    assert.ok(workflow.includes(field), `${field}: observable result`);
  }
  assert.match(workflow, /only if the schema permits an empty object/);
  assert.match(workflow, /any error indication; a gateway response alone is not proof/);
  assert.match(workflow, /claim_server.*before search\/schema\/call/);
  assert.match(workflow, /release_server.*after all calls settle/);
  assert.match(workflow, /Non-exclusive backends need no claim/);
  assert.match(workflow, /unknown outcome, do not retry/);
  assert.match(workflow, /releasing is not a safe unblock/);
  assert.match(workflow, /second session.*same connector and catalog/);
  assert.match(workflow, /Discovery is not permission to execute a tool/);
  assert.match(workflow, /local sharing does not make them offline/);
  assert.match(readme, /private backups/);
  assert.match(readme, /Stop using the gateway/);
  assert.match(readme, /finish active workflows and let outstanding calls settle/);
  assert.match(readme, /not runtime shutdown/);
  assert.match(readme, /Plugin removal does not remove the stable runtime/);
  assert.match(readme, /Full runtime shutdown\/decommission has no documented general-purpose command here/);
  assert.match(readme, /Do not delete credentials, private state, conversation history or unrelated backends/);
  assert.match(readme, /or stop unrelated processes/);
  assert.ok(readme.includes('](docs/REFERENCE.md#cross-client-migration-recovery)'));
  assert.match(readme, /Keep configuration and backups private.*they may contain credentials/);
  assert.match(readme, /Do not publish them, paste them into public issues, or commit them to version control/);
  assert.match(readme, /237 local checks passed for v0\.6\.0/);
  assert.match(readme, /historically reported by the maintainer.*https:\/\/github\.com\/yeelam-gordon\/MCPGateway\/releases\/tag\/v0\.6\.0/);
  assert.match(readme, /historical execution claim has not been independently reproduced here/);
  assert.match(readme, /not a result for the current checkout/);
  assert.match(readme, /preserve unrelated client settings and refuse conflicting gateway aliases/);
  assert.match(reference, /may contain credentials/);
  assert.match(reference, /not additionally encrypted/);
  assert.match(guide, /copilot plugin install shared-mcp-gateway@mcp-gateway/);
  assert.match(guide, /Preview makes no changes/);
  assert.match(guide, /apply backs up both configurations/);
  assert.match(reference, /Move-Item -LiteralPath \$cache -Destination \$backup -ErrorAction Stop/);
  assert.match(reference, /rollbackCommand/);
  assert.match(reference, /unknown outcome/);
});
