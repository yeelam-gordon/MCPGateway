---
name: mcp-gateway-setup
license: MIT
description: 'Set up the shared MCP gateway.'
---

# Shared MCP Gateway Setup

Set up the installed `shared-mcp-gateway` plugin without relying on the current working directory.

## Keep the user-facing output short

- Do not echo this skill, raw setup JSON, content hashes, or every runtime path into chat.
- Preview: give the status, backend count, whether anything changes, and the one approval needed. Inspect all returned fields internally.
- Already configured: report health and whether an upgrade is needed; state that nothing changed.
- Success: give the outcome, the next required action, and the exact backup path plus copyable restore command.
- Failure: give the specific error and whether configuration changed. Include the exact backup path and restore command when available.
- Show runtime, manifest, and connector paths only when needed to resolve a problem or explicitly requested. Do not omit recovery information or approval requirements for brevity.

## When to Use This Skill

- Set up or configure the Shared MCP Gateway after plugin installation.
- Preview or apply migration of an existing Copilot MCP configuration.
- Verify an existing gateway installation or explain rollback.
- Import newly added entries from the selected user MCP configuration into an existing gateway without reinstalling its runtime.
- Connect another agent client or migrate its supported native MCP entries into the same shared catalog.
- Add eligible Agency adapters when the user explicitly requests them.

## Prerequisites

- Node.js 24 or newer.
- Normal Git access to the plugin repository. Never request, display, or copy credentials.
- Registry access for `npm ci` during `--apply`.
- An existing Copilot MCP configuration. Missing or malformed source configuration fails without creating gateway state.

## Safe Setup Workflow

1. Resolve this displayed `SKILL.md` path, then resolve the plugin root exactly two parents above its directory. Do not assume the process working directory is the plugin root.
2. Resolve the [setup script](../../tools/plugin-setup.mjs) relative to this file and confirm it exists. Its absolute path is `<plugin-root>\tools\plugin-setup.mjs`.
3. Run preview first; preview performs no writes and does not run npm:

   ```powershell
   node "<plugin-root>\tools\plugin-setup.mjs"
   ```

4. Read and inspect the preview fields `status`, `sourcePath`, `stateDir`, `privatePath`, `runtimePath`, `contentHash`, and `backendCount`. Summarize them using the short-output rules above. Preview does not yet create a backup or rollback manifest. Do not claim installation or upgrade when the result is only `planned` or `already-configured`.
5. Explain that `--apply` changes the global native-client MCP routing for clients using the same Copilot home. It preserves server aliases and allowlists and does not change Copilot history, Agency defaults or plugins, Memory Assistant, approval defaults, or unrelated configuration.
6. Obtain explicit approval immediately before `--apply`, unless the user's current request already clearly authorizes both installation and migration. A request to inspect, preview, or install the plugin alone is not approval to migrate global routing.
7. Apply only after approval:

   ```powershell
   node "<plugin-root>\tools\plugin-setup.mjs" --apply
   ```

8. Read the apply JSON and give an explicit success or failure message. Inspect `sourcePath`, `backupPath`, `manifestPath`, `runtimePath`, `rollbackCommand`, and `readinessCommand` internally. Report the outcome, required next step, exact backup path, and copyable safely quoted PowerShell restore command rather than dumping all fields. `--apply` installs the stable runtime and migrates the MCP configuration; it is not merely a plugin download. The script copies the runtime to `<stateDir>\runtime\<contentHash>`, runs a 120-second bounded `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`, and invokes the copied migration implementation. It does not start the gateway daemon directly; after the client restarts, the connector starts or reuses the owned gateway.
9. Ask the user to restart Copilot CLI, then use the gateway in this order: `list_servers`, focused `search_tools` for one alias, `get_tool_schema` for one selected tool, then `call_tool`. If discovery reports `requiresExclusiveAccess: true`, call `claim_server` with that server alias once before the workflow and `release_server` after its calls finish. Non-exclusive servers need no claim. Do not fetch a whole backend catalog when a focused search is enough.

