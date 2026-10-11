# Controlled lightweight backend reuse measurement

Measured 2026-10-10, Windows x64 10.0.26340, Node v24.13.1, AMD Ryzen AI 9 HX 370. Three local trials; medians rounded below. This is an existing public echo fixture, not real-service or private-integration data. It demonstrates backend reuse, **not unconditional RAM savings or faster cold startup**. The README's assumed 1.5 GB / 12-connection scenario is separate, not this fixture.

| Measure | Median / count |
|---|---|
| Shared backend schema + echo: cold / second / fifth client | 426.2 / 21.1 / 19.0 ms |
| First direct client, launch to useful echo | 503.5 ms |
| First shared client, gateway already listening | 894.3 ms |
| Fully cold shared: gateway launch through first useful echo | 1886.7 ms |
| Second / fifth shared client totals, including fresh connector startup | 586.4 / 573.6 ms |
| Gateway launch to listening-ready | 992.4 ms |
| Backend process count: direct / shared | 5 / 1 |
| Complete measured process count: direct / shared | 5 / 7 |
| Summed process working set: direct / shared | 357.0 / 564.0 MiB |

**Adverse result:** summed process working set is higher; unique physical memory was not measured; fully cold shared startup is slower. Fast reused schema + echo is a different measurement from fresh-client end-to-end startup and cannot support a “50× faster startup” claim. Schema caching also contributes. Backend-only 5→1 is not an 80% reduction in total process count, memory or time.

## Method

**Documented observed procedure, not a ready-to-run benchmark command.** The inline orchestration runner was not retained as a public executable. Source revision for the timing run was not recorded; do not infer it from a later documentation HEAD. Fixture/connector source links describe the mechanism, not a complete measurement harness.

Five direct SDK stdio clients each launched [the public lifecycle echo fixture](../test/fixtures/lifecycle-backend.mjs), which reports its PID and returns harmless text. Comparison launched an isolated actual gateway/BackendRegistry child on loopback port 0 and five actual [stdio connector](../tools/connector.mjs) children; fixture-only in-memory configuration, no user's catalog, credentials or live integration. Each client's schema lookup and echo were verified; all shared clients returned the same backend PID in each trial. Clients remained connected through the memory snapshot. All owned children were closed after each trial.

Direct timing begins before stdio launch and ends after listTools and verified echo. Shared timing includes fresh connector launch/HTTP connection/initialization, then get_tool_schema and call_tool; its client total excludes separately measured gateway launch. Fully cold time is the **median of each trial's paired gateway-ready + first-client total**, not an inferred speedup. Cold means new processes/backend, not flushed OS disk cache. Runner module imports are excluded.

Windows `Get-Process WorkingSet64` was sampled after five initialized clients each completed schema + echo. Direct sum includes five backends; shared sum includes one gateway, five connectors and one backend. The common SDK runner and transient sampler are excluded. Working-set sums include resident shared pages and may double-count DLL/code pages; they are not unique/private bytes, commit or peak memory. Native HTTP clients may incur different overhead but were not measured.

No allocation padding, injected delay, network service or extra workload. Direct-before-shared order fixed, clients sequential, three warm-OS-cache trials, no confidence intervals or simultaneous load. No tokens, throughput or real-service startup/memory measured. Heavier backends might amortize overhead, but require their own authorized measurement; this fixture does not predict them. Raw summary (bytes before rounding): direct 374341632; shared 591355904; cold schema+echo 426.1649 ms; second 21.0911 ms; fifth 19.0265 ms; direct first 503.5459 ms; shared first 894.3126 ms; paired fully cold 1886.7027 ms.

The separate [catalog-scale test](../test/catalog-scale.test.js) validates six gateway definitions around a synthetic 1000-tool catalog and shared discovery caching across two clients; it is not this process-memory measurement or an RSS performance benchmark.

### Three retained trial observations

