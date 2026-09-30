# Operational reference

This document contains detailed operating, recovery, ownership, and transfer guidance. Installation and upgrade instructions live only in [Client integration](CLIENTS.md).

## Contents

- [Tool discovery and capacity](#tool-discovery-and-capacity)
- [Concurrent terminal resume](#concurrent-terminal-resume)
- [Workflow ownership](#workflow-ownership)
- [State and privacy](#state-and-privacy)
- [Native HTTP OAuth](#native-http-oauth)
- [Setup recovery](#setup-recovery)
- [Cross-client migration recovery](#cross-client-migration-recovery)
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

## Concurrent terminal resume

Several agent sessions may start their connectors at the same time. They coordinate through the same gateway state directory and port: one starts the gateway, and the others verify and reuse it.

Startup has a **60-second** total coordination budget. Authenticated handshake attempts are capped at **5 seconds** within that budget, and startup permission checks allow up to **15 seconds** per shell invocation, clipped to the coordinator's remaining time. These are maximum waits, not fixed delays. Normal short lock waits do not launch process-inspection shells; prolonged waits use staggered birth-time checks to detect reused process IDs. The lock holder records its process identity, and clients still verify the gateway identity, configuration, and process before reuse.

The preliminary owner record is fully written before exclusive lock publication, so interrupted preparation cannot publish partial JSON. If a previous owner exited while recording its identity, another client can recover that valid preliminary record. Complete provenance is published atomically, keeping the preliminary record intact until replacement succeeds. Transient Windows file-sharing errors during acquisition/publication are retried within bounded deadlines without changing permissions. Stale instance metadata is rechecked after acquiring the startup lock, allowing the new owner to finish publishing it. An active owner's lock is never taken over; unrelated listeners and mismatched configurations still fail explicitly.

These guarantees require all sessions to use the same current connector runtime and configuration. After upgrading, restart sessions that still hold an older connector. If a startup deadline is exceeded, inspect the connector error in the agent's log; do not delete live locks or start an independent gateway on the same port.

## Native HTTP OAuth

HTTP backends use the official MCP SDK's OAuth discovery, PKCE authorization-code flow and refresh support. Agency is not required; existing Agency adapters remain opt-in. Backend names are arbitrary aliases, not authentication-provider selectors. An explicit `Authorization` header takes precedence and disables native OAuth for that backend. Stdio authentication is unchanged.

Ordinary gateway calls never open a browser. When they return `auth_required`, explicitly sign in using the same backend configuration and state directory as the gateway:

```powershell
node tools\authenticate-backend.mjs --server "my-mail-alias" --config C:\gateway\backends.json --state-dir C:\gateway\state
```

Sign-in defaults to a 180-second total deadline. `--timeout SECONDS` can shorten it; `--no-browser` prints the authorization URL for local manual opening. Treat that URL as sensitive. Cancellation, denial, invalid state and timeout close the callback listener without saving newly issued tokens. Successful sign-in verifies MCP initialization and tool discovery before publishing tokens.

Discovery follows RFC 9728 and RFC 8414/OIDC through the SDK. The MCP server's protected-resource metadata advertises its authorization server; that server's OAuth/OIDC metadata supplies the issuer and authorization/token endpoints, including tenant-specific endpoints where advertised. Discovery does not supply an arbitrary application's Entra client ID or choose a tenant on the operator's behalf.

Client identity comes from standards-based dynamic client registration (DCR), when the authorization server supports it, or from the exact public application registration supplied by the operator in `oauth.clientId`. Without DCR, a supported client-ID metadata document, or explicit registration, authentication fails with an actionable registration error; it does not guess credentials. No Copilot client IDs, tenant IDs, or broad scope sets are hardcoded or reused.

Agency is separate from this native OAuth path. Its existing builtin mail adapter is service-specific, not a universal Entra authenticator, and is not assumed to know arbitrary tenant IDs or client IDs. For a pre-registered public client (including Entra deployments without dynamic registration), configure:

```json
{
  "mcpServers": {
    "my-mail-alias": {
      "url": "https://mcp.example.com/mcp",
      "oauth": {
        "clientId": "YOUR-REGISTERED-PUBLIC-CLIENT-ID",
        "scopes": ["offline_access", "YOUR-API-SCOPE"],
        "redirectPort": 7340
      }
    }
  }
}
```

Register the exact redirect URI `http://127.0.0.1:7340/oauth/callback` with your identity provider. The port defaults to 7340 and must be available. Entra requires a suitable application registration, API permissions and possibly tenant/admin consent; no tenant or client ID is guessed. Client secrets and noninteractive grants are not supported. An optional HTTPS `oauth.clientMetadataUrl` with a non-root path supports servers advertising client-ID metadata documents. Server-advertised challenge/resource scopes take precedence over configured fallback scopes, as specified by the SDK.

Dynamic registration responses and cached client registrations must omit `client_secret` and either omit `token_endpoint_auth_method` or set it to `none`. Confidential registrations are rejected before storage or use, without including credential values in errors. An authorization server may advertise confidential methods alongside public-client support; those capabilities alone are not rejected.

Private OAuth files live under `STATE_DIR\oauth`, with owner-only permissions and atomic replacement. Tokens, registration and discovery are isolated by exact backend URL, alias and OAuth configuration; tokens are never imported from Copilot or Agency. Refresh tokens survive refresh responses that omit a replacement. Concurrent calls within one backend share a refresh, and stale failures cannot invalidate a newer token generation. Expired access tokens remain syntactically valid on the wire so a normal 401 challenge can trigger SDK refresh; the gateway never synthesizes an empty bearer credential.

Credential-state writes and refreshes use an exclusive per-backend file lock. Explicit sign-in holds that lock until verification and publication finish; competing sign-ins or cross-process refreshes fail closed rather than overwrite credentials. A revision check rejects writes based on stale private state. Retry after the active operation finishes. An interrupted process can leave a lock: recovery requires confirming that no gateway or sign-in operation still owns it before removing that exact backend's `.lock` file. Locks are not automatically stolen based on age. Resource binding is validated with the SDK before discovery is saved; previously cached mismatched resource metadata is discarded and rediscovered.

Use HTTPS for remote services; HTTP is limited to loopback. HTTP redirects are rejected, and SDK resource validation remains enabled. Transfer packages explicitly reject native `oauth` configuration: register/configure and sign in separately at the destination. Existing conservative client-managed OAuth migration restrictions still apply. Authentication errors and `--help` show the helper's absolute runtime path, so invocation does not depend on the caller's working directory.

The exact backend notification GET (`Accept: text/event-stream`) has a bounded wait for response headers. Once successful SSE headers arrive, its body remains open until transport/controller cancellation or server closure. Discovery, other GETs, POST bodies and non-SSE responses retain their request deadlines; redirects remain rejected.

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

After a successful setup, reopen Copilot to load the generated connector, then execute the returned `readinessCommand` exactly. During adoption, finish active work, stop only the verified old gateway, and start the new connector using the generated entry before checking readiness and reconnecting other clients. A check-only command does not start an absent gateway. If setup reports `already-configured`, use the reported connector and state directory for the health check rather than inventing paths.

<a id="cross-client-migration-recovery"></a>
## Cross-client migration recovery

`connect-client.mjs --migrate` is a v0.6.0 workflow; v0.5 does not provide it. Adopt the v0.6.0 stable runtime through `/mcp-gateway-setup` before use. The plugin-root launcher delegates to the helper deployed with that runtime and fails with actionable guidance when the helper is absent. Preview never installs npm dependencies. Migration is a two-file transaction over one explicitly selected native client document and the gateway's private backend catalog. Preview is read-only. Apply validates the owned connector, state directory, catalog schema, source bytes, and both current files before writing. It does not install or upgrade the runtime, run `npm install`, discover configuration elsewhere, or restart the daemon.

Before any replacement, apply stores byte-exact copies as `client-config.json` and `backends.json` under one private backup directory. `rollback-manifest.json` records the operation, target and backup paths, and SHA-256 hashes for each original and replacement. The result returns `sourceBackupPath`, `backendBackupPath`, `manifestPath`, `rollbackCommand`, `backendRollbackCommand`, and `rollbackCommands`. Preserve those exact values; do not reconstruct paths from examples.

The generated Windows restore commands have this form:

```powershell
Copy-Item -LiteralPath '<reported-backend-backup>' -Destination '<reported-private-catalog>' -Force
Copy-Item -LiteralPath '<reported-client-backup>' -Destination '<reported-client-config>' -Force
```

Use the returned `rollbackCommands` in their reported order. Finish active agent work first, then restore both files and explicitly restart the owned gateway after checking the restored files. There is no automatic rollback.

Failure states are intentional and distinguishable:

- **Conflict:** the same alias has different supported settings. Apply aborts before writes and both files remain unchanged.
- **Preparation or first-write failure:** exact backups and the manifest are reported when created. Restore both if file state is uncertain; do not assume a failed operation changed nothing.
- **`partial-failure`:** the merged private catalog was published, but the second write did not replace the native client file. The runtime may therefore see the imported catalog while the client still has direct entries. Do not restart into that mixed state. After active work finishes, run both reported restore commands or resolve the two files deliberately, then restart explicitly.
- **Success:** the client file contains only the gateway connector in its native MCP collection and the validated catalog contains additions plus existing entries. A restart is required only when additions were published; it is never automatic.

Deduplication is alias-scoped. A matching alias with semantically equivalent supported settings is reported in `identicalDuplicates`; a matching alias with different settings is a conflict. Distinct aliases remain distinct even when their definitions are identical. The process does not claim to infer that differently named entries identify the same remote service.

Migration supports a conservative subset of the seven native formats. Relative executables or relative script arguments such as `node ./mcp.js` require an explicit absolute working directory; alternatively, configure absolute executable and script paths. The dispatcher fails closed rather than guessing a project root from the native configuration file location. Strict JSON is required for JSON clients; JSONC comments are not accepted. Referenced native variable or file interpolation, OAuth/client-managed authentication, migrated-alias trust/allow/deny or sandbox semantics, unsupported discovery or startup timeout semantics, and unknown behavior-bearing fields also fail closed. Unused VS Code `inputs` are allowed, and unrelated Claude permission data may remain when an existing gateway entry already matches. Preserve unsupported direct entries in their native client rather than weakening policy to migrate them.

For Codex only, migration parses TOML and preserves non-MCP values semantically, but comments and formatting are regenerated. The preview includes that warning, and the original TOML bytes and hashes remain available in the backup and manifest. Registration-only Codex setup is separate: it emits native `codex mcp add` arguments, rejects non-empty connector environment values, and never writes TOML.

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

OpenCode migration conservatively rejects any root or agent-level `permission` or legacy `tools` key containing `*` or `?`, even when the pattern appears unrelated to the migrated aliases. Do not remove these restrictions just to bypass the rejection; keep the affected configuration client-managed until equivalent controls can be preserved.

- Preview before apply; preserve the exact backup, hash manifest, and rollback output.
- Plugin download, stable runtime activation, and client connector registration are separate operations.
- Finish active work before switching or restarting a runtime, restoring configuration, or resolving a partial migration.
- Preserve unknown client fields and unrelated entries; refuse conflicts instead of guessing.
- Do not expose private environment values in generated command lines.
- Do not treat configuration-adapter tests as proof of a live third-party client session. Installed native config parsing is currently verified only for Copilot CLI and Claude Code.
