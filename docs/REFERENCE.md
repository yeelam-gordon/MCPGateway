# Operational reference

This document contains detailed operating, recovery, ownership, and transfer guidance. Installation and upgrade instructions live only in [Client integration](CLIENTS.md).

## Contents

- [Tool discovery and capacity](#tool-discovery-and-capacity)
- [Workflow ownership](#workflow-ownership)
- [State and privacy](#state-and-privacy)
- [Setup recovery](#setup-recovery)
- [Windows plugin cache: Access denied](#windows-plugin-cache-access-denied)
- [Adopting a development checkout](#adopting-a-development-checkout)
- [Configuration transfer](#configuration-transfer)
- [Operational invariants](#operational-invariants)

<a id="tool-discovery-and-capacity"></a>
## Tool discovery and capacity

The gateway exposes four discovery/execution tools and two ownership tools:

| Tool | Purpose |
|---|---|
| `list_servers` | List configured backend aliases and state without starting every backend. |
| `search_tools` | Search one named backend for matching tool names and descriptions. |
| `get_tool_schema` | Retrieve the full input schema for one selected tool. |
| `call_tool` | Invoke a selected tool while enforcing its configured allowlist and validating arguments. |
| `claim_server` | Reserve an exclusive backend for one client's complete workflow. |
| `release_server` | Release that backend after outstanding calls settle. |

Six is a design choice, not an MCP requirement. Separating discovery, schema lookup, and execution avoids returning large schemas when only a summary is needed.

With a 1,000-tool catalog, the gateway still advertises six initial tool definitions. It can search one backend, return a few summaries, fetch one schema, and invoke that tool without registering every discovered tool as a new native client tool.

The gateway may retrieve a backend's complete catalog internally and cache it in memory. Use focused searches: an empty or broad query can still return many summaries. The fixed tool count does not imply unlimited capacity or constant memory/token usage.

Concurrent first-use requests share one catalog fetch. Catalog discovery has one total deadline rather than a fresh full budget for every page. Cancelling one discovery request does not cancel another client's shared discovery.

<a id="workflow-ownership"></a>
## Workflow ownership

Set `requiresExclusiveAccess` on a backend that needs one client to own shared state across several tool calls:

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

This is a gateway configuration setting, not a standard MCP input-schema field. Statefulness alone does not imply exclusive ownership; a backend with isolated client sessions may not need it.

`list_servers`, `search_tools`, and `get_tool_schema` expose the resolved requirement. Discovery and schema lookup do not require a claim. For an exclusive backend, claim once for the complete workflow:

```text
claim_server({ "server": "browser" })
call_tool({ "server": "browser", "tool": "navigate", "arguments": { ... } })
call_tool({ "server": "browser", "tool": "screenshot", "arguments": { ... } })
release_server({ "server": "browser" })
```

The claim covers all calls to that backend, not one tool. Other exclusive backends have independent ownership. Backends without the requirement are called normally.

For compatibility, an existing backend named exactly `playwright` remains exclusive when the setting is omitted. Explicit `true` or `false` overrides that default; other aliases default to `false`. Migrations and transfers preserve the setting.

Release waits for outstanding calls to settle. Disconnect releases an idle claim. If a call times out with an unknown outcome, that exclusive backend remains blocked until the gateway restarts; disconnecting or reclaiming cannot permit another workflow to race the unfinished operation.

Inactive abandoned client sessions expire. Normal connectors send a lightweight heartbeat while connected. Expiration does not interrupt an active call or release a backend whose last operation has an unknown outcome.

Clients upgrading from 0.3 must replace `claim_playwright` and `release_playwright` with `claim_server` and `release_server`, each with a `server` argument. A running older runtime retains its old tools until explicitly upgraded.

<a id="state-and-privacy"></a>
## State and privacy

Default locations on Windows-style paths are:

| Location | Contents |
|---|---|
| `$HOME\.copilot\mcp-config.json` | The shared gateway connector. Setup respects `COPILOT_HOME` when set. |
| `$HOME\.shared-mcp-gateway\backends.json` | Original backend definitions; may contain credentials. |
| `$HOME\.shared-mcp-gateway\runtime\...` | Stable runtime, independent of the plugin cache. |
| `$HOME\.shared-mcp-gateway\backups\...` | Original configuration and rollback records. |

`$HOME` means the user home directory, not the current folder. Keep state, backend definitions, and backups private.

Setup preserves conversation history and existing approval settings. Agency integration is opt-in with `--agency-adapters`; ordinary Copilot use does not require it. Existing Agency plugins or defaults may still add their own configuration.

The plugin cache contains the setup skill and updateable package files. The stable runtime and private backend data live outside that cache. Uninstalling the plugin removes the setup skill, not the installed runtime.

<a id="setup-recovery"></a>
## Setup recovery

Use the exact `backupPath` and `rollbackCommand` printed by setup. Close affected clients before restoring their original configuration, then reopen them.

If setup fails after creating a backup, it prints recovery information. If it fails before creating one, it reports that the source configuration was not replaced. Do not delete the private backend catalog as a troubleshooting step.

After a successful setup or runtime adoption, execute the returned `readinessCommand` exactly. Restart clients only after the readiness check succeeds. If setup reports `already-configured`, use the reported connector and state directory for the health check rather than inventing paths.

<a id="windows-plugin-cache-access-denied"></a>
## Windows plugin cache: Access denied

Copilot's updater can occasionally fail to replace its installed-plugin cache. This does not by itself mean the stable gateway runtime is broken. Do not remove backend configuration, change broad file permissions, or stop unrelated Node processes.

First close Copilot windows normally and retry from a separate terminal. If replacement still fails, this cache-only recovery was verified on Windows: move the named plugin directory intact to a backup, then use Copilot's standard install command to create a fresh copy. Run outside the plugin directory.

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

This targets only the named plugin cache, not the stable runtime or credentials. If the move is denied, stop and inspect the locking process or policy; do not force access. If installation fails, retain the backup and restore it to `$cache` only after confirming the destination is absent.

<a id="adopting-a-development-checkout"></a>
## Adopting a development checkout

When moving from a development checkout, use the setup skill's explicit adoption workflow. `--adopt-existing` previews and backs up the connector change while retaining backend data. It does not delete the checkout or edit shell profiles.

Ask the setup skill to locate the installed plugin root rather than guessing cache paths. Plugin updates can change the cached package location, while the adopted stable runtime remains separate.

<a id="configuration-transfer"></a>
## Configuration transfer

To reuse backend definitions on another machine, use `tools\transfer-config.mjs`. This transfers definitions, not the gateway connector, runtime state, or tokens.

```powershell
# On the source machine: export backend definitions, not the connector.
node "<plugin-root>\tools\transfer-config.mjs" export `
  --source "$HOME\.shared-mcp-gateway\backends.json" --output ".\gateway-transfer"

# On the destination: fill a private values.json using requirements.json.
node "<plugin-root>\tools\transfer-config.mjs" import `
  --input ".\gateway-transfer" --values ".\values.json" --output ".\backends.ready.json"
```

`<plugin-root>` is the installed plugin directory reported by the setup skill. The export replaces credentials, endpoint URLs, local paths, and unclassified argument values with placeholders. A URL can contain a secret even when no query parameter is named `token`; supply endpoint URLs locally on the destination.

Review the transfer package before sharing because aliases and organization names may still be private. Back up and merge the materialized definitions into the destination configuration before setup. For an already-migrated destination, merge into its private backend catalog.

Never copy gateway tokens, process manifests, locks, browser profiles, or OAuth caches between machines.

<a id="operational-invariants"></a>
## Operational invariants

- Preview before apply; preserve the exact backup and rollback output.
- Plugin download, stable runtime activation, and client connector registration are separate operations.
- Finish active work before switching a runtime or restoring configuration.
- Preserve unknown client fields and unrelated entries; refuse conflicts instead of guessing.
- Do not expose private environment values in generated command lines.
- Do not treat configuration-adapter tests as proof of a live third-party client session.
