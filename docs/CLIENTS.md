# Client integration: keep the core small

<a id="table-of-contents"></a>
## Table of contents

- [Compatibility summary](#compatibility-summary)
- [Shared gateway prerequisite](#shared-gateway-prerequisite)
  - [Install the shared core](#shared-core-install)
  - [Upgrade the shared core](#shared-core-upgrade)
  - [Register or repoint one client](#register-or-repoint-one-client)
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

Checked against official documentation on 2026-09-24. **Only the Copilot CLI installation workflow and isolated local plugin discovery have been exercised by this project.** Other rows describe documented configuration surfaces plus repository adapter tests, not completed live agent sessions.

| Client | Native MCP configuration | Packaging/runtime status |
|---|---|---|
| Copilot CLI | `$COPILOT_HOME/mcp-config.json` or `~/.copilot/mcp-config.json`; `mcpServers` | Marketplace install is the standard path. Local checkout install worked in an isolated test but is deprecated by the current CLI. |
| VS Code | Workspace `.vscode/mcp.json` or user-profile `mcp.json`; `servers` | VS Code is an editor, not a CLI. Registration adapter tested; editor session not exercised. |
| Claude Code | User/local `~/.claude.json` or project `.mcp.json`; `mcpServers` | Claude manifest passes strict schema validation. No live Claude plugin or MCP session was exercised. |
| Codex | User `~/.codex/config.toml` or trusted-project `.codex/config.toml`; `mcp_servers` | Adapter emits a native `codex mcp add` command only; it never writes TOML. |
| OpenCode | Global `~/.config/opencode/opencode.json` or project `opencode.json`; `mcp` | Native JSON registration adapter tested; no live OpenCode session exercised. |
| Qwen Code | User `~/.qwen/settings.json` or project `.qwen/settings.json`; `mcpServers` | Native/portable manifests are schema-tested; no live Qwen model session was exercised. |
| Kimi Code CLI | `~/.kimi/mcp.json`; `mcpServers` | Native JSON registration adapter tested; no live Kimi session exercised. |
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

Then start Copilot CLI and invoke `/mcp-gateway-setup`. Review its preview before approving changes. The setup skill installs the runtime outside the plugin cache, backs up the selected Copilot MCP configuration, and writes the `shared-mcp-gateway` connector used as the source for other clients.

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

After the plugin update, invoke `/mcp-gateway-setup` and explicitly request adoption of the updated runtime. Review the reported backup, readiness, and rollback commands. Existing client entries continue to point to the old stable connector until they are deliberately repointed.

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

Codex is different: preview emits a native command and `--apply` is rejected. The preview also rejects a source connector with a non-empty `env`, because emitting those values on a command line could expose them.

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

Run `/mcp-gateway-setup` inside Copilot CLI. The normal user configuration is `$COPILOT_HOME/mcp-config.json` when `COPILOT_HOME` is set, otherwise `~/.copilot/mcp-config.json`.

A local checkout install was verified with `copilot plugin install "<checkout>"` in an isolated `COPILOT_HOME`, but the current CLI warns that direct local/repository installs are deprecated. Do not use that as the published upgrade path.

<a id="copilot-cli-upgrade"></a>
### Upgrade

Run the commands in [Upgrade the shared core](#shared-core-upgrade), then invoke `/mcp-gateway-setup` to preview and adopt the updated runtime. `copilot plugin update` updates the cached plugin; it does not silently switch the stable runtime or migrate newly conflicting entries.

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

Review, then repeat with `--apply`. The adapter writes VS Code's native `servers` entry with `type: "stdio"`. For user-wide registration, open VS Code's **MCP: Open User Configuration** command and pass that selected profile's `mcp.json` path explicitly instead of guessing a profile location. Use **MCP: List Servers** to inspect the registered server.

Do not confuse `.vscode/mcp.json` with portable `.mcp.json`: both are documented, but they use different top-level collection names.

<a id="vs-code-upgrade"></a>
### Upgrade

Upgrade the shared core first, then rerun the VS Code preview against the same selected `mcp.json`. If the alias differs because its runtime path changed, back up the file and replace only `servers.shared-mcp-gateway` using the updated source connector. Restart or reload the server from VS Code's MCP controls. Do not overwrite `inputs`, sandbox rules, variables, approval settings, or unrelated servers.

<a id="claude-code"></a>
## Claude Code

**Support status:** Medium confidence. Official MCP commands and paths are documented, and the Claude plugin manifest passes strict validation; no live Claude session was tested.

<a id="claude-code-install"></a>
### Install

First complete [Install the shared core](#shared-core-install). For user/local scope, register in `~/.claude.json`:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client claude `
  --config "$HOME\.claude.json" `
  --gateway-config "<copilot-mcp-config>"
```

Review, then repeat with `--apply`. For a shared project entry, select the project's `.mcp.json` instead. The adapter writes the native `mcpServers` shape and preserves unrelated JSON fields.

Claude Code also documents native stdio registration as:

```text
claude mcp add --transport stdio <name> -- <command> [args...]
```

If you choose that path, use `shared-mcp-gateway` as the name and copy the exact command and argument array from the source connector; do not reconstruct paths. Verify with `claude mcp get shared-mcp-gateway` or `claude mcp list`.

This repository includes `.claude-plugin/plugin.json`, but it has only been schema-validated. No marketplace install command is documented here because this repository is not claiming publication in a Claude marketplace.

<a id="claude-code-upgrade"></a>
### Upgrade

Upgrade the shared core, then rerun preview for the same Claude configuration. On a conflicting old path, back up the file and update only `mcpServers.shared-mcp-gateway`, or use Claude's documented MCP management commands to remove the selected entry and add it again with the exact new connector command. Preserve project approvals and all unrelated servers.

<a id="codex"></a>
## Codex

**Support status:** Medium confidence for command generation; no Codex session was exercised. Codex CLI, the Codex IDE extension, and the desktop host share the same MCP configuration.

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

Review and run the emitted command. The helper does not parse or write `config.toml`, and `--apply` is intentionally rejected. User configuration is `~/.codex/config.toml`; trusted projects may use `.codex/config.toml`. Verify with `codex mcp list`.

If the source connector contains a non-empty `env`, generation stops rather than exposing environment values on the command line.

<a id="codex-upgrade"></a>
### Upgrade

Upgrade the shared core, back up the selected `config.toml`, and generate a new preview. Use `codex mcp --help` from the installed version to choose its supported management operation, or update only the `[mcp_servers.shared-mcp-gateway]` table manually from the emitted command. Do not feed TOML through the JSON adapter and do not rewrite unrelated Codex settings.

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

Review, then repeat with `--apply`. The adapter writes the documented native shape under `mcp.shared-mcp-gateway` with `type: "local"` and a command array. OpenCode JSONC is supported by OpenCode itself, but this adapter intentionally accepts strict JSON only; remove comments with a JSONC-aware editor before using it.

<a id="opencode-upgrade"></a>
### Upgrade

Upgrade the shared core and rerun preview against the same OpenCode config. If the existing alias points to the old runtime, back up the file and update only `mcp.shared-mcp-gateway`. Preserve providers, models, permissions, organization defaults, environment references, and all other MCP entries.

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

Review, then repeat with `--apply`. The adapter writes the native `mcpServers` stdio entry. Qwen also documents `qwen mcp add` for native registration; if using it, copy the exact command and arguments from the source connector rather than inventing paths. Restart Qwen Code after CLI-side configuration changes and inspect the server with `/mcp`.

The repository's `qwen-extension.json` and portable `plugin.json` package the setup skill, but they do not perform automatic client migration or replace connector registration.

<a id="qwen-code-upgrade"></a>
### Upgrade

Upgrade the shared core and rerun preview for the same `settings.json`. On conflict, back up the file and replace only `mcpServers.shared-mcp-gateway`. Preserve Qwen trust, OAuth, timeout, tool filtering, and unrelated extension settings.

<a id="kimi-cli"></a>
## Kimi Code CLI

**Support status:** Medium confidence. Native JSON transformation and documented commands are available; no live Kimi session was exercised.

<a id="kimi-cli-install"></a>
### Install

First complete [Install the shared core](#shared-core-install). Register in Kimi's documented `~/.kimi/mcp.json`:

```powershell
node "<plugin-root>\tools\connect-client.mjs" `
  --client kimi `
  --config "$HOME\.kimi\mcp.json" `
  --gateway-config "<copilot-mcp-config>"
```

Review, then repeat with `--apply`. The adapter writes `mcpServers.shared-mcp-gateway`. Kimi's equivalent native command form is:

```text
kimi mcp add --transport stdio shared-mcp-gateway -- <command> [args...]
```

Use the exact command and arguments from the source connector. Verify with `kimi mcp list` or `kimi mcp test shared-mcp-gateway`.

<a id="kimi-cli-upgrade"></a>
### Upgrade

Upgrade the shared core and rerun preview. If the alias contains the previous runtime path, back up `~/.kimi/mcp.json` and replace only that alias, or use Kimi's documented `kimi mcp remove shared-mcp-gateway` followed by a native add using the updated connector. Preserve OAuth data and unrelated servers.

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

Review, then repeat with `--apply`. The adapter writes `mcpServers.shared-mcp-gateway`. Open `/mcp` in Antigravity CLI to inspect status or reload configuration.

Antigravity IDE is distinct from the CLI. In the IDE, use **MCP Servers** > **Manage MCP Servers** > **View raw config** and update the selected `mcp_config.json`; do not assume this repository is an IDE extension or MCP Store package.

<a id="antigravity-cli-upgrade"></a>
### Upgrade

Upgrade the shared core and rerun preview against the exact CLI or workspace file previously selected. On conflict, back up that file and update only `mcpServers.shared-mcp-gateway`. For the IDE, reload the server through its MCP management UI after changing raw configuration. Preserve Google authentication, OAuth, permissions, disabled tools, and unrelated servers.

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

Use `claude`, `vscode`, `opencode`, `qwen`, `kimi`, or `antigravity` as the JSON client selector. Preview is read-only; apply creates a private backup before replacing the selected configuration. Registration adds the gateway entry but **does not remove or migrate that client's other servers**, redeploy the runtime, or alter approval settings. Resolve name conflicts explicitly.

Codex registration emits a native `codex mcp add` argument plan rather than rewriting TOML with a custom parser. Review its current configuration and back it up before running the native command.

The setup migration continues to target supported Copilot-style JSON. Configuration-adapter tests are not proof that every client/version has been exercised in a real session.

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
