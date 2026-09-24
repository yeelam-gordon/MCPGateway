# Client integration: keep the core small

<a id="table-of-contents"></a>
## Table of contents

- [Compatibility summary](#compatibility-summary)
- [Shared gateway prerequisite](#shared-gateway-prerequisite)
  - [Install the shared core](#shared-core-install)
  - [Upgrade the shared core](#shared-core-upgrade)
  - [Register or repoint one client](#register-or-repoint-one-client)
  - [Migrate native client connections](#cross-client-migration)
- [Copilot CLI](#copilot-cli)
  - [Install](#copilot-cli-install)
  - [Upgrade](#copilot-cli-upgrade)
- [VS Code](#vs-code)
  - [Install](#vs-code-install)
  - [Upgrade](#vs-code-upgrade)
- [Claude Code](#claude-code)
  - [Install](#claude-code-install)
  - [Upgrade](#claude-code-upgrade)
- [Codex](#codex)
  - [Install](#codex-install)
  - [Upgrade](#codex-upgrade)
- [OpenCode](#opencode)
  - [Install](#opencode-install)
  - [Upgrade](#opencode-upgrade)
- [Qwen Code](#qwen-code)
  - [Install](#qwen-code-install)
  - [Upgrade](#qwen-code-upgrade)
- [Kimi Code CLI](#kimi-cli)
  - [Install](#kimi-cli-install)
  - [Upgrade](#kimi-cli-upgrade)
- [Antigravity CLI](#antigravity-cli)
  - [Install](#antigravity-cli-install)
  - [Upgrade](#antigravity-cli-upgrade)
- [Preferred integration](#preferred-integration)
- [Configuration adapter layer](#configuration-adapter-layer)
- [Official references](#official-references)

MCPGateway operates **after MCP servers have been configured**. It does not replace a client's marketplace, backend installer, authentication flow, or tool-discovery UI.

There are two different integration questions:

1. Can the client connect to the gateway using MCP?
2. Can the client install this repository's setup plugin unchanged?

Supporting the same MCP transport does not imply using the same plugin manifest or configuration schema. Except for the tested Copilot workflow, the instructions below register an already-installed gateway connector; they do not automatically migrate a fresh installation from another client.

<a id="compatibility-summary"></a>
## Documentation-based compatibility

Checked against official documentation on 2026-09-24. Installed Copilot CLI and Claude Code builds have parsed isolated synthetic configuration without launching a model or backend. The v0.6.0 migration adapters are repository-tested against native document formats; VS Code, Codex, OpenCode, Qwen Code, Kimi, and Antigravity have not completed native end-to-end migration sessions.

| Client | Native MCP configuration | Packaging/runtime status |
|---|---|---|
| Copilot CLI | `$COPILOT_HOME/mcp-config.json` or `~/.copilot/mcp-config.json`; `mcpServers` | Marketplace install is the standard path. Local checkout install worked in an isolated test but is deprecated by the current CLI. |
| VS Code | Workspace `.vscode/mcp.json` or user-profile `mcp.json`; `servers` | VS Code is an editor, not a CLI. Registration adapter tested; editor session not exercised. |
| Claude Code | User/local `~/.claude.json` or project `.mcp.json`; `mcpServers` | Isolated project config parsing was verified as pending approval; no model or backend was launched. |
| Codex | User `~/.codex/config.toml` or trusted-project `.codex/config.toml`; `mcp_servers` | Registration emits native CLI arguments. Opt-in migration parses and rewrites TOML with an explicit formatting warning; installed native validation was blocked by managed policy. |
| OpenCode | Global `~/.config/opencode/opencode.json` or project `opencode.json`; `mcp` | Native JSON registration adapter tested; no live OpenCode session exercised. |
| Qwen Code | User `~/.qwen/settings.json` or project `.qwen/settings.json`; `mcpServers` | Native/portable manifests are schema-tested; no live Qwen model session was exercised. |
| Kimi Code CLI | Explicitly selected strict-JSON file using the current upstream `mcpServers` schema | Adapter-tested only. Installed Kimi 0.38.0 exposes no MCP command, and its installed help does not establish a default MCP file path. |
| Antigravity CLI | Global `~/.gemini/config/mcp_config.json` or workspace `.agents/mcp_config.json`; `mcpServers` | CLI registration adapter tested. Antigravity IDE is a separate UI surface and was not exercised. |

<a id="shared-gateway-prerequisite"></a>
## Shared gateway prerequisite

Every client registration below points to the same stable stdio connector. Today, the supported way to create that connector and its private backend catalog is the Copilot setup workflow. Do not present `connect-client.mjs` as a standalone fresh installer for another client.

<a id="shared-core-install"></a>
### Install the shared core

Install from the advertised Copilot marketplace in a terminal:

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

Then start Copilot CLI and invoke `/mcp-gateway-setup`. Review its preview before approving changes. The setup skill installs the runtime outside the plugin cache, backs up the selected Copilot MCP configuration, and writes the `shared-mcp-gateway` connector used as the source for other clients. Close and reopen Copilot so the generated connector starts or reuses the gateway, then run the exact `readinessCommand` returned by setup. A check-only command does not start an absent gateway. Preserve the printed backup and rollback commands. See [setup recovery](REFERENCE.md#setup-recovery) if readiness or restart fails.

Installing the plugin alone does not migrate configuration. The gateway does not install backend MCP servers or provide their credentials.

Before using the adapter commands below, ask `/mcp-gateway-setup` in Copilot CLI to **locate the installed plugin root and report its absolute path without applying changes**. The skill resolves its own installed location; the root contains `tools/connect-client.mjs`. Replace `<plugin-root>` with that reported directory. Do not guess or hardcode a plugin-cache path, and resolve it again after a plugin update.

Replace `<copilot-mcp-config>` with the actual Copilot configuration containing the generated connector: normally `~/.copilot/mcp-config.json`, or the file under your configured `COPILOT_HOME`. Replace each destination placeholder with the native client file you intend to change; the angle-bracket placeholders are not literal command arguments.

<a id="shared-core-upgrade"></a>
### Upgrade the shared core

Updating plugin files and switching the running gateway are separate operations:

```powershell
copilot plugin marketplace update mcp-gateway
copilot plugin update shared-mcp-gateway@mcp-gateway
```

After the plugin update, invoke `/mcp-gateway-setup` and explicitly request adoption of the updated runtime. Review the preview and approve the backed-up switch. Finish active work and have the setup skill stop only the old gateway verified as owned by the reported state directory and port. Start the new connector using the generated MCP entry, or reopen Copilot to start it, then run the exact readiness command before reconnecting other clients. Never stop unrelated Node processes. Other client entries continue to point to the old stable connector until they are deliberately repointed. If the Windows updater reports `Access denied`, use the tested [cache-only recovery](REFERENCE.md#windows-plugin-cache-access-denied); it does not replace or modify the stable runtime.

<a id="register-or-repoint-one-client"></a>
### Register or repoint one client

`tools/connect-client.mjs` requires an explicit client and destination. It reads the source connector from `--gateway-config`, or from `$COPILOT_HOME/mcp-config.json` / `~/.copilot/mcp-config.json` when that option is omitted.

Preview first:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client <client> `
  --config "<native-client-config>" `
  --gateway-config "<copilot-mcp-config>"
```

For supported JSON clients, apply only after reviewing the preview:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client <client> `
  --config "<native-client-config>" `
  --gateway-config "<copilot-mcp-config>" `
  --apply
```

The JSON adapters preserve unrelated top-level settings and other MCP servers. Apply creates a private backup before replacing the selected configuration. The adapter refuses malformed JSON, JSONC comments, unsupported client-managed values, or an existing conflicting `shared-mcp-gateway` alias. There is intentionally no `--replace` flag.

To repoint after a runtime upgrade, rerun preview with the updated source connector. `already-configured` means no change is required. If the destination contains the old connector and the adapter reports a conflict, first make a separate backup of that native client file, then manually update **only** its `shared-mcp-gateway` entry to the command and arguments from the new source connector. Preserve every other server and setting. Do not rewrite an unknown format or claim the other client's backend definitions were migrated.

Codex registration is different: in current registration-only use, preview emits a native command and `--apply` is rejected. Registration preview also rejects a source connector with a non-empty `env`, because emitting those values on a command line could expose them.

<a id="cross-client-migration"></a>
### Migrate native client connections

> **v0.6.0:** v0.5 does not support `--migrate`. Upgrade to v0.6.0 or newer, invoke `/mcp-gateway-setup`, and explicitly adopt the new stable runtime before using this workflow.

Migration is optional and is never implied by registration or upgrade. It imports supported direct MCP entries from one explicitly selected client file into the gateway's validated private catalog, then leaves only the `shared-mcp-gateway` connector in that client's native MCP collection. Unrelated root settings remain in the client document.

Preview first; it changes no files:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client <claude|vscode|codex|opencode|qwen|kimi|antigravity> `
  --config "<exact-native-client-config>" `
  --gateway-config "<copilot-mcp-config>" `
  --migrate
```

After reviewing `addedAliases`, `identicalDuplicates`, `conflicts`, warnings, counts, and paths, apply explicitly by adding `--apply`. The plugin-root launcher delegates migration to the helper deployed with the adopted stable runtime. If that runtime is still v0.5 or otherwise lacks the helper, stop and adopt the new runtime through `/mcp-gateway-setup`; do not run `npm install` in the plugin cache or runtime. Preview performs no dependency installation. Migration requires an existing destination file and an owned connector whose private catalog and state directory validate; it does not publish or upgrade the runtime, discover personal config paths, or start/restart the gateway.

**OpenCode wildcard policies:** migration conservatively rejects any `*` or `?` key in root or agent-level `permission` or legacy `tools` rules, including patterns that appear unrelated to the selected MCP aliases. Keep the configuration client-managed until equivalent restrictions can be preserved; do not remove deny rules merely to make migration pass.

The merge uses aliases deliberately:

- The same alias with semantically equivalent supported settings is one duplicate and is not added again. Defaults such as `type: "stdio"` and `disabled: false` do not create false differences.
- The same alias with different settings is a conflict. Apply aborts without changing either file.
- Different aliases remain separate even when their definitions are identical. Migration does not promise to identify every pair of aliases that reach the same service.

Apply creates byte-exact backups of both the selected client file and private backend catalog. `rollback-manifest.json` records each original and replacement SHA-256 hash, target path, and backup path. Preserve the returned `sourceBackupPath`, `backendBackupPath`, `manifestPath`, and exact `rollbackCommands`. If the second write fails, the merged catalog may already be published while the client file remains unchanged: status is `partial-failure`, and there is no automatic rollback. Finish active work, inspect both files for later edits, and use the reported restore commands only for the files you explicitly choose to restore. See [migration recovery](REFERENCE.md#cross-client-migration-recovery).

The supported subset is intentionally narrower than each client schema. Before migration, make every local command location-independent: relative executables or relative script arguments such as `node ./mcp.js` require an explicit absolute `cwd`, or the configured executable/script paths must themselves be absolute. The adapter does not guess a native project root from the configuration file location. Migration fails closed when that requirement is not met. It also rejects strict-JSON comments, referenced native variable/file interpolation, OAuth or client-managed authentication, migrated-alias trust/allow/deny or sandbox semantics that cannot be preserved, discovery/startup-only timeout semantics, tool denylist semantics, and unknown behavior-bearing fields. Unused VS Code `inputs` may remain, and a matching existing gateway entry does not make unrelated Claude permissions a migration target. Keep unsupported entries client-managed; do not strip policy merely to make migration pass.

Codex `--migrate` uses a native TOML parser and supports the documented canonical subset. It preserves non-MCP settings semantically, but preview warns that TOML comments and formatting will be regenerated; apply still backs up the original bytes and hashes them. This is separate from registration-only mode, which continues to emit `codex mcp add` arguments and does not write TOML.

The v0.6.0 repository coverage imports 10 existing catalog aliases plus 2 new aliases from each of the seven formats, confirms the result remains 12, and connects two SDK clients through the imported configuration to the same backend process ID. This validates adapters and shared-process behavior, not every installed client version or native UI.

<a id="copilot-cli"></a>
## Copilot CLI

**Support status:** High confidence for plugin installation, skill discovery, and the setup workflow on the tested platform.

<a id="copilot-cli-install"></a>
### Install

Follow [Install the shared core](#shared-core-install). The standard distribution path is:

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

Run `/mcp-gateway-setup` inside Copilot CLI. The normal user configuration is `$COPILOT_HOME/mcp-config.json` when `COPILOT_HOME` is set, otherwise `~/.copilot/mcp-config.json`. Restart Copilot to load the generated connector, then run its readiness command.

If another tool later adds MCP entries beside the gateway entry, rerun setup even when no newer plugin version exists. Preview makes no changes. After approval, apply backs up both configurations, imports new definitions with their settings and allowlists preserved, deduplicates identical entries, and refuses same-name conflicts. It does not reinstall the runtime for a configuration-only sync or automatically absorb repository/plugin-supplied entries. After applying, finish active work and ask the setup skill to restart only the owned gateway so the new configuration takes effect. With no additions, setup reports that nothing changed.

A local checkout install was verified with `copilot plugin install "<checkout>"` in an isolated `COPILOT_HOME`, but the current CLI warns that direct local/repository installs are deprecated. Do not use that as the published upgrade path.

<a id="copilot-cli-upgrade"></a>
### Upgrade

Run the commands in [Upgrade the shared core](#shared-core-upgrade), then invoke `/mcp-gateway-setup` to preview and adopt the updated runtime. `copilot plugin update` updates the cached plugin; it does not silently switch the stable runtime or migrate newly conflicting entries. Keep the old runtime available until the new readiness check succeeds.

<a id="vs-code"></a>
## VS Code

**Support status:** Medium confidence. The native format and adapter are tested; the editor integration has not been exercised. VS Code is an editor surface, not a client CLI.

<a id="vs-code-install"></a>
### Install

First complete [Install the shared core](#shared-core-install). Register the connector in a workspace file:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client vscode `
  --config "<workspace>\.vscode\mcp.json" `
  --gateway-config "<copilot-mcp-config>"
```

Review, then repeat with `--apply`. Registration writes VS Code's native `servers` entry with `type: "stdio"`. To consolidate existing direct entries, use the opt-in [migration workflow](#cross-client-migration); referenced inputs or variables and migrated-alias sandbox, trust, or authentication semantics abort without changes; unused VS Code `inputs` are preserved. For user-wide registration, open VS Code's **MCP: Open User Configuration** command and pass that selected profile's `mcp.json` path explicitly instead of guessing a profile location. Use **MCP: List Servers** to inspect the registered server.

Do not confuse `.vscode/mcp.json` with portable `.mcp.json`: both are documented, but they use different top-level collection names.

<a id="vs-code-upgrade"></a>
### Upgrade

Upgrade the shared core first, then rerun the VS Code registration preview against the same selected `mcp.json`. This only repoints the gateway alias; it does not import direct entries. On v0.6.0 or newer, run the `--migrate` workflow separately only when you intend consolidation. If the alias differs because its runtime path changed, back up the file and replace only `servers.shared-mcp-gateway` using the updated source connector. Restart or reload the server from VS Code's MCP controls. Do not overwrite `inputs`, sandbox rules, variables, approval settings, or unrelated servers.

<a id="claude-code"></a>
## Claude Code

**Support status:** High confidence for isolated native config parsing and adapter behavior; no live model or approved backend session was tested.

<a id="claude-code-install"></a>
### Install

First complete [Install the shared core](#shared-core-install). For user/local scope, register in `~/.claude.json`:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client claude `
  --config "$HOME\.claude.json" `
  --gateway-config "<copilot-mcp-config>"
```

Review, then repeat with `--apply`. For a shared project entry, select the project's `.mcp.json` instead. Registration writes the native `mcpServers` shape and preserves unrelated JSON fields. To import existing direct connections instead, use the opt-in [migration workflow](#cross-client-migration) with this same explicitly selected file; migration replaces only its MCP collection after safely extracting the supported subset.

Claude Code also documents native stdio registration as:

```text
claude mcp add --transport stdio <name> -- <command> [args...]
```

If you choose that path, use `shared-mcp-gateway` as the name and copy the exact command and argument array from the source connector; do not reconstruct paths. Verify with `claude mcp get shared-mcp-gateway` or `claude mcp list`.

This repository includes `.claude-plugin/plugin.json`, but it has only been schema-validated. No marketplace install command is documented here because this repository is not claiming publication in a Claude marketplace.

<a id="claude-code-upgrade"></a>
### Upgrade

Upgrade the shared core, then rerun registration preview for the same Claude configuration. This repoints only the gateway alias; existing direct entries remain unless, after adopting the v0.6 runtime, you separately opt in with `--migrate`. On a conflicting old path, back up the file and update only `mcpServers.shared-mcp-gateway`, or use Claude's documented MCP management commands to remove the selected entry and add it again with the exact new connector command. Preserve project approvals and all unrelated servers.

<a id="codex"></a>
## Codex

**Support status:** Medium confidence for adapter behavior. Native validation was blocked before argument parsing by managed Codex policy; no Codex session was exercised.

<a id="codex-install"></a>
### Install

First complete [Install the shared core](#shared-core-install). Generate the native registration plan:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client codex `
  --config "$HOME\.codex\config.toml" `
  --gateway-config "<copilot-mcp-config>"
```

The result contains an argument-safe `registrationCommand` equivalent to:

```text
codex mcp add shared-mcp-gateway -- <command> [args...]
```

Review and run the emitted command. In registration-only mode the helper does not parse or write `config.toml`, and `--apply` is intentionally rejected. To import supported existing Codex entries, add `--migrate` as described in [Migrate native client connections](#cross-client-migration); preview reports TOML reformatting and apply backs up the original bytes before writing. User configuration is `~/.codex/config.toml`; trusted projects may use `.codex/config.toml`. Verify with `codex mcp list`.

If the source connector contains a non-empty `env`, generation stops rather than exposing environment values on the command line.

<a id="codex-upgrade"></a>
### Upgrade

Upgrade the shared core and generate a new registration preview for the selected `config.toml`; registration remains a native CLI operation. Existing direct entries are not imported unless you separately run `--migrate`. Migration uses the TOML adapter, preserves non-MCP settings semantically, warns that comments and formatting are regenerated, and retains the byte-exact backup for restoration.

<a id="opencode"></a>
## OpenCode

**Support status:** Medium confidence. Native JSON transformation is tested; no live OpenCode session was exercised.

<a id="opencode-install"></a>
### Install

First complete [Install the shared core](#shared-core-install). Choose either the global `~/.config/opencode/opencode.json` or project `opencode.json` path:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client opencode `
  --config "$HOME\.config\opencode\opencode.json" `
  --gateway-config "<copilot-mcp-config>"
```

Review, then repeat with `--apply`. Registration writes the documented native shape under `mcp.shared-mcp-gateway` with `type: "local"` and a command array. Existing direct entries remain until you explicitly use the [migration workflow](#cross-client-migration). OpenCode JSONC is supported by OpenCode itself, but this adapter intentionally accepts strict JSON only; remove comments with a JSONC-aware editor before using it.

<a id="opencode-upgrade"></a>
### Upgrade

Upgrade the shared core and rerun registration preview against the same OpenCode config. This only repoints the gateway alias; direct entries remain unless the v0.6.0 `--migrate` workflow is separately selected. If the existing alias points to the old runtime, back up the file and update only `mcp.shared-mcp-gateway`. Preserve providers, models, permissions, organization defaults, environment references, and all other MCP entries.

<a id="qwen-code"></a>
## Qwen Code

**Support status:** Medium confidence. Official native paths and commands are documented, and the portable/native manifests are schema-tested; no model session was exercised.

<a id="qwen-code-install"></a>
### Install

First complete [Install the shared core](#shared-core-install). Register in user scope `~/.qwen/settings.json` or project scope `.qwen/settings.json`:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client qwen `
  --config "$HOME\.qwen\settings.json" `
  --gateway-config "<copilot-mcp-config>"
```

Review, then repeat with `--apply`. Registration writes the native `mcpServers` stdio entry. Existing direct entries remain until you explicitly use the [migration workflow](#cross-client-migration). Qwen also documents `qwen mcp add` for native registration; if using it, copy the exact command and arguments from the source connector rather than inventing paths. Restart Qwen Code after CLI-side configuration changes and inspect the server with `/mcp`.

The repository's `qwen-extension.json` and portable `plugin.json` package the setup skill, but they do not perform automatic client migration or replace connector registration.

<a id="qwen-code-upgrade"></a>
### Upgrade

Upgrade the shared core and rerun registration preview for the same `settings.json`. This only repoints the gateway alias; direct entries remain unless the v0.6.0 `--migrate` workflow is separately selected. On conflict, back up the file and replace only `mcpServers.shared-mcp-gateway`. Preserve Qwen trust, OAuth, timeout, tool filtering, and unrelated extension settings.

<a id="kimi-cli"></a>
## Kimi Code CLI

**Support status:** Medium confidence for the schema adapter only. Installed Kimi 0.38.0 has no working `mcp` command, and its help does not confirm a default MCP configuration path; current upstream documentation describes a newer surface that may not match the installed build.

<a id="kimi-cli-install"></a>
### Install

First complete [Install the shared core](#shared-core-install). Select the exact strict-JSON file that your Kimi version uses and pass it explicitly; do not guess `~/.kimi/mcp.json` or any other personal path:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client kimi `
  --config "<selected-kimi-mcp-json>" `
  --gateway-config "<copilot-mcp-config>"
```

Review, then repeat with `--apply`. Registration writes `mcpServers.shared-mcp-gateway`; existing direct entries remain unless the v0.6.0 `--migrate` workflow is explicitly selected. Migration supports the current upstream strict-JSON `mcpServers` subset, but this has not been validated end to end with installed Kimi 0.38.0. Referenced native variables, relative command/script paths without an absolute `cwd`, OAuth, migrated-alias trust, runtime IDs, discovery timeouts, and other unrepresentable client-managed semantics fail closed.

<a id="kimi-cli-upgrade"></a>
### Upgrade

Upgrade the shared core and rerun preview against the same explicitly selected file. Registration repoints only the gateway alias; it does not import other entries. After adopting the v0.6 runtime, use `--migrate` only after confirming that the file uses the supported upstream schema, and preserve the returned two-file backups and manifest. Do not infer a new default path from upstream source documentation.

<a id="antigravity-cli"></a>
## Antigravity CLI

**Support status:** Medium confidence for the documented CLI config and tested JSON adapter; no live Antigravity CLI or IDE session was exercised.

<a id="antigravity-cli-install"></a>
### Install

First complete [Install the shared core](#shared-core-install). For Antigravity CLI, choose the global `~/.gemini/config/mcp_config.json` or workspace `.agents/mcp_config.json` path:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client antigravity `
  --config "$HOME\.gemini\config\mcp_config.json" `
  --gateway-config "<copilot-mcp-config>"
```

Review, then repeat with `--apply`. Registration writes `mcpServers.shared-mcp-gateway`; existing direct entries remain until you explicitly use the [migration workflow](#cross-client-migration). Open `/mcp` in Antigravity CLI to inspect status or reload configuration.

Antigravity IDE is distinct from the CLI. In the IDE, use **MCP Servers** > **Manage MCP Servers** > **View raw config** and update the selected `mcp_config.json`; do not assume this repository is an IDE extension or MCP Store package.

<a id="antigravity-cli-upgrade"></a>
### Upgrade

Upgrade the shared core and rerun registration preview against the exact CLI or workspace file previously selected. This only repoints the gateway alias; direct entries remain unless the v0.6.0 `--migrate` workflow is separately selected. On conflict, back up that file and update only `mcpServers.shared-mcp-gateway`. For the IDE, reload the server through its MCP management UI after changing raw configuration. Preserve Google authentication, OAuth, permissions, disabled tools, and unrelated servers.

<a id="preferred-integration"></a>
## Preferred integration

Keep one gateway implementation and add only small, explicit client-config adapters where needed:

- Prefer one stdio connector entry per client. It reads the private token locally and can auto-start or reuse the gateway.
- Direct Streamable HTTP is an advanced alternative when the client can safely supply authentication and the gateway is already running.
- Preserve native variables, input prompts, trust settings, approval settings, and unrelated servers. Never blindly convert complete configuration objects between products.
- Leave shell aliases and personal agents to the user's existing environment.
- Verify a new client with two connections, one harmless backend call, shared process reuse, disconnect behavior, and rollback before marking it fully supported.

<a id="configuration-adapter-layer"></a>
## Configuration adapter layer

Client-specific formats are isolated from the gateway core:

```text
Native client document
  -> format adapter (parse / preserve / register / extract)
  -> validated gateway backend model
  -> shared backend registry
```

The adapters reject unsupported client-managed authentication or variable syntax instead of silently stripping it. JSON adapters preserve unrelated settings; the core does not need to understand client-specific field names.

Use `claude`, `vscode`, `opencode`, `qwen`, `kimi`, or `antigravity` as strict-JSON selectors and `codex` for TOML. Registration and the v0.6.0 `--migrate` workflow are distinct: registration adds or verifies only the gateway connector, while migration extracts the supported direct entries, merges them into the validated private catalog, and replaces the selected native MCP collection with the connector. Both preview by default; only explicit `--apply` writes.

Codex registration emits native `codex mcp add` arguments. Codex migration uses the TOML parser and warns about regenerated comments and formatting. Adapter tests are not proof that every client/version has been exercised in a native session.

<a id="official-references"></a>
## Official references

- [GitHub Copilot CLI plugin installation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing)
- [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) and [MCP customization](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp) and [plugin reference](https://code.claude.com/docs/en/plugins-reference)
- [Codex MCP](https://developers.openai.com/codex/mcp) and [plugins](https://developers.openai.com/codex/plugins)
- [OpenCode configuration](https://opencode.ai/docs/config/) and [MCP servers](https://opencode.ai/docs/mcp-servers/)
- [Qwen Code MCP](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/mcp.md) and [extensions](https://github.com/QwenLM/qwen-code/blob/main/docs/users/extension/introduction.md)
- [Kimi Code CLI MCP](https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/customization/mcp.md)
- [Antigravity MCP documentation, CLI and IDE](https://antigravity.google/docs/mcp?tab=cli)