| Trial | First direct ms | First shared ms (gateway ready) | Gateway ready ms | Paired fully cold shared ms | Direct / shared summed working set MiB |
|---|---|---|---|---|---|
| 1 | 503.5 | 894.3 | 992.4 | 1886.7 | 357.0 / 568.7 |
| 2 | 582.8 | 1098.2 | 1088.4 | 2186.5 | 357.1 / 562.1 |
| 3 | 358.6 | 841.1 | 895.9 | 1736.9 | 356.9 / 564.0 |

## Configuration-only connection continuity

A separate bounded public-fixture check on Node24.13.1 / Windows passed: one existing SDK Client, StdioClientTransport and live current connector PID, with **one connect/initialize**, survived a graceful owned-gateway restart on the same loopback port/state/token. An isolated catalog was edited to add an alias while the daemon was down; the replacement gateway loaded it. The same retained agent-side connection discovered the new alias, retrieved its schema and invoked verified echo. Connector stderr reported internal HTTP session recovery with no replay of tool/ownership operations. All owned fixture processes closed successfully; no private backend/configuration was used.

This verifies the connector mechanism, not branded-agent conversation UI retention or setup's synchronization transaction. Actual setup route: preview and approve additions with `/mcp-gateway-setup`, preserve backups, finish workflows, ask setup to restart **only the owned gateway**. Same-name conflicts require review; no automatic overwrite or backend hot reload. The test retains stable connector runtime, endpoint, state and token. Initial registration and runtime/connector upgrades retain client-specific restart/reload instructions. Interrupted calls are not replayed; unknown outcomes require review. Restart replaces HTTP sessions and leases, so exclusive ownership must be reclaimed before execution. In-flight calls, conflicting alias resolution, changed tokens/ports and all branded clients were not tested.


<a id="sharing-model-and-evidence"></a>
## Sharing model and evidence

Use comparable direct/shared measurements for the same workload: duplicated backend cost must exceed added sharing overhead. `(sessions - 1) × backend-set cost > added sharing overhead` is an illustrative decision rule in the same metric, not a measured universal break-even threshold. Measure first-use latency and summed process working set separately; warm catalog reuse does not guarantee faster cold startup.

**Avoid duplicate backend RAM**

Illustrative assumption, not a benchmark: 5 agent sessions each need the same 12 connections; one complete backend set uses 1.5 GB. Compatible sessions share actual backend processes through the same connector/catalog.

| Deployment | Backend RAM |
|---|---|
| Independent copies | 5 × 1.5 GB = 7.5 GB |
| Shared backend set | 1.5 GB + gateway & connector overhead |

Duplicated backend RAM avoided before overhead: 7.5 GB - 1.5 GB = 6 GB. Total savings are unknown until measured. The 1.5 GB assumption is not constant across workloads or clients; this is backend RAM, not RAM for five models.

**Reuse startup work too.** Assuming 12 stdio-backed services, all used by each of 5 sessions, independent copies require up to `5 × 12 = 60` backend starts versus `12` shared: `60 - 12 = 48` duplicate starts avoided, `48 / 60 × 100 = 80%` fewer starts. With lazy connection, only `k` used backends connect out of 12 configured; unused backends do not start. This is a work-count calculation, not 80% faster elapsed startup. This startup-count illustration does not measure latency; concurrency, service authentication and platform affect wall time.

For a 1000-tool catalog: 1000 → 6 initial gateway definitions, (1000 - 6) / 1000 × 100 = 99.4% fewer definitions, not 99.4% fewer tokens. Selected schemas cost more when requested; clients already deferring definitions may gain less. The synthetic catalog test verifies six tools and a shared discovery cache across two clients, not RSS performance. [catalog-scale.test.js](../test/catalog-scale.test.js)

**Measured lightweight fixture: summed process working set increased; cold first use was slower.** Three Windows x64 / Node 24.13.1 trials; medians:

