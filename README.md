# Shared MCP Gateway

A localhost-only gateway that lets multiple Copilot or Agency CLI sessions reuse one persistent MCP backend connection per configured alias.

## Benefits

- **Less repeated startup:** clients reuse warm backend processes and HTTP connections.
- **Smaller tool context:** clients initially see a compact gateway surface and load downstream schemas only when needed.
- **Central local configuration:** aliases, allowlists, arguments, environment settings, and explicit organization arguments remain in one private catalog.
- **Safe adoption:** setup previews by default, preserves the source configuration in a backup, refuses conflicting reruns, and records rollback data.
- **Stable after plugin updates:** applied setup copies the runtime outside the plugin cache so uninstalling or refreshing the plugin does not break configured clients.
- **Shared browser coordination:** Playwright workflows use an exclusive gateway lease instead of competing for one browser state.

```text
Copilot or Agency
  -> thin stdio connector per CLI
  -> authenticated localhost gateway
  -> lazy shared backend per alias
```

## How to install

Install the plugin from a terminal:

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

Or install it interactively inside Copilot CLI:

```text
/plugin marketplace add yeelam-gordon/MCPGateway
/plugin install shared-mcp-gateway@mcp-gateway
```

The shorter `copilot plugin install yeelam-gordon/MCPGateway` also works in the tested CLI, but it displays a direct-install deprecation notice. The marketplace commands above are the recommended path.

Plugin installation only downloads the plugin. It does not rewrite MCP configuration or install the gateway runtime dependencies. After installation, run:

```text
/mcp-gateway-setup
```

The setup skill previews the operation first. Preview performs no npm or network operation and writes nothing; it shows the source MCP config, private state location, backend count, and proposed stable runtime path. Approve the explicit apply step to install the runtime outside the plugin cache, create an exact backup of the existing MCP config, and migrate that config to the shared gateway connector.

When apply succeeds, setup prints the exact top-level `sourcePath`, `backupPath`, `manifestPath`, `runtimePath`, `rollbackCommand`, `restartNewCli`, and `runtimeHealthPowerShell` values. Restart Copilot CLI as instructed, then run the printed health command. If the migrated setup does not work, close Copilot CLI and run the printed `rollbackCommand` to copy the exact backup back to `sourcePath`.

Use your normal GitHub Git access to install the plugin. `copilot mcp add` is not a substitute for this setup: it registers a command but does not migrate the existing MCP configuration or install this gateway's runtime dependencies.

## Using the gateway

Use the smallest discovery path needed:

1. `list_servers` to see configured aliases without starting all backends.
2. `search_tools` with one alias and a focused query.
3. `get_tool_schema` for the selected tool.
4. `call_tool` with validated arguments.

`claim_playwright` and `release_playwright` coordinate exclusive browser workflows. WorkIQ is available only when it already exists in the migrated local catalog. If asked to add WorkIQ or an Agency adapter, first verify a supported local mapping; the gateway does not promise any particular backend or server count.

The migration preserves aliases and configured tool allowlists. It changes the global native-client MCP configuration for clients using the same Copilot home, but does not relocate Copilot history or modify Agency defaults/plugins, Memory Assistant, or approval defaults. Plugin uninstall removes the setup skill, not an applied stable runtime, to avoid breaking active client configuration.

## Manual developer setup

For repository development or when plugin installation is unavailable:

```powershell
git clone https://github.com/yeelam-gordon/MCPGateway
cd .\MCPGateway
npm ci
npm test
node .\tools\migrate-config.mjs
```

Review the dry-run JSON before applying:

```powershell
node .\tools\migrate-config.mjs --apply
```

Optional migration arguments are `--source-config PATH`, `--state-dir PATH`, `--port N`, and `--agency-adapters`. Use Agency adapters only for verified locally supported aliases; do not guess service equivalence or broaden permissions.

After migration, start `copilot` normally. To check an existing installation, use the connector, state directory, and port recorded by setup:

```powershell
node <stable-runtime>\tools\connector.mjs --state-dir <state-dir> --port <port> --check
```

The connector auto-starts only when invoked with its explicit auto-start configuration. A health check confirms the gateway, not every downstream backend. Raw HTTP backends may still require their normal authentication.

## Result and rollback

Successful apply output includes the exact top-level `sourcePath`, `backupPath`, `manifestPath`, `runtimePath`, `rollbackCommand`, `restartNewCli`, and `runtimeHealthPowerShell` values, plus an explicit success `message`. If setup fails before creating a backup, `backupPath`, `manifestPath`, and `rollbackCommand` are `null` and the output states that the source config was not replaced. If migration fails after backup creation, the failure output includes the exact backup path and the copyable PowerShell `rollbackCommand` and an explicit failure `message` immediately.

Restore is never performed silently. Close Copilot CLI before running the returned `rollbackCommand`. Do not broadly kill Node processes or recursively delete Copilot or gateway state.

Measured gateway timings are not whole-CLI startup timings. Network, authentication, plugin loading, and model work still contribute to end-to-end latency.

## License

MIT - see [LICENSE](LICENSE). Third-party dependencies retain their respective licenses.
