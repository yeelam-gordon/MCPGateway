# MCPGateway — 让多个 AI 编程会话共享本地 MCP 服务

[English](../../README.md)

> 这是本地化概览。完整安装、升级和技术细节以英文 [README](../../README.md) 与下方链接的英文客户端指南为准。

## 复用后端，减少重复启动，按需发现工具。

多个 Copilot CLI 会话不必各自启动同一套 MCP 后端。网关共享本地已配置的服务，并协调需要独占的工作流；它不是企业 API 治理平台。

**前置条件：** Node.js 24+、npm、Git、支持插件的 Copilot CLI，以及已配置并完成所需身份验证的 MCP 服务。目前必须先通过 Copilot CLI 引导安装；Windows 是主要测试平台，Agency 可选。其他客户端的兼容性和验证程度不同。

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

## 首次安装与调用

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. 安装插件后启动 Copilot CLI，运行 `/mcp-gateway-setup`，审查预览后再批准。关闭并重新打开 Copilot，再运行设置返回的精确 `readinessCommand`；保留备份和回滚命令。仅安装插件不会合并配置。
2. 调用 `list_servers`（输入 `{}`），应看到现有服务的别名、状态和独占标志。从中选一个已授权的后端，用 `search_tools` 按任务关键词搜索，再用 `get_tool_schema` 取得返回工具的输入模式（schema），最后按输入模式构造参数，通过 `call_tool` 执行已批准的只读任务。预期看到该后端返回的记录或有说明的空结果，而不是仅以网关响应作为成功证明。
3. 如 `requiresExclusiveAccess: true`，搜索前先 `claim_server`，所有调用结束后 `release_server`。非独占后端无需认领。未知结果的超时不能重试，应先审查活动任务再协调重启。 结果不明时，独占后端会保持阻塞，直到网关重启；释放认领或断开客户端连接不能安全解除阻塞，断开连接也不等于取消操作。

[英文完整示例](../../README.md#first-use) · [兼容性与限制](../CLIENTS.md#compatibility-summary)

## 范围、隐私与恢复

从 Claude Code、Codex、Gemini CLI、Kimi 或 Qwen CLI 搜索并阅读本仓库，不代表已有原生集成保证。Gemini CLI 没有此处记录的安装路线，不能与 Antigravity 混同；Kimi 仅经过适配器测试。配置和备份可能含凭据，请勿公开。后端仍可能联系远程服务；共享不等于离线，也不保证固定内存或令牌节省。

停止使用前先完成活动工作并等待调用结束。恢复客户端配置不等于关闭常驻运行时。请按[停止使用与运维人员交接（英文）](../REFERENCE.md#planned-exit)提出请求并核验完成状态；保留私有状态和凭据，不要停止无关进程。

[隐私](../REFERENCE.md#state-and-privacy) · [恢复与回滚](../REFERENCE.md#setup-recovery)

**运维参考（英文）：** [查看运维参考](../REFERENCE.md)

**许可证：** [MIT](../../LICENSE)
