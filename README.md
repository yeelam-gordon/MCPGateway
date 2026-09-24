# Shared MCP Gateway

**Languages:** English · [简体中文](docs/i18n/README.zh-CN.md) · [繁體中文](docs/i18n/README.zh-TW.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md) · [Español](docs/i18n/README.es.md) · [Français](docs/i18n/README.fr.md) · [Deutsch](docs/i18n/README.de.md) · [Português](docs/i18n/README.pt-BR.md) · [Italiano](docs/i18n/README.it.md) · [Русский](docs/i18n/README.ru.md) · [العربية](docs/i18n/README.ar.md) · [हिन्दी](docs/i18n/README.hi.md) · [Bahasa Indonesia](docs/i18n/README.id.md) · [Türkçe](docs/i18n/README.tr.md) · [Tiếng Việt](docs/i18n/README.vi.md)

## Less duplicated MCP overhead. Less context usage. Tools on demand.

**Share MCP connections across agents to reduce RAM use. Load tool schemas only when needed to reduce context overhead.**

Configure one gateway connection in each agent CLI. Sessions using the same configured MCP entries reuse their connections and local server processes instead of starting separate copies. Your agent searches for the capability it needs, retrieves the selected tool's schema, and calls it through the gateway; unused MCP servers stay unstarted.

| Benefit | Without shared routing | With MCPGateway |
|---|---|---|
| **Less duplicated RAM use** | Each agent session can start its own copies of local MCP servers | Sessions reuse local server processes through the shared gateway |
| **Less upfront context overhead** | Loading MCP tool schemas upfront leaves less context for the task | A small gateway interface exposes discovery; selected schemas are retrieved as needed |
| **Tools on demand** | Clients manage discovery and connections independently | Search for a capability, load its schema, and call it; unused MCP servers stay unstarted |
| **Shared connections** | Separate sessions maintain separate connections to the same MCP servers | Sessions using the same gateway reuse connections per configured MCP entry |

Shared MCP server processes do not multiply with the number of agent sessions. Each CLI still has its own memory, lightweight connector, and model context; active workloads, retrieved schemas, and results add overhead. Savings depend on your MCP setup and client behavior, not a larger model context window or constant total RAM use.

Works with ordinary **Copilot CLI**. **Agency is optional.**

**Keep your existing MCP workflow.** Use your agent client's normal mechanism to discover, install, and configure MCP servers. MCPGateway works **after configuration**: it shares those backend connections and exposes a small, on-demand tool interface. It is not another backend marketplace or a replacement for your client's installer.

For other clients, see [Client integration](docs/CLIENTS.md): a documented MCP connection path is separate from support for installing this Copilot plugin unchanged.

## Contents

