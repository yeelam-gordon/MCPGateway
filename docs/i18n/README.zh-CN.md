# MCPGateway — 让多个 AI 编程会话共享本地 MCP 服务

多个 Copilot CLI 会话不必各自启动同一套 MCP 后端。网关共享本地已配置的服务，并协调需要独占的工作流；它不是企业 API 治理平台。

- 复用较重后端的内存与启动工作，而不是每个会话各开一份。
- 用 6 个初始网关工具按需发现能力和获取模式。
- 增加后端，保留现有智能体 MCP 连接。 [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

加入后端时无需重启智能体的现有 MCP 连接：同步新增配置、结束活动工作流，再仅重启自有网关；当前连接器会重连。 [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

适合多个会话共用同一后端和目录；单会话或轻量后端可能不划算，网关开销并非免费。

[开始：安装并执行首次授权读取](#first-use) · [MCP / Copilot CLI](../CLIENTS.md#shared-core-install) · [6 个工具 / 2 个客户端](../../test/catalog-scale.test.js)

[避免重复后端占用内存](#resource-examples): 5 × 1.5 GB = 7.5 GB → 1.5 GB + 网关与连接器开销.

<img src="../../assets/mcp-gateway-benefits.png" alt="复用较重后端的内存与启动工作，而不是每个会话各开一份。" width="780">

英文标注的概念图：多会话共用后端，并非运行截图或基准测试。假设 1.5 GB 一套，6 GB 是扣除开销前避免的重复内存；实测轻量后端的总内存反而更高。

<a id="first-use"></a>
## 首次安装与调用

**前置条件：** Node.js 24+、npm、Git、支持插件的 Copilot CLI，以及已配置并完成所需身份验证的 MCP 服务。目前必须先通过 Copilot CLI 引导安装；Windows 是主要测试平台，Agency 可选。其他客户端的兼容性和验证程度不同。

配置和备份可能含凭据；保持私密，只批准预期变更。

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. 安装插件后启动 Copilot CLI，运行 `/mcp-gateway-setup`，审查预览后再批准。关闭并重新打开 Copilot，再运行设置返回的精确 `readinessCommand`；保留备份和回滚命令。仅安装插件不会合并配置。

发现和获取模式不要求认领；如 `requiresExclusiveAccess: true`，必须在 `call_tool` 前先 `claim_server`。

2. 调用 `list_servers`（输入 `{}`），应看到现有服务的别名、状态和独占标志。从中选一个已授权的后端，用 `search_tools` 按任务关键词搜索，再用 `get_tool_schema` 取得返回工具的输入模式（schema），最后按输入模式构造参数，通过 `call_tool` 执行已批准的只读任务。预期看到该后端返回的记录或有说明的空结果，而不是仅以网关响应作为成功证明。
3. 如 `requiresExclusiveAccess: true`，调用前先 `claim_server`，所有调用结束后 `release_server`。非独占后端无需认领。未知结果的超时不能重试，应先审查活动任务再协调重启。 结果不明时，独占后端会保持阻塞，直到网关重启；释放认领或断开客户端连接不能安全解除阻塞，断开连接也不等于取消操作。
4. 在第二个会话使用同一连接器与目录，重复 `list_servers` / `search_tools` 查询同一别名。已初始化后端应显示 `ready`，搜索应返回相同目录中的能力。别名相同不证明进程身份或 RAM 节省；进程复用见公共测试。 [进程复用方法](../BENCHMARK.md#method) · [目录缓存测试](../../test/catalog-scale.test.js)

[英文完整示例](../../README.md#first-use) · [兼容性与限制](../CLIENTS.md#compatibility-summary)

## 范围、隐私与恢复

从 Claude Code、Codex、Gemini CLI、Kimi 或 Qwen CLI 搜索并阅读本仓库，不代表已有原生集成保证。Gemini CLI 没有此处记录的安装路线，不能与 Antigravity 混同；Kimi 仅经过适配器测试。配置和备份可能含凭据，请勿公开。后端仍可能联系远程服务；共享不等于离线，也不保证固定内存或令牌节省。

停止使用前先完成活动工作并等待调用结束。恢复客户端配置不等于关闭常驻运行时。请按[停止使用与运维人员交接（英文）](../REFERENCE.md#planned-exit)提出请求并核验完成状态；保留私有状态和凭据，不要停止无关进程。

[隐私](../REFERENCE.md#state-and-privacy) · [恢复与回滚](../REFERENCE.md#setup-recovery)

**运维参考（英文）：** [查看运维参考](../REFERENCE.md)

**许可证：** [MIT](../../LICENSE)


<a id="resource-examples"></a>

**避免重复后端占用内存**

假设示例，不是基准测试：5 个智能体会话各需同一组 12 个连接，一整套后端占用 1.5 GB。兼容会话通过同一连接器和目录共用实际后端进程。

| 部署方式 | 后端内存 |
|---|---|
| 各自运行副本 | 5 × 1.5 GB = 7.5 GB |
| 共享一套后端 | 1.5 GB + 网关与连接器开销 |

扣除开销前避免的重复后端内存：7.5 GB - 1.5 GB = 6 GB。总节省量需测量后才能确定。1.5 GB 不同于跨工作负载或客户端的固定值；节省对象是后端，不是五个模型的内存。

**也复用启动工作。** 假设 12 个 stdio 后端都被 5 个会话各自使用：独立运行最多启动 `5 × 12 = 60` 次，共享只需 `12` 次；避免 `60 - 12 = 48` 次重复启动，即 `48 / 60 × 100 = 80%` 的启动次数。惰性连接只连接实际使用的 `k` 个后端，而非全部 12 个；未使用的后端不会启动。这是工作次数，不是启动耗时缩短 80%；这里未测启动延迟，并发、服务认证和平台都会影响实际耗时。

1000 个后端工具 → 6 个初始网关定义：(1000 - 6) / 1000 × 100 = 99.4%，仅为定义数量减少，不是 token 减少 99.4%。随后请求的模式仍有成本；已延迟加载定义的客户端收益可能更小。合成目录测试验证六个工具和两个客户端共享发现缓存，不测 RSS 内存性能。 [catalog-scale.test.js](../../test/catalog-scale.test.js)

**轻量测试后端的实测：复用成立，但总内存和冷启动未改善。** Windows x64 / Node 24.13.1，3 次试验中位数：共享模式下模式获取加 echo 调用为冷后端 426.2 ms、第二客户端 21.1 ms、第五客户端 19.0 ms。首客户端总耗时为独立 503.5 ms、网关已就绪时共享 894.3 ms；完全冷启动共享为 1886.7 ms。后端进程 5 → 1，但总进程 5 → 7，工作集总和 357.0 MiB → 564.0 MiB，净内存更差。单工具 echo 测试不能代表重型真实服务；上方 1.5 GB 是独立假设，并非实测。 [BENCHMARK.md](../BENCHMARK.md)

<a id="mechanism"></a>

SDK/stdio 测试验证同一连接器和 MCP 连接跨网关重启发现新别名并执行 echo；未测试各品牌智能体的对话界面。不是自动热加载；冲突别名须审查，首次注册或运行时升级仍可能要求客户端重启。中断调用不重放，重启后须重新认领独占所有权。

```text
智能体 A ─┐                       ┌─ 集成服务 A: 多个工具
智能体 B ─┼─ 连接器 ─ MCPGateway ─┼─ 集成服务 B: 多个工具
智能体 C ─┘                       └─ 集成服务 C: 多个工具
```

多个智能体通过同一个连接器访问 MCPGateway，再按需连接选中的已配置后端。此图仅说明共享机制，不是基准测试或运行验证，也不表示所有后端都会启动。

> 这是本地化概览。完整安装、升级和技术细节以英文 [README](../../README.md) 与下方链接的英文客户端指南为准。

[English](../../README.md)

## 复用后端，减少重复启动，按需发现工具。

## 工作方式

网关始终向智能体提供 6 个工具：4 个用于发现和调用能力，2 个用于需要独占工作流的集成。新增连接不会扩大这套初始接口；只有选中的工具才会加载完整的输入模式（schema）。网关复用你已经配置并完成身份验证的连接，不会替你安装服务或提供凭据。

一个共享 MCP 目录可供多个智能体使用。例如，先在 Copilot 中配置 **10** 个连接，再明确迁移包含 **2** 个新连接的受支持 Claude 配置，两个智能体就都能使用同一组 **12** 个连接。

- 仅安装插件不会自动合并配置。只有同名条目的别名定义完全相同时才会去重；仅指向同一服务并不足够。发现冲突时会停止并等待审查。
- 迁移先显示预览并创建备份，不支持的原生设置会被拒绝。
- 这不表示每个原生客户端都已完成端到端测试。请参阅[迁移指南（英文）](../CLIENTS.md#cross-client-migration)。

## 按客户端安装和升级

共享运行时目前通过 Copilot CLI 引导创建；其他客户端连接到同一个稳定连接器。以下链接指向英文客户端指南，它是安装和升级的权威来源。

| 客户端 | 安装 | 升级 |
|---|---|---|
| GitHub Copilot CLI | [安装](../CLIENTS.md#copilot-cli-install) | [升级](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code（编辑器） | [安装](../CLIENTS.md#vs-code-install) | [升级](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [安装](../CLIENTS.md#claude-code-install) | [升级](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [安装](../CLIENTS.md#codex-install) | [升级](../CLIENTS.md#codex-upgrade) |
| OpenCode | [安装](../CLIENTS.md#opencode-install) | [升级](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [安装](../CLIENTS.md#qwen-code-install) | [升级](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [安装](../CLIENTS.md#kimi-cli-install) | [升级](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [安装](../CLIENTS.md#antigravity-cli-install) | [升级](../CLIENTS.md#antigravity-cli-upgrade) |

设置会先显示预览；批准后才会更改配置，并会创建私有备份、返回就绪检查和精确回滚命令。配置和备份可能含有凭据，请勿公开或提交到版本控制。