## Options

Append only options required by the user's request:

```text
--source-config PATH
--state-dir PATH
--port N
--agency-adapters
--adopt-existing
```

Use `--agency-adapters` only when the user asks to add Agency support and the local catalog contains verified supported aliases. WorkIQ is not guaranteed to exist in every installation. Preserve explicit aliases, including Azure DevOps organization-specific aliases; never guess that two services are equivalent.

## Failure Reporting

- If apply fails before any migration backup is created, state explicitly that the source configuration is unchanged and no backup or restore is needed. Dependency installation failure is in this category.
- If apply fails after a backup is created, report the structured `sourcePath`, `backupPath`, `manifestPath`, `runtimePath`, and copyable `rollbackCommand` from the failure JSON. Do not hide recovery data behind a generic error.
- Never silently restore or broadly undo changes. Present the exact manual restore command and let the user decide whether to run it.
- The rollback command must use literal, safely PowerShell-quoted paths and must not contain secrets.

## Existing Installation and Health

- Every invocation should preview the selected user MCP config for entries added alongside the gateway connector, even when no plugin update exists. When the result is `planned-sync`, summarize new aliases, identical duplicates, and conflicts before requesting approval to apply.
- A same-name conflict must be resolved explicitly; never overwrite existing backend definitions to finish setup. Preserve tool allowlists, credentials, disabled state, and server ownership settings.
- Configuration-only synchronization must not run npm or redeploy the runtime. After an approved sync, show the exact client/backend backup paths and restore commands, then coordinate an idle-time owned-gateway restart.
- Do not collect repository/plugin MCPs implicitly, and do not silently combine pending configuration sync with runtime adoption. Complete and verify each required step separately.

- If setup returns `already-configured`, do not overwrite or describe it as upgraded. Inspect its paths internally and report health and unchanged state, not the full path inventory.
- If the user explicitly asks to move an existing checkout installation or adopt a newer plugin runtime, preview with `--adopt-existing`, review the returned backup and adapter paths, and obtain approval before adding `--apply`. Preserve the backend catalog byte-for-byte; do not feed the connector-only configuration into a fresh migration.
- After adoption, finish active client work, stop only the old owned daemon using its recorded state directory and port, then start the new connector using the generated MCP entry. Verify backend aliases, an allowed harmless call, and shared process reuse before declaring success. Do not delete the development checkout, backend data, or old runtime.
- Do not modify unrelated shell profiles during runtime adoption. If other client configurations still reference the old runtime, report them and update only their connector paths when the user has authorized that integration.
- For a newly configured installation, execute the returned `readinessCommand` exactly. For `already-configured`, run `connectorPath` with the returned `stateDir`, the requested or default port that setup verified, and `--check`. Do not invent paths or rely on the plugin cache.
- Discovery proves only that an alias is configured. Report exactly which backend and harmless read-only tool, if any, were exercised.

## Migrating another agent client

Use this workflow only for an existing shared gateway. Confirm the selected client and exact configuration file; do not infer scopes or merge every configuration found on the machine. Read the [client guide](../../docs/CLIENTS.md) for supported fields and current native-client validation limits.

1. Resolve [the client helper](../../tools/connect-client.mjs) from this installed plugin. If it reports that the configured stable runtime is too old, complete an explicitly approved runtime adoption first; do not install dependencies into the plugin cache.
2. Preview the selected native file using `claude`, `vscode`, `codex`, `opencode`, `qwen`, `kimi`, or `antigravity`:

   ```powershell
   node "<plugin-root>\tools\connect-client.mjs" --client "<client>" --config "<native-config>" --gateway-config "<copilot-mcp-config>" --migrate
   ```

