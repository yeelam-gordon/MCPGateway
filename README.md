# Shared MCP Gateway

## 1,000 backend tools. Just 6 gateway tools in Copilot.

**One local gateway. Fewer duplicate backend processes. Less tool-schema context upfront.**

Instead of exposing every backend tool upfront, Copilot uses a fixed **6-tool interface** to discover and call the capability it needs. Open another CLI session and reuse the same gateway rather than starting another independent backend fleet.

| Benefit | Without shared routing | With MCPGateway |
|---|---|---|
| **Smaller advertised tool interface** | 1,000 backend tools exposed directly | **6 gateway tools** — **99.4% fewer advertised tool definitions** in this example |
| **Less duplicate backend work** | 5 clients × 20 initialized backend aliases = 100 client-to-backend connections | **20 shared backend connections**, plus 5 lightweight gateway client connections |
| **Less duplicated backend RAM** | Each CLI can start its own copies of local MCP servers | **One shared instance per backend alias**, rather than one per CLI |
| **Focused schema loading** | Fetch the full catalog of input schemas | Search summaries, then retrieve **1 selected schema** |
| **Automatic startup** | Start and manage separate backend fleets per client | **1 gateway per machine**, started on first use |

The connection counts are an architectural example for clients using the same 20 backend aliases; unused aliases do not start. They are not total OS process counts. The 99.4% figure compares tool-definition counts, **not** token usage or end-to-end startup speed.

Works with ordinary **Copilot CLI**. **Agency is optional.**

## Benefits

- **A fixed-size tool interface:** adding more backend tools does not add more gateway tool definitions to Copilot.
- **On-demand schemas:** search tool summaries first, then fetch the full schema of the selected tool.
- **Less repeated startup:** multiple CLI sessions reuse one local gateway and its initialized backend connections.
- **More room for your actual work:** avoid multiplying local backend processes and their memory usage every time you open another CLI.
- **Warm backends:** closing one client does not shut down the shared backend fleet.
- **One private configuration:** preserve your server aliases, tool allowlists, credentials, and organization-specific arguments.
- **Backed-up setup:** preview changes before applying them and receive an exact manual restore command.

### Why this can save RAM—and model context

**Run several Copilot sessions without paying for the same local backend fleet each time.**

For illustration, if one local MCP backend fleet consumes **300 MB**, five independent copies consume **1,500 MB**. Sharing that fleet brings the duplicated backend portion back toward **300 MB**, plus gateway/connector overhead and any extra concurrent-work memory. That is **1,200 MB less duplicated baseline backend memory** in this example—not a measured saving or a cap on total application RAM.

There are two different benefits:

| Resource | What the gateway reduces |
|---|---|
| **Local RAM and processes** | Duplicate local MCP server instances across CLI sessions. HTTP-only backends may offer smaller local-memory savings. |
| **Model context, measured in tokens** | Upfront exposure to backend tool definitions: the model starts with **6 gateway tools**, then retrieves the selected backend schemas on demand. |

**A Copilot process using 1.5 GB of RAM does not mean its context window is full.** RAM can contain conversation history, outputs, caches, and other runtime state. The gateway does not eliminate Copilot's own memory usage or enlarge the model's context limit.

The value is avoiding repeated backend overhead **and** keeping the initial tool interface small. Actual savings depend on your servers, concurrent workload, and the client's existing tool-discovery behavior.

### What has been verified?

- **1,000-tool synthetic catalog, 2 clients:** both see exactly **6 gateway tools**; a focused search returns **1 matching summary**, and a second client reuses the cached catalog instead of fetching it again. [Test](test/catalog-scale.test.js)
- **124 automated tests** passed for v0.4.1, covering sharing, ownership, cancellation, migration, recovery, and platform behavior.
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
```

`npm run setup` previews only. To apply after reviewing it, use `npm run setup -- --apply`. See [MIGRATION_PROMPT.md](MIGRATION_PROMPT.md) for an agent-guided workflow.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release checks, [CHANGELOG.md](CHANGELOG.md) for API changes, and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

MIT - see [LICENSE](LICENSE). Third-party dependencies retain their respective licenses.
