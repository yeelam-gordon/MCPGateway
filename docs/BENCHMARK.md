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
