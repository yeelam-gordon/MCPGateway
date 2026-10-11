import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const text = path => readFile(new URL(path, root), 'utf8');

test('concise entry reaches all canonical client installation and upgrade routes', async () => {
  const [readme, guide] = await Promise.all([text('README.md'), text('docs/CLIENTS.md')]);
  assert.ok(readme.includes('](docs/CLIENTS.md)'));
  for (const client of ['copilot-cli', 'vs-code', 'claude-code', 'codex', 'opencode', 'qwen-code', 'kimi-cli', 'antigravity-cli']) {
    assert.ok(guide.includes(`](#${client})`));
    for (const action of ['install', 'upgrade']) assert.ok(guide.includes(`id="${client}-${action}"`), `${client}: ${action}`);
  }
  for (const boundary of ['locate the installed plugin root and report its absolute path without applying changes', 'Do not guess or hardcode a plugin-cache path', 'Preview makes no changes', 'apply backs up both configurations']) assert.ok(guide.includes(boundary), boundary);
});

test('entry keeps one safe assisted route and moves exact manual inputs to reachable reference', async () => {
  const [readme, reference, guide] = await Promise.all([text('README.md'), text('docs/REFERENCE.md'), text('docs/CLIENTS.md')]);
  assert.match(readme, /^# MCPGateway .*Share local MCP servers across agents/m);
  assert.ok(readme.includes('<summary>Languages (16)</summary>'));
  assert.ok(readme.indexOf('<summary>') < readme.indexOf('<img'));
  assert.match(readme, /<img src="assets\/mcp-gateway-benefits\.png"[^>]*width="780"/);
  assert.ok(readme.split('\n').length <= 90, 'entry expansion guardrail, not comprehension proof');
  assert.equal((readme.match(/copilot plugin install /g) ?? []).length, 1);
  for (const command of ['copilot plugin marketplace add yeelam-gordon/MCPGateway', 'copilot plugin install shared-mcp-gateway@mcp-gateway']) {
    assert.ok(readme.includes(command)); assert.ok(guide.includes(command));
  }
  const action = readme.indexOf('```powershell');
  for (const requirement of ['Node.js 24+', 'npm, Git, Copilot CLI with plugin support', 'existing MCP integrations with their required authentication', 'may contain credentials', 'persistent runtime', 'docs/REFERENCE.md#planned-exit']) assert.ok(readme.indexOf(requirement) >= 0 && readme.indexOf(requirement) < action, requirement);
  for (const link of ['readiness-command-object', 'first-shared-workflow', 'unknown-exclusive-result', 'setup-recovery', 'native-http-oauth', 'planned-exit']) {
    assert.ok(readme.includes(`docs/REFERENCE.md#${link}`));
    assert.ok(reference.includes(`id="${link}"`) || reference.toLowerCase().includes(`## ${link.replaceAll('-', ' ')}`), link);
  }
  for (const instruction of ['/mcp-gateway-setup', 'Review the preview and approve only intended changes', 'Close and reopen Copilot', 'exact returned `readinessCommand`', 'check-only command does not start an absent gateway', 'private backup and rollback', 'schema-valid arguments', 'authorized non-sensitive test values', 'Obtain normal approvals', 'claim_server', 'release_server', 'non-exclusive backends need no claim', 'actual record or documented empty result', 'check errors', 'Never retry an unknown outcome', 'same connector/catalog', 'not PID identity or RAM savings']) assert.ok(readme.includes(instruction), instruction);
  const flow = reference.slice(reference.indexOf('<a id="first-shared-workflow">'));
  for (const field of ['`servers`', '`name`', '`state`', '`requiresExclusiveAccess`', '`tools`', '`tool.inputSchema`', 'only if the schema permits an empty object', 'tool inputs, not shell commands', 'do not submit the templates unchanged', 'a gateway response alone is not proof']) assert.ok(flow.includes(field), field);
  for (const guard of ['after all calls settle', 'keep it blocked', 'release/disconnect is not cancellation', 'Reclaim ownership after restart', 'no parallel bypass process']) assert.ok(readme.includes(guard), guard);
  for (const truth of ['clients restored; owned daemon stopped; private data retained', 'PID or port alone is not ownership proof', 'not a supported standalone shutdown CLI', 'check-only readiness failure alone does not prove shutdown', 'no connector has restarted it', 'unrelated settings added since that backup need an explicit preservation decision', 'not additionally encrypted']) assert.ok(reference.includes(truth), truth);
  assert.ok(readme.includes('Configuration rollback is not runtime shutdown'));
  assert.ok(readme.includes('client rollback/plugin removal does not stop the daemon'));
  const readiness = reference.slice(reference.indexOf('<a id="readiness-command-object">'), reference.indexOf('<a id="cross-client-migration-recovery">'));
  for (const value of ['UTF-8', 'not the whole output', '.command', '.args', 'ConvertFrom-Json', '& $command @commandArgs', 'not arbitrary web/service data']) assert.ok(readiness.includes(value), value);
  assert.ok(!readiness.includes('Invoke-Expression'));
  for (const match of readme.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) if (!/^https?:/.test(match[1])) await access(new URL(match[1], root));
});

test('canonical evidence retains numerical assumptions, adverse measurements and continuity boundaries', async () => {
  const [readme, benchmark, reference] = await Promise.all([text('README.md'), text('docs/BENCHMARK.md'), text('docs/REFERENCE.md')]);
  assert.ok(readme.includes('docs/BENCHMARK.md'));
  for (const value of ['5 agent sessions', 'same 12 connections', 'Illustrative assumption, not a benchmark', '5 × 1.5 GB = 7.5 GB', '1.5 GB + gateway & connector overhead', '7.5 GB - 1.5 GB = 6 GB', 'Total savings are unknown until measured', 'not RAM for five models', '(1000 - 6) / 1000 × 100 = 99.4%', 'not 99.4% fewer tokens', 'Selected schemas cost more when requested', 'not RSS performance', '12 stdio-backed services', '5 × 12 = 60', '60 - 12 = 48', '48 / 60 × 100 = 80%', 'only `k` used backends', 'unused backends do not start', 'not 80% faster elapsed startup', 'startup-count illustration does not measure latency']) assert.ok(benchmark.includes(value), value);
  for (const value of ['426.2 ms', '21.1 ms', '19.0 ms', '503.5 ms', '894.3 ms', '1886.7 ms', '5 → 1', '5 → 7', '357.0 MiB → 564.0 MiB', 'unique physical memory and private bytes were not measured', 'separate assumption, not this measurement', 'not representative of heavier field services', 'Source revision for the timing run was not recorded']) assert.ok(benchmark.includes(value), value);
  assert.ok(readme.indexOf('357.0 → 564.0 MiB') < readme.indexOf('```powershell'));
  assert.ok(readme.indexOf('1886.7 versus 503.5 ms') < readme.indexOf('```powershell'));
  for (const boundary of ['not automatic hot reload', 'restart only the owned gateway', 'one initialization', 'not independently tested branded-agent conversation UIs', 'Gateway restart loses leases', 'interrupted calls are not silently replayed', 'not a universal “no agent restart” guarantee', 'initial registration and runtime/connector upgrades']) assert.ok(benchmark.includes(boundary), boundary);
  for (const historical of ['237 local checks passed for v0.6.0', 'historically reported by the maintainer', 'historical execution claim has not been independently reproduced here', 'not a result for the current checkout']) assert.ok(benchmark.includes(historical), historical);
  assert.ok(benchmark.includes("neither enlarges the model's context window nor makes memory usage constant"));
  assert.ok(reference.includes('a **new claim**'));
});

test('editable hero contains only three action groups and no poster paragraphs', async () => {
  const svg = await text('assets/mcp-gateway-benefits.svg');
  const png = await readFile(new URL('assets/mcp-gateway-benefits.png', root));
  assert.equal(png.readUInt32BE(16), 1536); assert.equal(png.readUInt32BE(20), 600);
  assert.equal((svg.match(/height="568" rx="24"/g) ?? []).length, 3);
  const labels = [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map(match => match[1]);
  assert.ok(labels.join(' ').split(/\s+/).length <= 50, 'visible text expansion guardrail, not human approval');
  for (const label of ['backend memory', 'startup work', 'MCP connection', 'Settled owned restart', 'SDK/stdio experiment']) assert.ok(labels.some(text => text.includes(label)), label);
  assert.ok(!svg.includes('Agents keep working'));
  assert.ok(!svg.includes('foreignObject'));
});