| Comparison | Result |
|---|---|
| Shared schema + echo: cold backend / second / fifth client | 426.2 ms / 21.1 ms / 19.0 ms |
| First useful echo: direct / shared with gateway listening / fully cold shared | 503.5 ms / 894.3 ms / 1886.7 ms |
| Backend processes / total processes, direct → shared | 5 → 1 / 5 → 7 |
| Summed process working set, direct → shared | 357.0 MiB → 564.0 MiB — **summed process working set was higher; unique physical memory and private bytes were not measured** |

Fully cold shared startup was slower. This one-tool echo fixture is not representative of heavier field services. The 1.5 GB scenario above is a separate assumption, not this measurement. [Full method and comparators](BENCHMARK.md)

Resource use depends on backends, clients, and workload. No measured RAM or token savings are promised; sharing neither enlarges the model's context window nor makes memory usage constant. Clients that already defer tool loading may see less context benefit.

MCPGateway shares configured backends across sessions: clients use a connector and the same catalog; selected servers connect on demand. It is a local shared MCP gateway, not an enterprise API-governance service.

```text
Agent A ─┐                         ┌─ Integration A: many tools
Agent B ─┼─ connector ─ gateway ──┼─ Integration B: many tools
Agent C ─┘                         └─ Integration C: many tools
```

The diagram illustrates shared routing to selected configured backends, not a benchmark or runtime proof; unused backends are not started.

The six gateway tools comprise four discovery/execution tools—`list_servers`, `search_tools`, `get_tool_schema`, and `call_tool`—plus `claim_server` and `release_server` for integrations that require exclusive workflow ownership.

A request follows **discover → retrieve schema → call**. Discovery does not start every integration. If shared state requires exclusive ownership, the agent claims that integration before its calls and releases it after the workflow.

Change backend configuration without restarting your agent on the current connector route: synchronize additions, settle active workflows, then restart only the owned gateway; current connectors reconnect. This is not automatic hot reload: the running gateway loads its catalog at startup. For later Copilot MCP additions, rerun `/mcp-gateway-setup`, review preview and approve only intended synchronization; preserve backups. Ask the setup skill to perform the owned restart in [configuration synchronization](CLIENTS.md#copilot-cli-upgrade).

The same live connector PID, SDK client and stdio transport survived a settled owned-gateway restart with one initialization, discovered a newly added alias and called its public echo fixture. This verifies agent-side MCP connection continuity, not independently tested branded-agent conversation UIs. Configuration-only sync need not replace the fixed six-tool agent connector; the existing connector can reconnect, but interrupted calls are not silently replayed and unknown outcomes require review. Gateway restart loses leases: reclaim exclusive ownership before new execution. This is not a universal “no agent restart” guarantee: initial registration and runtime/connector upgrades retain their client-specific restart/reload instructions. Changed existing aliases can conflict and require review, not automatic replacement. [Method and scope](BENCHMARK.md#configuration-only-connection-continuity).

## Verified scope

- **1,000-tool synthetic catalog, 2 clients:** a focused search returns one matching summary, and the second client reuses the cached catalog. [Test](../test/catalog-scale.test.js)
- **237 local checks passed for v0.6.0**, [historically reported by the maintainer in the versioned release notes](https://github.com/yeelam-gordon/MCPGateway/releases/tag/v0.6.0): core sharing, recurring synchronization, cross-client migration, client/documentation behavior, installation, upgrade, rollback, cancellation, and recovery. This historical execution claim has not been independently reproduced here; it is not a result for the current checkout.
- **10 existing connections + 2 new = 12 shared:** migration across seven native formats, with two SDK clients reusing the same imported local process. Claude Code also parsed the actual migrated configuration without starting a model or MCP connection.
- **Windows and Ubuntu CI on Node.js 24**, plus CodeQL analysis.
- **Copilot marketplace installation and setup-skill discovery** verified in an isolated home for v0.5.0.

These checks demonstrate the mechanism, not unlimited capacity. Authentication, network latency, active workloads, and client initialization still affect startup time and resource use.
