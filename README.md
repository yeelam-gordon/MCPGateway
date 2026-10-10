# MCPGateway — Share local MCP servers across coding-agent sessions

**Languages:** English · [简体中文](docs/i18n/README.zh-CN.md) · [繁體中文](docs/i18n/README.zh-TW.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md) · [Español](docs/i18n/README.es.md) · [Français](docs/i18n/README.fr.md) · [Deutsch](docs/i18n/README.de.md) · [Português](docs/i18n/README.pt-BR.md) · [Italiano](docs/i18n/README.it.md) · [Русский](docs/i18n/README.ru.md) · [العربية](docs/i18n/README.ar.md) · [हिन्दी](docs/i18n/README.hi.md) · [Bahasa Indonesia](docs/i18n/README.id.md) · [Türkçe](docs/i18n/README.tr.md) · [Tiếng Việt](docs/i18n/README.vi.md)

<a id="benefits"></a>
## Reuse backends. Discover tools on demand.

When multiple Copilot CLI or other coding-agent sessions start separate copies of the same local MCP servers, each repeats backend startup and carries its own tool catalog. **MCPGateway shares configured backends across sessions**, with on-demand tool discovery and ownership coordination for exclusive workflows. It is a local shared MCP gateway, not an enterprise API-governance service.

**Before you start:** Node.js 24+, npm, Git, Copilot CLI with plugin support, and existing MCP integrations with their required authentication. The current bootstrap starts through Copilot CLI; Windows is the primary tested platform. Agency is optional. Other clients register the installed connector, with differing [compatibility and verification levels](docs/CLIENTS.md#compatibility-summary); plugin installation alone does not merge their configurations.

Searching for this repository from Claude Code, Codex, Gemini CLI, Kimi, or Qwen CLI is different from connecting those clients to the gateway. Public documentation is available to any tool-enabled reader; native integration is not guaranteed. Gemini CLI has no documented setup route here (Antigravity is a separate client), and Kimi is adapter-tested only. See the [client guide](docs/CLIENTS.md) before choosing a runtime integration.

- Reuse a local backend instead of starting an independent copy for every session using the same connector and configuration.
- Start with six gateway tools; search the configured catalog and fetch only the selected tool's schema.
- Claim an exclusive backend for a multi-call workflow, then release it when calls settle.

Resource use depends on backends, clients, and workload. No measured RAM or token savings are promised; sharing neither enlarges the model's context window nor makes memory usage constant. Clients that already defer tool loading may see less context benefit.

## Contents

- [How it works](#how-it-works)
- [Install and upgrade by client](#install-and-upgrade-by-client)
- [First useful workflow](#first-use)
- [Safety and operations](#safety-and-operations)
- [Verified scope](#verified-scope)
- [Development](#development)
- [More documentation](#more-documentation)
- [License](#license)

## How it works

```text
Agent A ─┐                         ┌─ Integration A: many tools
Agent B ─┼─ connector ─ gateway ──┼─ Integration B: many tools
Agent C ─┘                         └─ Integration C: many tools
```

The gateway exposes four discovery/execution tools—`list_servers`, `search_tools`, `get_tool_schema`, and `call_tool`—plus `claim_server` and `release_server` for integrations that require exclusive workflow ownership.

A request follows **discover → retrieve schema → call**. Discovery does not start every integration. If shared state requires exclusive ownership, the agent claims that integration before its calls and releases it after the workflow.

## Install and upgrade by client

**One shared MCP catalog across your agents.** Start with **10 connections** in Copilot, then explicitly migrate a supported Claude configuration with **2 new connections**: both agents can use the same **12**. Same-name identical entries deduplicate; conflicts stop for review. [Preview and back up the migration](docs/CLIENTS.md#cross-client-migration); unsupported native settings are rejected.

The shared runtime is bootstrapped through Copilot CLI today. Other clients can register the same connector or explicitly migrate supported entries into its catalog. Installing a plugin alone does not merge configurations. Configuration-format and SDK tests do not mean every native client has been exercised end to end.

**Prerequisites:** Node.js 24 or newer, npm, Git, Copilot CLI with plugin support for the current bootstrap, and integrations already configured with their required authentication. Windows is the primary tested platform. Agency is optional.

| Client | Installation | Upgrade |
|---|---|---|
| GitHub Copilot CLI | [Install](docs/CLIENTS.md#copilot-cli-install) | [Upgrade](docs/CLIENTS.md#copilot-cli-upgrade) |
| VS Code (editor) | [Install](docs/CLIENTS.md#vs-code-install) | [Upgrade](docs/CLIENTS.md#vs-code-upgrade) |
| Claude Code | [Install](docs/CLIENTS.md#claude-code-install) | [Upgrade](docs/CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [Install](docs/CLIENTS.md#codex-install) | [Upgrade](docs/CLIENTS.md#codex-upgrade) |
| OpenCode | [Install](docs/CLIENTS.md#opencode-install) | [Upgrade](docs/CLIENTS.md#opencode-upgrade) |
| Qwen Code | [Install](docs/CLIENTS.md#qwen-code-install) | [Upgrade](docs/CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [Install](docs/CLIENTS.md#kimi-cli-install) | [Upgrade](docs/CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [Install](docs/CLIENTS.md#antigravity-cli-install) | [Upgrade](docs/CLIENTS.md#antigravity-cli-upgrade) |

The [client guide](docs/CLIENTS.md) is the canonical installation and upgrade source. It documents native configuration locations, preview/apply behavior, support status, restart/readiness steps, and conflict handling.

<a id="first-use"></a>
## First useful workflow: find and call an existing backend tool

1. Follow [Install the shared core](docs/CLIENTS.md#shared-core-install):

   ```powershell
   copilot plugin marketplace add yeelam-gordon/MCPGateway
   copilot plugin install shared-mcp-gateway@mcp-gateway
   ```

   Start Copilot CLI, invoke `/mcp-gateway-setup`, review the preview, and approve only intended changes. Close and reopen Copilot, then run the exact returned `readinessCommand`. A check-only command does not start an absent gateway. Keep the returned backup and rollback commands.
2. Choose a harmless, authorized read-only task on an integration you already use: for example, look up a record you are allowed to read. In that client, use the gateway tool calls below. These are **tool inputs, not shell commands**. Angle-bracket values are **placeholders**, not shipped aliases, tool names, credentials, or literal arguments. Replace them with values from your own catalog and selected schema; do not submit the templates unchanged.

   | Step | Gateway tool and input | Expected observable result |
   |---|---|---|
   | List configured integrations | `list_servers` with `{}` | `servers` lists redacted entries with `name`, `state`, and `requiresExclusiveAccess`; listing does not connect to every backend. Choose an existing `name` as `<backend-alias>`. |
   | Find a read-only capability | `search_tools` with `{"server":"<backend-alias>","query":"<term-from-your-task>"}` | `tools` contains matching names/descriptions and the ownership flag, not full input schemas. Choose a returned `name` as `<returned-tool-name>` after checking what it does. |
   | Inspect that tool | `get_tool_schema` with `{"server":"<backend-alias>","tool":"<returned-tool-name>"}` | The returned `tool.inputSchema` gives required fields, types, and constraints. Fill an arguments object from that schema using only authorized, non-sensitive test values. |
   | Perform the approved read | `call_tool` with `{"server":"<backend-alias>","tool":"<returned-tool-name>","arguments":{}}` **only if the schema permits an empty object**; otherwise replace `{}` with the complete schema-valid object you just prepared | The backend's result is preserved. Check its actual content for the expected record or documented empty result and any error indication; a gateway response alone is not proof the read succeeded. |

3. If discovery says `requiresExclusiveAccess: true`, use `claim_server` with `{"server":"<backend-alias>"}` once **before search/schema/call**, and `release_server` with the same input after all calls settle. Non-exclusive backends need no claim. If an exclusive call times out with an unknown outcome, do not retry: review active work and coordinate a gateway restart; releasing is not a safe unblock.
4. In a second session registered to the **same connector and catalog**, repeat list/search for the same alias. It should expose the same configured backend, reusing its initialized catalog rather than requiring a second backend configuration. This checks the first shared workflow, not measured memory savings. Discovery is not permission to execute a tool.

If the list is empty, check the selected configuration/migration preview. If search returns no matches, use a narrower term from your backend's own tool descriptions; there is no universal backend tool name. For authentication errors or failed readiness, follow the [operational reference](docs/REFERENCE.md) and [setup recovery/rollback](docs/REFERENCE.md#setup-recovery), not repeated calls or a parallel bypass process. Backend requests can still contact remote services; local sharing does not make them offline.

## Safety and operations

Setup is preview-first. Approved changes create private backups and return exact readiness and rollback commands. Configuration adapters preserve unrelated client settings and refuse conflicting gateway aliases instead of silently replacing them.

**Keep configuration and backups private:** they may contain credentials. Do not publish them, paste them into public issues, or commit them to version control. See [state and privacy](docs/REFERENCE.md#state-and-privacy).

Setup and client-migration previews also warn when a stdio/local backend is launched through `npx`/`npx.cmd` or `npm`/`npm.cmd` `exec`/`x` with an unpinned registry package spec, so you can replace mutable tags/ranges with exact versions before sharing that backend broadly.

The runtime is installed outside the plugin cache, so removing or updating plugin files does not silently replace the running gateway. Exclusive integrations can be claimed for a complete multi-call workflow, and an unknown timeout outcome remains blocked rather than being handed to another agent.

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
