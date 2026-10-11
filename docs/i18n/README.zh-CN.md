# MCPGateway — 让多个编程会话共享本地 MCP 后端

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

多个编程会话共用一组后端：避免重复内存，复用启动工作；在已验证的 SDK/stdio 配置变更路径中保留现有 MCP 连接（从你的智能体到网关的现有连接）。

[开始使用](#first-use) · [兼容性（英文）](../CLIENTS.md#compatibility-summary) · [证据与限制（英文）](../BENCHMARK.md) · [Copilot 更新](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="重复后端合为一组；重复启动变为共享启动；SDK/stdio 实验中，现有 MCP 连接跨越工作结束后的自有网关重启。" width="780">

概念示意图，使用英文标签；不是运行截图或基准测试。 [SVG](../../assets/mcp-gateway-benefits.svg)

- **避免重复后端内存:** 假设 5 × 1.5 GB 后端共享一组，扣除网关与连接器开销**之前**避免 6 GB 重复占用；不是实测净节省。
- **复用后端启动工作:** 假设五个会话都使用十二个 stdio 服务，启动次数 60 → 12；不代表启动耗时缩短 80%。
- **保留现有 MCP 连接:** SDK/stdio 实验在仅新增配置、结束活动工作后重启自有网关，保留了现有连接。不是热加载、活动调用连续性或所有原生对话界面的证明；首次注册与运行时升级可能仍需重启客户端。 [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**适合与跳过:** 适合共享同一连接器与目录的多个会话。单会话或轻量后端用直接 MCP 可能更简单。轻量测试的进程工作集总和为 357.0 → 564.0 MiB，从全新网关启动到首次共享请求的有用结果耗时为 1886.7 ms，对比直接模式 503.5 ms；净收益取决于开销。 [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## 首次有用结果：通过共享网关执行获授权的只读任务

需要 Node.js 24+、npm、Git、支持插件的 Copilot CLI，以及已配置并完成所需身份验证的 MCP 集成。当前先通过 Copilot CLI 安装；Windows 是主要测试平台，其他客户端的验证程度不同。 [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**安装前:** 配置、私有目录与备份可能含凭据，请勿公开。后端可能联系远程服务。安装会建立持久运行时；恢复客户端配置或删除插件不会关闭网关进程。 [REFERENCE](../REFERENCE.md#planned-exit) 本地私有状态和保存的网关令牌仅限所有者访问，未额外加密。

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. 启动 Copilot CLI，运行 `/mcp-gateway-setup`。审查预览，只批准预期变更；保留私有备份与回滚命令。仅安装插件不会合并配置。
2. 关闭并重新打开 Copilot，按命令对象说明执行返回的精确 `readinessCommand`。只检查就绪状态的命令不会启动不存在的网关。 [readinessCommand](../REFERENCE.md#readiness-command-object) 只保存返回的 JSON 对象；`.command` 是获批准的可执行程序，`.args` 是顺序不变的精确参数。
3. 在已有集成中选择无害、获授权的只读任务。只替换下方括号中的任务；别名、工具与参数必须来自发现结果和输入结构，不能猜测。

> 请用共享网关完成[我获授权的只读任务]。依次使用 `list_servers`、定向 `search_tools` 与 `get_tool_schema`，用获授权且不敏感的测试值构造符合输入结构的参数。取得正常批准；若 `requiresExclusiveAccess: true`，在 `call_tool` 前先 `claim_server` 一次，所有调用结束后 `release_server`；非独占后端无需认领。显示实际记录或有说明的空结果，并检查错误，不以收到网关响应作为成功证明。结果不明时不要重试，保持阻塞并交给安装负责人私下处理。

4. 第二个会话使用同一连接器与目录查询相同别名：应看到 `ready` 与相同目录能力。这检查共享发现，不证明进程身份或 RAM 节省。 [MCP](../REFERENCE.md#first-shared-workflow) [公开 echo 示例与结果](../REFERENCE.md#public-echo-illustration).

**失败时:** 目录为空先检查所选配置与预览；搜索无匹配时用后端自身描述中的词。身份验证或就绪失败按参考处理，不启动并行进程绕过网关。独占结果不明时，释放或断开连接不是取消，也不能安全解除阻塞；先核对下游结果，再协调自有网关重启并重新认领。 [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**停止使用:** 先结束工作并等待调用完成，恢复或移除所有相关客户端连接器，再按负责人交接流程核验自有网关已停止。回滚配置不等于关闭进程；保留私有状态、凭据、历史与无关进程。 [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
此页是本地化概览；完整方法、数值出处与运维说明在英文指南。原生客户端支持范围并不等于本地化理解已获人工验证。 [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
