---
name: mcp-gateway-setup
license: MIT
description: 'Install and safely migrate an existing Copilot MCP configuration to the shared-mcp-gateway plugin. Use when asked to set up, configure, preview, apply, verify, or roll back the Shared MCP Gateway, including optional Agency adapters.'
---

# Shared MCP Gateway Setup

Set up the installed `shared-mcp-gateway` plugin without relying on the current working directory.

## When to Use This Skill

- Set up or configure the Shared MCP Gateway after plugin installation.
- Preview or apply migration of an existing Copilot MCP configuration.
- Verify an existing gateway installation or explain rollback.
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

4. Read the preview JSON. Report `status`, `sourcePath`, `stateDir`, `privatePath`, `runtimePath`, `contentHash`, and `backendCount`. Preview does not yet create a backup or rollback manifest. Do not claim installation or upgrade when the result is only `planned` or `already-configured`.
5. Explain that `--apply` changes the global native-client MCP routing for clients using the same Copilot home. It preserves server aliases and allowlists and does not change Copilot history, Agency defaults or plugins, Memory Assistant, approval defaults, or unrelated configuration.
6. Obtain explicit approval immediately before `--apply`, unless the user's current request already clearly authorizes both installation and migration. A request to inspect, preview, or install the plugin alone is not approval to migrate global routing.
7. Apply only after approval:

   ```powershell
   node "<plugin-root>\tools\plugin-setup.mjs" --apply
   ```

8. Read the apply JSON and give an explicit success or failure message. On success, report the top-level `sourcePath`, `backupPath`, `manifestPath`, `runtimePath`, copyable safely quoted PowerShell `rollbackCommand`, and exact `readinessCommand`. `--apply` installs the stable runtime and migrates the MCP configuration; it is not merely a plugin download. The script copies the runtime to `<stateDir>\runtime\<contentHash>`, runs a 120-second bounded `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`, and invokes the copied migration implementation. It does not start the gateway daemon directly; after the client restarts, the connector starts or reuses the owned gateway.
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

- If setup returns `already-configured`, do not overwrite or describe it as upgraded. Report `connectorPath`, `runtimePath`, `privatePath`, and `stateDir` from the JSON.
- If the user explicitly asks to move an existing checkout installation or adopt a newer plugin runtime, preview with `--adopt-existing`, review the returned backup and adapter paths, and obtain approval before adding `--apply`. Preserve the backend catalog byte-for-byte; do not feed the connector-only configuration into a fresh migration.
- After adoption, finish active client work, stop only the old owned daemon using its recorded state directory and port, then start the new connector using the generated MCP entry. Verify backend aliases, an allowed harmless call, and shared process reuse before declaring success. Do not delete the development checkout, backend data, or old runtime.
- Do not modify unrelated shell profiles during runtime adoption. If other client configurations still reference the old runtime, report them and update only their connector paths when the user has authorized that integration.
- For a newly configured installation, execute the returned `readinessCommand` exactly. For `already-configured`, run `connectorPath` with the returned `stateDir`, the requested or default port that setup verified, and `--check`. Do not invent paths or rely on the plugin cache.
- Discovery proves only that an alias is configured. Report exactly which backend and harmless read-only tool, if any, were exercised.

## Transferring a backend catalog

Use the plugin's [transfer utility](../../tools/transfer-config.mjs) when asked to prepare configuration for another machine. Export from the backend catalog, never from a connector-only MCP configuration. Inspect the exported template before sharing; placeholders exclude credentials and local paths, but ordinary endpoints and organization names may still be private.

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
