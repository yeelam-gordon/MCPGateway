# Focused alternatives for shared MCP fan-out

Evidence checked **2026-09-24** at the pinned revisions below. The question is narrow: several local agent CLI instances each configure one gateway, which fans out to existing stdio or HTTP MCP backends.

Three properties must be evaluated separately:

1. **One client entry:** each CLI can point to one gateway endpoint instead of configuring every backend.
2. **Shared backend protocol resources:** different CLI clients actually reuse backend MCP connections or stdio processes. One endpoint alone does not prove this.
3. **Small advertised schema surface:** the gateway exposes a compact meta-tool API rather than advertising every backend tool to each CLI.

This project combines all three: each upstream client receives six gateway tools, while the process-wide registry keeps one initialized SDK client/transport per backend alias and reuses it across upstream sessions ([gateway-server.js](../src/gateway-server.js#L63-L72), [backend-registry.js](../src/backend-registry.js#L79-L115)). Exclusive workflow leases coordinate clients; they are not separate backend connections.

| Alternative | One gateway entry per CLI | Backend connection/process reuse across CLI clients | Advertised tool surface |
|---|---|---|---|
| **MetaMCP** | Gateway-style fan-out. | **Closest verified pooling match.** Its singleton pool can assign an existing active backend client to another upstream session when the per-server cap is reached, and session cleanup recycles healthy clients into an idle pool ([pool](https://github.com/metatool-ai/metatool-app/blob/ff4ff2de9d25453c52dcc7be32680b30700a6012/apps/backend/src/lib/metamcp/mcp-server-pool.ts#L215-L224), [recycling](https://github.com/metatool-ai/metatool-app/blob/ff4ff2de9d25453c52dcc7be32680b30700a6012/apps/backend/src/lib/metamcp/mcp-server-pool.ts#L500-L521)). For stdio, each pooled client owns a process-managed transport ([client](https://github.com/metatool-ai/metatool-app/blob/ff4ff2de9d25453c52dcc7be32680b30700a6012/apps/backend/src/lib/metamcp/client.ts#L47-L64)). Header-forwarding configurations bypass idle-pool reuse, so sharing is configuration-dependent. | Not verified here as a fixed, small meta-tool surface equivalent to this project's six tools. |
| **Docker MCP Gateway** | Provides normal gateway aggregation behind one client-facing gateway. | **Not verified as cross-client protocol reuse.** Its cache key contains both backend server name and the upstream `ServerSession`; acquisition reuses only an entry with that same key ([key](https://github.com/docker/mcp-gateway/blob/a34df45d4ec0e941a9853ad768c4f6cd818966b3/pkg/gateway/clientpool.go#L22-L25), [acquire](https://github.com/docker/mcp-gateway/blob/a34df45d4ec0e941a9853ad768c4f6cd818966b3/pkg/gateway/clientpool.go#L90-L110)). Multiple clients using one gateway endpoint therefore does not by itself show that they share one backend MCP connection or stdio process. | Standard aggregated backend tools; no compact meta-tool layer was verified in the selected source. |
| **ToolHive local vMCP** | Local `thv vmcp serve` aggregates a group behind one endpoint and does not require Kubernetes ([architecture](https://github.com/stacklok/toolhive/blob/2b299c1f48ad3b64aadceb5bf89582ff686f590a/docs/arch/vmcp-local.md#L1-L20)). | **Backend connections are session-scoped in the inspected path.** Creating an upstream session builds a `MultiSession` that opens real HTTP connections to each backend ([session manager](https://github.com/stacklok/toolhive/blob/2b299c1f48ad3b64aadceb5bf89582ff686f590a/pkg/vmcp/server/sessionmanager/session_manager.go#L291-L300)). ToolHive may manage and reuse backend workloads separately, but that is not the same as reusing one protocol connection across CLI clients. | **Closest compact-surface option.** Its optional optimizer exposes only `find_tool` and `call_tool`; without it, all backend tools are passed through ([optimizer tiers](https://github.com/stacklok/toolhive/blob/2b299c1f48ad3b64aadceb5bf89582ff686f590a/docs/arch/vmcp-local.md#L95-L106)). |

## Bottom line

- **MetaMCP is the closest alternative for actual backend connection/process pooling**, with configuration caveats.
- **ToolHive local vMCP is the closest alternative for an optional compact meta-tool surface.**
- **Docker MCP Gateway is an aggregation alternative, but the inspected pool is keyed by upstream session and does not establish cross-client backend protocol reuse.**
- None of the inspected alternatives is directly equivalent to this project's verified combination of a fixed six-tool surface, a shared per-alias SDK client, and generic exclusive-server leases.

## Evidence limits

This is source and documentation inspection, not a benchmark or a promise of complete feature parity. It does not verify current binaries in a live multi-client run, performance, every transport/configuration, or behavior outside the pinned revisions. Confidence is **high** for the cited code paths and **limited** for product-wide behavior not exercised here.