- [Install and upgrade by client](#install-and-upgrade-by-client)
- [Benefits and verified scope](#benefits)
- [Copilot CLI quickstart](#how-to-install)
- [Add more MCP servers later](#added-another-mcp-later-run-setup-again)
- [Tool discovery](#why-only-six-tools) and [workflow ownership](#server-scoped-workflow-ownership)
- [Configuration changes](#what-changes-on-your-machine) and [troubleshooting](#if-setup-does-not-work)
- [Runtime upgrades and transfers](#existing-installations-and-other-machines)
- [Development](#development) and [license](#license)

## Install and upgrade by client

Choose your client for its prerequisites, configuration location, installation steps, and upgrade procedure. The gateway runtime is shared; registering another client does not install a second gateway or migrate that client's existing servers.

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

Copilot installation and runtime upgrade have end-to-end checks. The other entries document configuration adapters and their limits, not a claim that every native client has been exercised live.

## Benefits

- **A fixed-size tool interface:** adding more backend tools does not add more gateway tool definitions to Copilot.
- **On-demand schemas:** search tool summaries first, then fetch the full schema of the selected tool.
- **Less repeated startup:** multiple CLI sessions reuse one local gateway and its initialized backend connections.
- **More room for your actual work:** avoid multiplying local backend processes and their memory usage every time you open another CLI.
- **Warm backends:** closing one client does not shut down the shared backend fleet.
- **One private configuration:** preserve your server aliases, tool allowlists, credentials, and organization-specific arguments.
- **Backed-up setup:** preview changes before applying them and receive an exact manual restore command.

### Model context: less tool-schema overhead, more room for your task

**Tool definitions use tokens inside the model's context window.** Their names, descriptions, and parameter schemas can take space that would otherwise be available for code, instructions, conversation, and results.

For illustration, with a **1,000-tool backend catalog**, MCPGateway exposes **6 gateway tool definitions upfront** and retrieves individual backend schemas when needed. That is **99.4% fewer advertised definitions** compared with exposing all 1,000 directly—not a measured 99.4% token reduction, because schema sizes differ. You do not need a large catalog to use the gateway.

**The model's maximum context-window size does not change. The amount occupied by tool definitions can decrease.** Clients that already defer tool loading may see a smaller context benefit. Search summaries, selected schemas, and tool results still consume tokens as they are used.

### Machine memory: share backends instead of duplicating them

**Run several Copilot sessions without paying for the same local backend fleet each time.**

For illustration, if one local MCP backend fleet consumes **300 MB**, five independent copies consume **1,500 MB**. Sharing that fleet brings the duplicated backend portion back toward **300 MB**, plus gateway/connector overhead and any extra concurrent-work memory. That is **1,200 MB less duplicated baseline backend memory** in this example—not a measured saving or a cap on total application RAM.

**A Copilot process using 1.5 GB of RAM does not mean its context window is full.** RAM can contain conversation history, outputs, caches, and other runtime state. The gateway does not eliminate Copilot's own memory usage or enlarge the model's context limit.

The value is avoiding repeated backend overhead **and** keeping the initial tool interface small. Actual savings depend on your servers, concurrent workload, and the client's existing tool-discovery behavior.

### What has been verified?

- **1,000-tool synthetic catalog, 2 clients:** both see exactly **6 gateway tools**; a focused search returns **1 matching summary**, and a second client reuses the cached catalog instead of fetching it again. [Test](test/catalog-scale.test.js)
- **188 local checks** passed for v0.5.0 across the core, recurring-sync, client/documentation, and real installation/upgrade suites, covering sharing, ownership, cancellation, migration, recovery, and platform behavior.
- **2 CI platforms:** Windows and Ubuntu on Node.js 24, plus CodeQL analysis.

These checks demonstrate the mechanism, not unlimited capacity. Real startup time still includes authentication, network calls, and Copilot's own initialization.

## How to install

### 1. Check prerequisites

You need:

- Copilot CLI with plugin support.
- Node.js **24 or newer**, npm, and Git.
- An existing Copilot MCP configuration and any authentication its servers require.

Windows is the primary tested platform. You do **not** need Agency, a custom PowerShell profile, or a special Copilot agent.

### 2. Install the plugin

Run these commands in your **terminal**, not inside the Copilot chat:

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

### 3. Run setup inside Copilot

Start Copilot:

```powershell
copilot
```

Then enter this command **inside Copilot**:

```text
/mcp-gateway-setup
```

Review the preview and approve the migration. Setup will:

1. Install the gateway runtime in a stable, private local directory.
2. Back up your existing MCP configuration.
3. Preserve the backend definitions in a private catalog.
4. Replace the client configuration with the shared gateway connector.
5. Print the exact backup path, restore command, and health-check command.

Installing the plugin alone does not change your MCP routing; the setup step performs the migration.

### 4. Reopen Copilot and use it normally

Close and reopen Copilot, then ask:

```text
Use the shared MCP gateway to list my configured servers.
```

Then request a task using one of your servers. **No separate gateway terminal is required:** the first connector starts the gateway in the background, and later clients reuse it.

The gateway uses **your own configured servers**. It does not install a predefined collection of services or supply their credentials.

### Added another MCP later? Run setup again

You do not need a new plugin version to import newly added servers. If another tool adds MCP entries alongside `shared-mcp-gateway` in your normal Copilot MCP configuration, run `/mcp-gateway-setup` again.

Setup previews the additions, then an approved apply backs up both configurations, merges the new definitions into the private backend catalog, and leaves the normal client configuration pointing at the gateway. It does not reinstall the runtime just to sync settings.

- **New server name:** import it with its arguments, credentials, tool allowlist, and lifecycle setting preserved.
- **Identical existing definition:** deduplicate it.
- **Same name, different definition:** stop and report the conflict; never overwrite your existing backend silently.
- **No additions:** report that nothing changed.

Finish active gateway work and restart the owned gateway after a successful configuration sync. This synchronization reads the selected user MCP config; it does not automatically absorb repository- or plugin-supplied servers.

## Why only six tools?

There are **four discovery/execution tools**, plus **two server-ownership tools**:

| Tool | Purpose |
|---|---|
| `list_servers` | List configured backend aliases and their state without starting all backends. |
| `search_tools` | Search a named backend for matching tool names and descriptions. |
| `get_tool_schema` | Retrieve the full input schema for one selected tool. |
| `call_tool` | Invoke that backend tool while enforcing its configured allowlist and validating arguments. |
| `claim_server` | Reserve an exclusive backend server for one client's entire workflow. |
| `release_server` | Release that server after the workflow finishes and outstanding calls settle. |

**Six is a design choice, not an MCP requirement.** Separating discovery, schema lookup, and execution keeps each operation clear and avoids returning large schemas when only a summary is needed. The two ownership tools prevent different clients from interleaving calls in an exclusive server workflow. They are not specific to Playwright.

```text
Copilot A ─┐                              ┌─ Backend A: many tools
Copilot B ─┼─ 6 gateway tools ── gateway ─┼─ Backend B: many tools
Copilot C ─┘                              └─ Backend C: many tools
```

For example, with 1,000 backend tools, Copilot can search one server, receive a few matching summaries, fetch one schema, and call that tool. **The gateway still exposes six tools; the backend catalog can grow without enlarging that initial interface.** Copilot calls through `call_tool` rather than registering every discovered tool as a new native tool.

The gateway may retrieve a backend's complete catalog internally and cache it in memory. Use focused searches: an empty or broad query can still return many summaries. The fixed tool count does not mean unlimited capacity or constant memory/token usage for every request.

Concurrent first-use requests share one catalog fetch. Catalog discovery has one total deadline rather than a fresh full budget for every page. Cancelling one discovery request does not cancel another client's shared discovery.

## Server-scoped workflow ownership

Set `requiresExclusiveAccess` on a backend that needs one client to own its shared state across several tool calls:

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["browser-server.mjs"],
      "requiresExclusiveAccess": true
    }
  }
}
```

This is a **gateway configuration setting**, not a standard MCP input-schema field. Statefulness alone does not imply exclusive ownership: a backend with isolated client sessions may not need it.

`list_servers`, `search_tools`, and `get_tool_schema` expose the resolved requirement. Discovery and schema lookup do not require a claim. For a server marked exclusive, the client claims once and performs its workflow:

```text
claim_server({ "server": "browser" })
call_tool({ "server": "browser", "tool": "navigate", "arguments": { ... } })
call_tool({ "server": "browser", "tool": "screenshot", "arguments": { ... } })
release_server({ "server": "browser" })
```

The claim covers **all tool calls to that backend**, not an individual tool. Other exclusive servers have independent ownership. Servers without the requirement are called normally, without claim/release.

For compatibility, an existing backend named exactly `playwright` remains exclusive when the setting is omitted. Explicit `true` or `false` overrides that default; all other aliases default to `false`. Migrations and configuration transfers preserve the setting.

Release waits for outstanding calls to settle, and disconnect releases an idle claim. If a call times out with an unknown outcome, that exclusive server stays blocked until the gateway restarts; disconnecting or reclaiming must not permit another workflow to race the unfinished operation.

Inactive abandoned client sessions expire; normal connectors send a lightweight heartbeat while connected. Expiration does not interrupt an active tool call or release a server whose last operation has an unknown outcome.

**Upgrading from 0.3:** `claim_playwright` and `release_playwright` are replaced by `claim_server` and `release_server`, each requiring `server`. Update the plugin, explicitly adopt the new runtime through setup, and restart clients after active work finishes. A running older gateway keeps its old tools until upgraded; plugin download alone does not replace it.

## What changes on your machine?

The default locations are:

| Location | Contents |
|---|---|
| `$HOME\.copilot\mcp-config.json` | The gateway connector instead of individual backend entries. Setup respects `COPILOT_HOME` when set. |
| `$HOME\.shared-mcp-gateway\backends.json` | Your original backend definitions; may contain credentials. |
| `$HOME\.shared-mcp-gateway\runtime\...` | Installed runtime, independent of the plugin cache. |
| `$HOME\.shared-mcp-gateway\backups\...` | Original configuration and rollback records. |

`$HOME` means your user home directory, not your current folder. Keep gateway state and configuration backups private.

Setup preserves conversation history and existing approval settings. Agency integration is opt-in with `--agency-adapters`; normal Copilot users do not need it. Existing Agency plugins/defaults may still add their own MCPs.

## If setup does not work

Use the **exact backup path and `rollbackCommand` printed by setup**. Close Copilot before restoring its original configuration, then reopen it.

If setup fails after creating a backup, it prints recovery information. If it fails before creating one, it reports that the source configuration was not replaced. Do not delete your backend catalog as a troubleshooting step.

Uninstalling the plugin removes the setup skill, not the installed runtime, so existing clients are not left pointing at a deleted program.

## Existing installations and other machines

### Updating the plugin and the running gateway

These are two separate operations:

1. **Download the plugin update** in a terminal:

   ```powershell
   copilot plugin marketplace update mcp-gateway
   copilot plugin update shared-mcp-gateway@mcp-gateway
   ```

2. **Activate the runtime update** inside Copilot: run `/mcp-gateway-setup` and explicitly ask to adopt the updated runtime. Review the backup and restart steps before proceeding.

The runtime is installed outside the plugin cache, so downloading a plugin update does not replace files used by the running gateway. Activation is a separate, backed-up switch after active requests finish.

#### Windows plugin update reports “Access denied”

This can occur when Copilot's updater cannot replace its installed-plugin cache. It does not, by itself, mean the gateway is broken. Do not remove backend configuration, change file permissions, or stop unrelated Node processes.

First close Copilot windows normally and retry from a separate terminal. If replacement still fails, the following **cache-only recovery** was verified on Windows: move the old plugin directory intact to a backup, then use Copilot's standard install command to create a fresh copy. Run outside the plugin directory.

```powershell
$copilotHome = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $HOME '.copilot' }
$cache = Join-Path $copilotHome 'installed-plugins\mcp-gateway\shared-mcp-gateway'
$backup = Join-Path $copilotHome ('plugin-cache-backups\shared-mcp-gateway-' + [guid]::NewGuid().ToString())

# Inspect the exact target before proceeding.
Get-Item -LiteralPath $cache -ErrorAction Stop
New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force | Out-Null
Move-Item -LiteralPath $cache -Destination $backup -ErrorAction Stop
copilot plugin install shared-mcp-gateway@mcp-gateway
if ($LASTEXITCODE -ne 0) {
    throw "Plugin install failed. Old cache is preserved at $backup. Do not delete either copy."
}
copilot plugin list --json
"Previous plugin cache: $backup"
```

This targets only the named plugin's cache, not the stable runtime or credentials. If the move itself is denied, stop and inspect the locking process or policy; do not force access. If installation fails, retain the backup and restore it to `$cache` only after confirming the destination is absent. This is a recovery procedure, not an automatic replacement for the CLI's update mechanism.

**Moving from a development checkout?** Update the plugin, run `/mcp-gateway-setup`, and ask it to adopt your existing installation. The explicit `--adopt-existing` workflow previews and backs up the connector change while retaining your backend data. It does not delete the checkout or edit shell profiles.

**Setting up another machine?** Normally, install the plugin there and migrate that machine's own MCP configuration. To reuse a catalog, the plugin includes `tools\transfer-config.mjs`:

```powershell
# On the source machine: export backend definitions, not the connector.
node "<plugin-root>\tools\transfer-config.mjs" export `
  --source "$HOME\.shared-mcp-gateway\backends.json" --output ".\gateway-transfer"

# On the destination: fill a private values.json using requirements.json.
node "<plugin-root>\tools\transfer-config.mjs" import `
  --input ".\gateway-transfer" --values ".\values.json" --output ".\backends.ready.json"
```

`<plugin-root>` is the installed plugin directory reported by Copilot; ask the setup skill to locate it rather than guessing. The export replaces credentials, all endpoint URLs, local paths, and unclassified argument values with placeholders. A URL can itself contain a secret even when no query parameter is named "token". Supply endpoint URLs locally on the destination. Review the package before sharing because aliases and organization names may still be private.

Back up and merge the materialized definitions into the destination's configuration before running setup. For an already-migrated destination, merge into its private backend catalog instead. Never copy gateway tokens, process manifests, locks, browser profiles, or OAuth caches between machines.

## Development

```powershell
git clone https://github.com/yeelam-gordon/MCPGateway
cd .\MCPGateway
npm ci
npm test
npm run setup
npm run test:lifecycle
```

`npm run setup` previews only. To apply after reviewing it, use `npm run setup -- --apply`. See [MIGRATION_PROMPT.md](MIGRATION_PROMPT.md) for an agent-guided workflow.

### Two installation release gates

CI runs the unit/integration suite and an additional isolated lifecycle test on Windows and Ubuntu:

| Gate | Required outcome |
|---|---|
| **Fresh setup** | Preview changes nothing; installation creates an exact backup; the generated connector starts the gateway; two clients can use it and share a backend. |
| **Upgrade and rollback** | Install a candidate alongside the existing runtime; preserve backend data and credentials; keep the old runtime available until activation; verify calls after the switch and after restoring the prior configuration. |

The lifecycle test installs real locked npm dependencies and uses local fixture backends—not personal credentials or production services. It exercises the upgrade mechanism with two isolated runtime snapshots, not every historical release or third-party service.

Plugin download is a separate Copilot-managed step. The Windows cache-replacement recovery procedure above remains relevant if that updater returns “Access denied”; successful runtime tests do not hide an external installer failure.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release checks, [CHANGELOG.md](CHANGELOG.md) for API changes, and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

For a source-based comparison of other gateways, see [Focused alternatives](docs/ALTERNATIVES.md). It distinguishes one MCP entry per CLI, actual cross-client backend sharing, and compact tool discovery instead of treating all MCP servers as equivalent.

## License

MIT - see [LICENSE](LICENSE). Third-party dependencies retain their respective licenses.
