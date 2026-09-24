# Shared MCP Gateway

**Languages:** English · [简体中文](docs/i18n/README.zh-CN.md) · [繁體中文](docs/i18n/README.zh-TW.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md) · [Español](docs/i18n/README.es.md) · [Français](docs/i18n/README.fr.md) · [Deutsch](docs/i18n/README.de.md) · [Português](docs/i18n/README.pt-BR.md) · [Italiano](docs/i18n/README.it.md) · [Русский](docs/i18n/README.ru.md) · [العربية](docs/i18n/README.ar.md) · [हिन्दी](docs/i18n/README.hi.md) · [Bahasa Indonesia](docs/i18n/README.id.md) · [Türkçe](docs/i18n/README.tr.md) · [Tiếng Việt](docs/i18n/README.vi.md)

<a id="benefits"></a>
## Save RAM. Keep context for your work. Tools on demand.

**More agents should mean more work done—not more copies of the same MCP setup.**

### 5 agents. 12 MCP connections. One shared setup.

*Illustrative example: those **12 connections** expose **1,000 tools** and use **1.5 GB** of local process memory per independent setup.*

| Benefit | Separate setup per agent | With MCPGateway |
|---|---|---|
| **Save RAM** | **7.5 GB** across five independent MCP setups. | **1.5 GB shared**, plus gateway/connector overhead. **6 GB of duplicated memory avoided.** |
| **Keep context for your work. Tools on demand.** | **1,000 tool definitions** loaded upfront per agent, potentially growing as you add MCP connections. | **6 gateway tools upfront—99.4% fewer definitions.** Keep all **1,000 tools** available; each agent discovers and loads only what it needs. Add more MCP connections without loading their entire catalogs into every agent. |

**Keep your agents. Keep your MCP connections. Stop making every session carry its own copy.**

*RAM figures are illustrative, not measured savings; agent memory is additional. Definition counts are not token savings, and clients that already defer tool loading may see a smaller context benefit. Sharing does not enlarge the model's context window or make total RAM usage constant.*

## Contents

- [How it works](#how-it-works)
- [Install and upgrade by client](#install-and-upgrade-by-client)
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

The shared runtime is bootstrapped through Copilot CLI today. Other clients register the resulting stable connector through tested configuration adapters; their existing direct MCP entries are not automatically imported or removed. This is not a claim that every native client has completed end-to-end runtime testing.

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

## Safety and operations

Setup is preview-first. Approved changes create private backups and return exact readiness and rollback commands. Configuration adapters preserve unrelated client settings and refuse conflicting gateway aliases instead of silently replacing them.

The runtime is installed outside the plugin cache, so removing or updating plugin files does not silently replace the running gateway. Exclusive integrations can be claimed for a complete multi-call workflow, and an unknown timeout outcome remains blocked rather than being handed to another agent.

See the [operational reference](docs/REFERENCE.md) for workflow ownership, privacy, recovery, and configuration transfer. For Windows plugin updates reporting `Access denied`, use the [tested cache-only recovery](docs/REFERENCE.md#windows-plugin-cache-access-denied).

## Verified scope

- **1,000-tool synthetic catalog, 2 clients:** a focused search returns one matching summary, and the second client reuses the cached catalog. [Test](test/catalog-scale.test.js)
- **188 local checks passed for v0.5.0:** core sharing, recurring synchronization, client/documentation behavior, installation, upgrade, rollback, cancellation, and recovery.
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
