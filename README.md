# MCPGateway — Share local MCP servers across agents

<a id="languages"></a>
<details>
<summary>Languages / 语言 / 言語 / اللغات (16)</summary>

[English](README.md) · [简体中文](docs/i18n/README.zh-CN.md) · [繁體中文](docs/i18n/README.zh-TW.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md) · [Español](docs/i18n/README.es.md) · [Français](docs/i18n/README.fr.md) · [Deutsch](docs/i18n/README.de.md) · [Português (Brasil)](docs/i18n/README.pt-BR.md) · [Italiano](docs/i18n/README.it.md) · [Русский](docs/i18n/README.ru.md) · [العربية](docs/i18n/README.ar.md) · [हिन्दी](docs/i18n/README.hi.md) · [Bahasa Indonesia](docs/i18n/README.id.md) · [Türkçe](docs/i18n/README.tr.md) · [Tiếng Việt](docs/i18n/README.vi.md)

</details>

Share local MCP backends across coding sessions: avoid duplicate backend memory, reuse repeated startup work, and make configuration-only backend additions without restarting the current agent-side MCP connection — verified on the SDK/stdio route. Net resource gains depend on overhead.

[Start via Copilot CLI](#first-use) · [Client verification](docs/CLIENTS.md#compatibility-summary) · [Evidence](#resource-examples)

<img src="assets/mcp-gateway-benefits.png" alt="Five agent sessions share configured backends instead of five backend copies" width="780">

Concept artwork with English labels: five duplicated backend sets become one shared set—not a runtime screenshot or benchmark.

- **Avoid duplicate backend memory:** Illustration: 5 × 1.5 GB sets → one; 6 GB duplication avoided **before** gateway/connector overhead, not measured savings.
- **Reuse repeated startup work:** If all 5 sessions use 12 stdio services: 60 → 12 backend starts, not 80% faster elapsed startup.
- **Add backends through configuration only; keep the current agent connection:** SDK/stdio: 1 initialization survives a settled owned-gateway restart; the connector remains, not hot reload or verified native conversation UI. First registration/runtime upgrades may need client restart. [SDK/stdio](docs/BENCHMARK.md#configuration-only-connection-continuity)

<a id="contents"></a>
[First use](#first-use) · [Resource evidence](#resource-examples) · [Mechanism](#how-it-works) · [Clients](#install-and-upgrade-by-client) · [Safety / recovery](#safety-and-operations) · [Development](#development)

**Fit / skip:** best for multiple sessions sharing the same configured backends and connector/catalog. One session or lightweight backends may not repay gateway overhead: our fixture had higher summed process working set and had slower cold startup.

<a id="benefits"></a>
<a id="reuse-backends-discover-tools-on-demand"></a>
<a id="first-use"></a>
## First useful workflow: find and call an existing backend tool

Requires Node.js 24+, npm, Git, Copilot CLI with plugin support and existing MCP integrations with their required authentication; current bootstrap starts through Copilot CLI. Keep configuration/backups private—they may contain credentials. Other-client compatibility and verification levels differ.

This installs a persistent runtime: client rollback is not daemon shutdown. Review [trial rollback and owned-runtime exit](docs/REFERENCE.md#planned-exit) before installation.

1. Follow [Install the shared core](docs/CLIENTS.md#shared-core-install):

   ```powershell
   copilot plugin marketplace add yeelam-gordon/MCPGateway
   copilot plugin install shared-mcp-gateway@mcp-gateway
   ```

   Start Copilot CLI, invoke `/mcp-gateway-setup`, review the preview, and approve only intended changes. Close and reopen Copilot, then run the exact returned `readinessCommand`. A check-only command does not start an absent gateway. Keep the returned backup and rollback commands.

`readinessCommand` is the returned object, not a shell string. Set `$readinessCommand` to that exact object from the approved setup result; then run the PowerShell example below. `.command` keeps the executable path intact and `.args` keeps every returned argument in order, including paths with spaces or quotes. Do not join the array into one argument or invent paths. This check does not start an absent gateway.

Save only the `readinessCommand` JSON object from your approved setup result—not the whole output—as UTF-8 `readiness-command.json` in your private current folder. Keep the known approved executable `.command` and every `.args` value exact; do not join arguments or guess paths. Parse only this setup JSON, not arbitrary web/service data; JSON parsing is not evaluation. Treat the file as private because argument contents depend on your setup.

```powershell
$readinessCommand = Get-Content -Raw -LiteralPath '.\readiness-command.json' | ConvertFrom-Json
$command = $readinessCommand.command
$commandArgs = @($readinessCommand.args)
& $command @commandArgs
```
> Use the shared gateway for [my authorized read-only task]: list configured servers, discover a suitable tool, inspect its schema and prepare schema-valid arguments using authorized non-sensitive test values. Obtain normal approvals; claim an exclusive backend before calling it and release after calls settle. Show the actual result. Never retry an unknown outcome; use the operator handoff.

Replace only the bracketed task; actual aliases/tool names come from discovery, not invented defaults.

2. Choose a harmless, authorized read-only task on an integration you already use: for example, look up a record you are allowed to read. In that client, use the gateway tool calls below. These are **tool inputs, not shell commands**. Angle-bracket values are **placeholders**, not shipped aliases, tool names, credentials, or literal arguments. Replace them with values from your own catalog and selected schema; do not submit the templates unchanged.

   | Step | Gateway tool and input | Expected observable result |
   |---|---|---|
   | List configured integrations | `list_servers` with `{}` | `servers` lists redacted entries with `name`, `state`, and `requiresExclusiveAccess`; listing does not connect to every backend. Choose an existing `name` as `<backend-alias>`. |
   | Find a read-only capability | `search_tools` with `{"server":"<backend-alias>","query":"<term-from-your-task>"}` | `tools` contains matching names/descriptions and the ownership flag, not full input schemas. Choose a returned `name` as `<returned-tool-name>` after checking what it does. |
   | Inspect that tool | `get_tool_schema` with `{"server":"<backend-alias>","tool":"<returned-tool-name>"}` | The returned `tool.inputSchema` gives required fields, types, and constraints. Fill an arguments object from that schema using only authorized, non-sensitive test values. |
   | Required ownership before execution | If `requiresExclusiveAccess: true`, use `claim_server` with `{"server":"<backend-alias>"}` before `call_tool` | Discovery/schema lookup do not require a claim; execution does. Non-exclusive backends need no claim. |
   | Perform the approved read | `call_tool` with `{"server":"<backend-alias>","tool":"<returned-tool-name>","arguments":{}}` **only if the schema permits an empty object**; otherwise replace `{}` with the complete schema-valid object you just prepared | The backend's result is preserved. Check its actual content for the expected record or documented empty result and any error indication; a gateway response alone is not proof the read succeeded. |

3. If discovery says `requiresExclusiveAccess: true`, use `claim_server` with `{"server":"<backend-alias>"}` once **before `call_tool`**, and `release_server` with the same input after all calls settle. Non-exclusive backends need no claim. If an exclusive call times out with an unknown outcome, do not retry: review active work and use the [unknown-exclusive-result operator handoff](docs/REFERENCE.md#unknown-exclusive-result); releasing is not a safe unblock.
4. In a second session registered to the **same connector and catalog**, repeat list/search for the same alias. It should expose the same configured backend, reusing its initialized catalog rather than requiring a second backend configuration. This checks the first shared workflow, not measured memory savings. Discovery is not permission to execute a tool. After initialization, `list_servers` should show `ready` and search should expose the same cached catalog. Alias equality alone does not prove PID identity or RAM savings; see the [public process-reuse fixture](docs/BENCHMARK.md#method). [Catalog-cache test](test/catalog-scale.test.js).

If the list is empty, check the selected configuration/migration preview. If search returns no matches, use a narrower term from your backend's own tool descriptions; there is no universal backend tool name. For authentication errors or failed readiness, follow the [authentication guidance](docs/REFERENCE.md#native-http-oauth) and [setup recovery/rollback](docs/REFERENCE.md#setup-recovery), not repeated calls or a parallel bypass process. Backend requests can still contact remote services; local sharing does not make them offline.

<a id="resource-examples"></a>
## Illustrative resource model and measured limits

Use comparable direct/shared measurements for the same workload: duplicated backend cost must exceed added sharing overhead. `(sessions - 1) × backend-set cost > added sharing overhead` is an illustrative decision rule in the same metric, not a measured universal break-even threshold. Measure first-use latency and summed process working set separately; warm catalog reuse does not guarantee faster cold startup.

**Avoid duplicate backend RAM**

Illustrative assumption, not a benchmark: 5 agent sessions each need the same 12 connections; one complete backend set uses 1.5 GB. Compatible sessions share actual backend processes through the same connector/catalog.

| Deployment | Backend RAM |
|---|---|
| Independent copies | 5 × 1.5 GB = 7.5 GB |
| Shared backend set | 1.5 GB + gateway & connector overhead |

Duplicated backend RAM avoided before overhead: 7.5 GB - 1.5 GB = 6 GB. Total savings are unknown until measured. The 1.5 GB assumption is not constant across workloads or clients; this is backend RAM, not RAM for five models.

**Reuse startup work too.** Assuming 12 stdio-backed services, all used by each of 5 sessions, independent copies require up to `5 × 12 = 60` backend starts versus `12` shared: `60 - 12 = 48` duplicate starts avoided, `48 / 60 × 100 = 80%` fewer starts. With lazy connection, only `k` used backends connect out of 12 configured; unused backends do not start. This is a work-count calculation, not 80% faster elapsed startup. This startup-count illustration does not measure latency; concurrency, service authentication and platform affect wall time.

For a 1000-tool catalog: 1000 → 6 initial gateway definitions, (1000 - 6) / 1000 × 100 = 99.4% fewer definitions, not 99.4% fewer tokens. Selected schemas cost more when requested; clients already deferring definitions may gain less. The synthetic catalog test verifies six tools and a shared discovery cache across two clients, not RSS performance. [catalog-scale.test.js](test/catalog-scale.test.js)

**Measured lightweight fixture: summed process working set increased; cold first use was slower.** Three Windows x64 / Node 24.13.1 trials; medians:

| Comparison | Result |
|---|---|
| Shared schema + echo: cold backend / second / fifth client | 426.2 ms / 21.1 ms / 19.0 ms |
| First useful echo: direct / shared with gateway listening / fully cold shared | 503.5 ms / 894.3 ms / 1886.7 ms |
| Backend processes / total processes, direct → shared | 5 → 1 / 5 → 7 |
| Summed process working set, direct → shared | 357.0 MiB → 564.0 MiB — **summed process working set was higher; unique physical memory and private bytes were not measured** |

Fully cold shared startup was slower. This one-tool echo fixture is not representative of heavier field services. The 1.5 GB scenario above is a separate assumption, not this measurement. [Full method and comparators](docs/BENCHMARK.md)

Resource use depends on backends, clients, and workload. No measured RAM or token savings are promised; sharing neither enlarges the model's context window nor makes memory usage constant. Clients that already defer tool loading may see less context benefit.

## How it works

MCPGateway shares configured backends across sessions: clients use a connector and the same catalog; selected servers connect on demand. It is a local shared MCP gateway, not an enterprise API-governance service.

```text
Agent A ─┐                         ┌─ Integration A: many tools
Agent B ─┼─ connector ─ gateway ──┼─ Integration B: many tools
Agent C ─┘                         └─ Integration C: many tools
```

The diagram illustrates shared routing to selected configured backends, not a benchmark or runtime proof; unused backends are not started.

The six gateway tools comprise four discovery/execution tools—`list_servers`, `search_tools`, `get_tool_schema`, and `call_tool`—plus `claim_server` and `release_server` for integrations that require exclusive workflow ownership.

A request follows **discover → retrieve schema → call**. Discovery does not start every integration. If shared state requires exclusive ownership, the agent claims that integration before its calls and releases it after the workflow.

Change backend configuration without restarting your agent on the current connector route: synchronize additions, settle active workflows, then restart only the owned gateway; current connectors reconnect. This is not automatic hot reload: the running gateway loads its catalog at startup. For later Copilot MCP additions, rerun `/mcp-gateway-setup`, review preview and approve only intended synchronization; preserve backups. Ask the setup skill to perform the owned restart in [configuration synchronization](docs/CLIENTS.md#copilot-cli-upgrade).

The same live connector PID, SDK client and stdio transport survived a settled owned-gateway restart with one initialization, discovered a newly added alias and called its public echo fixture. This verifies agent-side MCP connection continuity, not independently tested branded-agent conversation UIs. Configuration-only sync need not replace the fixed six-tool agent connector; the existing connector can reconnect, but interrupted calls are not silently replayed and unknown outcomes require review. Gateway restart loses leases: reclaim exclusive ownership before new execution. This is not a universal “no agent restart” guarantee: initial registration and runtime/connector upgrades retain their client-specific restart/reload instructions. Changed existing aliases can conflict and require review, not automatic replacement. [Method and scope](docs/BENCHMARK.md#configuration-only-connection-continuity).

## Install and upgrade by client

**One shared MCP catalog across your agents.** Start with **10 connections** in Copilot, then explicitly migrate a supported Claude configuration with **2 new connections**: both agents can use the same **12**. Same-name identical entries deduplicate; conflicts stop for review. [Preview and back up the migration](docs/CLIENTS.md#cross-client-migration); unsupported native settings are rejected.

The shared runtime is bootstrapped through Copilot CLI today. Other clients can register the same connector or explicitly migrate supported entries into its catalog. Registering the connector is separate from merging catalogs; plugin installation alone does not merge their configurations. Configuration-format and SDK tests do not mean every native client has been exercised end to end.

**Prerequisites:** Node.js 24 or newer, npm, Git, Copilot CLI with plugin support for the current bootstrap, and integrations already configured with their required authentication. Windows is the primary tested platform. Agency is optional.

| Client | Installation | Upgrade | Required bootstrap | Verification tier |
|---|---|---|---|---|
| GitHub Copilot CLI | [Install](docs/CLIENTS.md#copilot-cli-install) | [Upgrade](docs/CLIENTS.md#copilot-cli-upgrade) | [Copilot CLI](docs/CLIENTS.md#shared-gateway-prerequisite) | [Marketplace/setup route; isolated config parsing](docs/CLIENTS.md#compatibility-summary) |
| VS Code (editor) | [Install](docs/CLIENTS.md#vs-code-install) | [Upgrade](docs/CLIENTS.md#vs-code-upgrade) | [Copilot CLI](docs/CLIENTS.md#shared-gateway-prerequisite) | [Registration/format adapter tested; no native end-to-end session](docs/CLIENTS.md#compatibility-summary) |
| Claude Code | [Install](docs/CLIENTS.md#claude-code-install) | [Upgrade](docs/CLIENTS.md#claude-code-upgrade) | [Copilot CLI](docs/CLIENTS.md#shared-gateway-prerequisite) | [Isolated config parsed; no model/backend](docs/CLIENTS.md#compatibility-summary) |
| Codex CLI | [Install](docs/CLIENTS.md#codex-install) | [Upgrade](docs/CLIENTS.md#codex-upgrade) | [Copilot CLI](docs/CLIENTS.md#shared-gateway-prerequisite) | [Native validation blocked by policy](docs/CLIENTS.md#compatibility-summary) |
| OpenCode | [Install](docs/CLIENTS.md#opencode-install) | [Upgrade](docs/CLIENTS.md#opencode-upgrade) | [Copilot CLI](docs/CLIENTS.md#shared-gateway-prerequisite) | [Registration/format adapter tested; no native end-to-end session](docs/CLIENTS.md#compatibility-summary) |
| Qwen Code | [Install](docs/CLIENTS.md#qwen-code-install) | [Upgrade](docs/CLIENTS.md#qwen-code-upgrade) | [Copilot CLI](docs/CLIENTS.md#shared-gateway-prerequisite) | [Registration/format adapter tested; no native end-to-end session](docs/CLIENTS.md#compatibility-summary) |
| Kimi CLI | [Install](docs/CLIENTS.md#kimi-cli-install) | [Upgrade](docs/CLIENTS.md#kimi-cli-upgrade) | [Copilot CLI](docs/CLIENTS.md#shared-gateway-prerequisite) | [Registration/format adapter tested; no native end-to-end session](docs/CLIENTS.md#compatibility-summary) |
| Antigravity CLI | [Install](docs/CLIENTS.md#antigravity-cli-install) | [Upgrade](docs/CLIENTS.md#antigravity-cli-upgrade) | [Copilot CLI](docs/CLIENTS.md#shared-gateway-prerequisite) | [Registration/format adapter tested; no native end-to-end session](docs/CLIENTS.md#compatibility-summary) |

The [client guide](docs/CLIENTS.md) is the canonical installation and upgrade source. It documents native configuration locations, preview/apply behavior, support status, restart/readiness steps, and conflict handling.

Searching for this repository from Claude Code, Codex, Gemini CLI, Kimi, or Qwen CLI is different from connecting those clients to the gateway. Public documentation is available to any tool-enabled reader; native integration is not guaranteed. Gemini CLI has no documented setup route here (Antigravity is a separate client), and Kimi is adapter-tested only. See the [client guide](docs/CLIENTS.md) before choosing a runtime integration.

## Safety and operations

Setup is preview-first. Approved changes create private backups and return exact readiness and rollback commands. Configuration adapters preserve unrelated client settings and refuse conflicting gateway aliases instead of silently replacing them.

**Keep configuration and backups private:** they may contain credentials. Do not publish them, paste them into public issues, or commit them to version control. See [state and privacy](docs/REFERENCE.md#state-and-privacy).

Setup and client-migration previews also warn when a stdio/local backend is launched through `npx`/`npx.cmd` or `npm`/`npm.cmd` `exec`/`x` with an unpinned registry package spec, so you can replace mutable tags/ranges with exact versions before sharing that backend broadly.

The runtime is installed outside the plugin cache, so removing or updating plugin files does not silently replace the running gateway. Exclusive integrations can be claimed for a complete multi-call workflow, and an unknown timeout outcome remains blocked rather than being handed to another agent.

**Stop using the gateway:** first finish active workflows and let outstanding calls settle; follow [workflow ownership](docs/REFERENCE.md#workflow-ownership) for unknown outcomes rather than treating disconnect as cancellation. To return affected clients to their prior configuration, close them and follow the exact private-backup `rollbackCommand` from [setup recovery](docs/REFERENCE.md#setup-recovery); review [cross-client migration recovery](docs/REFERENCE.md#cross-client-migration-recovery) separately if other client configurations were migrated. Reopen clients only after restoration. Configuration rollback is not runtime shutdown: the owned persistent gateway, private catalog, backups, and authentication state can remain. Plugin removal does not remove the stable runtime. Full runtime shutdown/decommission has no documented general-purpose command here; use the [operator shutdown handoff and completion checks](docs/REFERENCE.md#planned-exit) for a concrete request and verified end state. Do not delete credentials, private state, conversation history or unrelated backends as part of this exit route, or stop unrelated processes.

See the [operational reference](docs/REFERENCE.md) for workflow ownership, privacy, recovery, and configuration transfer. For Windows plugin updates reporting `Access denied`, use the [tested cache-only recovery](docs/REFERENCE.md#windows-plugin-cache-access-denied).

## Verified scope

- **1,000-tool synthetic catalog, 2 clients:** a focused search returns one matching summary, and the second client reuses the cached catalog. [Test](test/catalog-scale.test.js)
- **237 local checks passed for v0.6.0**, [historically reported by the maintainer in the versioned release notes](https://github.com/yeelam-gordon/MCPGateway/releases/tag/v0.6.0): core sharing, recurring synchronization, cross-client migration, client/documentation behavior, installation, upgrade, rollback, cancellation, and recovery. This historical execution claim has not been independently reproduced here; it is not a result for the current checkout.
- **10 existing connections + 2 new = 12 shared:** migration across seven native formats, with two SDK clients reusing the same imported local process. Claude Code also parsed the actual migrated configuration without starting a model or MCP connection.
- **Windows and Ubuntu CI on Node.js 24**, plus CodeQL analysis.
- **Copilot marketplace installation and setup-skill discovery** verified in an isolated home for v0.5.0.

These checks demonstrate the mechanism, not unlimited capacity. Authentication, network latency, active workloads, and client initialization still affect startup time and resource use.

## Development

```powershell
git clone https://github.com/yeelam-gordon/MCPGateway
cd .\MCPGateway
npm ci
npm test
npm run setup
npm run test:sync
npm run test:clients
npm run test:lifecycle
```

`npm run setup` previews only. Use `npm run setup -- --apply` only after reviewing the preview. The lifecycle suite exercises fresh installation, shared use, upgrade activation, and rollback with isolated fixtures rather than personal credentials or production services.

## More documentation

- [Agent-guided migration workflow](MIGRATION_PROMPT.md)
- [Focused alternatives](docs/ALTERNATIVES.md)
- [Contributing and release checks](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Security reporting](SECURITY.md)

## License

MIT - see [LICENSE](LICENSE). Third-party dependencies retain their respective licenses.
