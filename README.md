# MCPGateway — Share local MCP servers across agents

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](README.md) · [简体中文](docs/i18n/README.zh-CN.md) · [繁體中文](docs/i18n/README.zh-TW.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md) · [Español](docs/i18n/README.es.md) · [Français](docs/i18n/README.fr.md) · [Deutsch](docs/i18n/README.de.md) · [Português (Brasil)](docs/i18n/README.pt-BR.md) · [Italiano](docs/i18n/README.it.md) · [Русский](docs/i18n/README.ru.md) · [العربية](docs/i18n/README.ar.md) · [हिन्दी](docs/i18n/README.hi.md) · [Bahasa Indonesia](docs/i18n/README.id.md) · [Türkçe](docs/i18n/README.tr.md) · [Tiếng Việt](docs/i18n/README.vi.md)

</details>

Running several coding sessions? Share one set of MCP backends to avoid duplicate memory and startup work. Keep your existing agent-to-gateway connection across a settled configuration-only restart on the tested SDK/stdio route.

[Start with Copilot CLI](#first-use) · [Client compatibility](docs/CLIENTS.md#compatibility-summary) · [Evidence and limits](#resource-examples) · [Copilot updates](docs/CLIENTS.md#copilot-cli-upgrade)

<img src="assets/mcp-gateway-benefits.png" alt="Backend copies become one shared set; repeated starts become shared starts; an existing MCP connection survives a settled owned-gateway restart in the SDK/stdio experiment" width="780">

[Concept artwork](assets/mcp-gateway-benefits.svg), not a screenshot or benchmark. English labels; three payoffs:

- **Avoid duplicate backend memory:** assumed 5 × 1.5 GB sets share one; 6 GB duplication avoided **before** gateway/connector overhead, not measured net savings.
- **Reuse backend startup work:** if all five sessions use twelve stdio services, 60 → 12 backend starts—not 80% faster elapsed startup.
- **Keep the existing agent-to-gateway MCP connection:** the connection survived a settled owned-gateway restart after configuration-only additions in the SDK/stdio experiment. Not hot reload, active-call continuity or universal native conversation UI proof; initial registration/runtime upgrades may require client restart. [Scope](docs/BENCHMARK.md#configuration-only-connection-continuity)

<a id="benefits"></a>
<a id="reuse-backends-discover-tools-on-demand"></a>
<a id="resource-examples"></a>
**Fit / skip:** useful when sessions share the same connector/catalog and expensive backends. Direct MCP may be simpler for one session or lightweight backends. Our lightweight fixture had higher summed process working set (357.0 → 564.0 MiB) and slower fully cold first shared request (gateway launch through first useful result) (1886.7 versus 503.5 ms direct). Net gains depend on overhead; [measure your workload](docs/BENCHMARK.md).

<a id="first-use"></a>
## First useful workflow: an authorized read through the shared gateway

Requires Node.js 24+, npm, Git, Copilot CLI with plugin support, and existing MCP integrations with their required authentication. Bootstrap starts through Copilot CLI; Windows is the primary tested platform. Other-client compatibility and verification levels differ. [Copilot `/help` · `/plugin`](docs/CLIENTS.md#copilot-plugin-eligibility).

**Before installing:** configuration and backups may contain credentials; keep them private. Backend calls may contact remote services. This installs a persistent runtime: client rollback/plugin removal does not stop the daemon. Review [exit and retained private state](docs/REFERENCE.md#planned-exit). Local private state and saved gateway tokens are owner-only, not additionally encrypted.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Start Copilot CLI and invoke `/mcp-gateway-setup`. Review the preview and approve only intended changes. Keep the returned private backup and rollback commands; plugin installation alone does not merge configurations.
2. Close and reopen Copilot, then run the exact returned `readinessCommand` using the [command-object invocation](docs/REFERENCE.md#readiness-command-object). A check-only command does not start an absent gateway. Save only the returned JSON object; `.command` is the approved executable and `.args` its exact ordered arguments.
3. Choose a harmless read on an integration you already use. Replace only the bracketed task in this request; aliases, tools and arguments must come from discovery/schema, not guessed defaults:

> Use the shared gateway for [my authorized read-only task]. Use `list_servers`, then focused `search_tools` and `get_tool_schema`; prepare schema-valid arguments with authorized non-sensitive test values. Obtain normal approvals. If `requiresExclusiveAccess: true`, `claim_server` once before `call_tool` and `release_server` after all calls settle; non-exclusive backends need no claim. Show the actual record or documented empty result and check errors—not just a gateway response. Never retry an unknown outcome: keep it blocked and use the private operator handoff.

4. In a second session using the same connector/catalog, list/search the same alias: expect `ready` and the same catalog capabilities. This checks shared discovery, not PID identity or RAM savings. [Exact tool inputs and result checks](docs/REFERENCE.md#first-shared-workflow), with an [illustrative public echo/result pair](docs/REFERENCE.md#public-echo-illustration), not real-integration proof.

**If it fails:** check the selected catalog/preview when empty; use backend-description terms when search has no match. For [authentication](docs/REFERENCE.md#native-http-oauth) or [readiness/rollback](docs/REFERENCE.md#setup-recovery), follow the canonical guide—no parallel bypass process. An [unknown exclusive result](docs/REFERENCE.md#unknown-exclusive-result) requires reconciliation and an owned restart; release/disconnect is not cancellation or safe unblocking. Reclaim ownership after restart.

<a id="contents"></a>
<a id="how-it-works"></a>
<a id="install-and-upgrade-by-client"></a>
<a id="safety-and-operations"></a>
<a id="development"></a>
## Choose the next detail

- [Backend sharing, six-tool discovery and evidence](docs/BENCHMARK.md#sharing-model-and-evidence): illustrations, adverse measurements and verification limits.
- [Other clients, optional migration and upgrades](docs/CLIENTS.md): registration is not catalog merging; native verification varies. Gemini CLI has no documented route here; Antigravity is separate.
- [Stop using the gateway](docs/REFERENCE.md#planned-exit): finish workflows; restore/remove affected connectors before owned shutdown. Preserve private state/history and unrelated processes. Configuration rollback is not runtime shutdown.
- [Operational reference](docs/REFERENCE.md), [alternatives](docs/ALTERNATIVES.md), [contributing and development](CONTRIBUTING.md), [changelog](CHANGELOG.md), [security reporting](SECURITY.md).

MIT — [LICENSE](LICENSE).