3. Explain additions, identical same-name duplicates, conflicts, and format warnings. Codex TOML changes regenerate comments/formatting; original bytes are backed up. Unsupported authentication, variable references, client policies, or syntax must be resolved explicitly, never stripped to make migration succeed.
4. Obtain approval to change both the selected client file and shared catalog before appending `--apply`. This makes imported aliases available to other clients of that gateway. Different aliases remain distinct; do not silently merge organization-specific connections.
5. Inspect the result and provide both backup paths and exact restore commands. If publication is partial, identify which file changed and retain both backups; never automatically roll back over later user edits.
6. If a restart is required, finish active work, restart only the verified owned gateway, and reopen affected clients. Verify catalog additions and an approved harmless call before claiming runtime success. Migration itself does not install a new runtime or restart it.

Without `--migrate`, the helper only registers the connector and leaves existing native MCP entries in place. Do not describe registration-only mode as importing or deduplicating those entries. Do not use the Copilot-only setup script to rewrite another client's native format.

OpenCode migration conservatively rejects every root or agent-level `permission` or legacy `tools` key containing `*` or `?`, even when it appears unrelated to the selected aliases. Do not remove restrictive policies to bypass this guard; keep those configurations client-managed until equivalent controls can be preserved.

## Transferring a backend catalog

Use the plugin's [transfer utility](../../tools/transfer-config.mjs) when asked to prepare configuration for another machine. Export from the backend catalog, never from a connector-only MCP configuration. Endpoint URLs are always materialized locally on the destination because URL paths and signed query strings can themselves be credentials. Inspect the exported template before sharing; aliases and organization names may still be private.

On the destination, collect replacement values locally for every requirement. Do not print them, copy OAuth caches, or guess credentials. Import into a new file, compare its aliases and tool allowlists with the intended catalog, then preview setup against the chosen destination MCP configuration. Back up and merge any destination servers before replacing them. A transfer package is configuration data, not a copy of a running gateway.

## Rollback procedure

Use only the exact `rollbackCommand` and paths returned by apply or failure JSON. Show the user the exact source and backup paths before manual restore.

1. Stop only the gateway process proven to be owned by that state directory and port by importing `stopOwnedGateway` from the stable runtime's `src/ensure-gateway.js`.
2. Restore the manifest's source path from its recorded backup after verifying the source and backup paths.
3. Do not broadly kill Node processes and do not recursively delete plugin, state, Copilot home, or session directories.
4. Keep the stable runtime unless the user separately approves removal after all clients are restored. Plugin uninstall removes the skill but intentionally does not remove the active stable MCP runtime, so existing clients are not broken.

## Safety Rules

- Keep migration preview-first and approval-gated. Never add `--apply` silently.
- Never transmit secrets off-machine, copy authentication from another machine, or write services/startup tasks.
- Preserve the permission baseline. Do not add `--allow-all`, `--yolo`, or broader downstream allowlists.
- The gateway is a global connector for native clients sharing the same Copilot home. It does not modify Agency defaults/plugins or Memory Assistant, and it does not relocate history.
- A gateway approval can reach any downstream tool permitted by the selected alias's configured allowlist; it is not a separate CLI approval boundary per downstream tool.
- Do not hardcode a server count, port beyond the selected/default value, or assume WorkIQ is present.
- Preserve each backend's `requiresExclusiveAccess` setting. Only the legacy alias `playwright` defaults to exclusive when unset; renamed browser aliases require an explicit setting. Standard MCP input schemas do not declare this gateway ownership policy.
- Do not retry an exclusive workflow or release its server after an unknown-outcome timeout. Report the uncertainty and require an idle-time gateway restart. Client disconnect is not proof that the underlying operation stopped.

## Troubleshooting

| Issue | Action |
|---|---|
| Plugin install fails | Confirm GitHub connectivity and normal Git access to `yeelam-gordon/MCPGateway`; do not collect credentials. |
| Node version is too old | Install or select Node.js 24 or newer before applying. |
| Dependency install fails | Report registry/network failure; do not claim migration completed. |
| Port is occupied or config conflicts | Stop and report the exact conflict. Never replace an unknown listener or overwrite a different gateway configuration. |
| Authentication is required by a backend | Report that raw HTTP backends can still require their normal authentication; do not move tokens or sessions. |
