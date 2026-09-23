# Copyable migration prompt

Prefer the installed plugin workflow:

```text
/plugin marketplace add yeelam-gordon/MCPGateway
/plugin install shared-mcp-gateway@mcp-gateway
/mcp-gateway-setup
```

Use the machine's normal GitHub Git access. The setup skill resolves its installed plugin location, previews without writes or npm, and asks before changing global MCP routing. Apply returns the exact stable runtime, readiness command, backup path, rollback-manifest path, and manual restore command.

## Prompt for an agent

Set up the `shared-mcp-gateway` plugin on this machine. If the plugin is not installed, register the `yeelam-gordon/MCPGateway` marketplace and install `shared-mcp-gateway@mcp-gateway` using the existing GitHub Git access; never request, display, copy, or embed credentials. Invoke `/mcp-gateway-setup` and follow its preview-first workflow.

Resolve the setup skill's displayed `SKILL.md` path and derive the plugin root two parents above the skill directory. Do not assume the current working directory is the plugin root and do not invent a plugin-root environment variable. Run `node "<plugin-root>\tools\plugin-setup.mjs"` first. Preview must perform no writes and must not run npm.

Read and report the preview JSON fields `status`, `sourcePath`, `stateDir`, `privatePath`, `runtimePath`, `contentHash`, and `backendCount`. Preview does not yet create a backup, rollback manifest, or connector. Confirm Node.js 24 or newer. Do not assume a fixed backend count or that WorkIQ exists. Preserve every alias, tool allowlist, command argument, environment setting, and explicit Azure DevOps organization argument.

Before `--apply`, explain that setup changes the global native-client MCP routing for clients sharing the same Copilot home. It does not relocate history or modify Agency defaults/plugins, Memory Assistant, login state, or approval defaults. Ask for explicit approval unless this prompt was supplied by the user as authorization to install and migrate. Do not add `--allow-all`, `--yolo`, or broader permissions.

After approval, run `node <plugin-root>\tools\plugin-setup.mjs --apply`, adding only user-requested `--source-config PATH`, `--state-dir PATH`, `--port N`, or `--agency-adapters`. Use Agency adapters only when requested and supported aliases are verified locally; never guess service equivalence or promise that WorkIQ can be added without a verified mapping. The apply workflow requires registry access for a 120-second bounded `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`. It copies a stable hashed runtime under the private state directory, invokes the copied migration implementation, and does not directly start a daemon.

Read the apply JSON and return `runtimePath`, `privatePath`, `backupPath`, `manifestPath`, the copyable `rollbackCommand`, and the exact `readinessCommand`. On a failure after backup creation, report those recovery paths and the manual restore command from the failure JSON. On a failure before any backup, explicitly report that no source configuration was replaced. If it reports `already-configured`, do not overwrite it or claim an upgrade; use its `connectorPath` and `stateDir` with the requested or default port that setup verified and `--check`. Ask the user to restart Copilot CLI so the connector can start or reuse the owned gateway.

After restart, use `list_servers`, one focused `search_tools` query against a chosen alias, `get_tool_schema` for one selected tool, and one harmless read-only `call_tool` if available. Do not load a full backend catalog unnecessarily. Report exactly what was exercised; discovery is not proof that every backend works. For any backend requiring exclusive access, verify server-scoped ownership through `claim_server` and `release_server`; preserve `requiresExclusiveAccess` settings. Do not claim that a lease creates isolated browser contexts.

On failure, leave the original source configuration unchanged or use the generated rollback data. For rollback, import `stopOwnedGateway` from the returned stable runtime's `src/ensure-gateway.js`, stop only the process whose ownership matches the returned state directory and port, then restore the rollback manifest's recorded backup to its recorded source path. Never broadly kill Node processes or recursively delete plugin, Copilot, session, or gateway state. Keep the stable runtime unless the user separately approves removal after clients are restored. Plugin uninstall removes the skill but intentionally does not remove the active stable runtime.

## Manual clone alternative

If plugin installation is unavailable, clone `https://github.com/yeelam-gordon/MCPGateway` with existing Git access, run `npm ci` and `npm test`, then use `node .\tools\migrate-config.mjs` for dry-run and `node .\tools\migrate-config.mjs --apply` only after approval. This alternative operates from the clone and does not provide the plugin setup script's stable-cache installation workflow.
