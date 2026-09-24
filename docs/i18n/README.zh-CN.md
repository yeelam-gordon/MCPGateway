# Shared MCP Gateway

[English](../../README.md)

> 这是本地化概览。完整安装、升级和技术细节以英文 [README](../../README.md) 与下方链接的英文客户端指南为准。

## 节省内存。把上下文留给工作。工具按需加载。

**更多智能体应该带来更多产出，而不是复制同一套 MCP 配置。**

### 5 个智能体，12 个 MCP 连接，共用一套配置

*示例场景：这 **12** 个连接提供 **1,000** 个工具，每套独立配置占用 **1.5 GB** 本地进程内存。*

| 收益 | 每个智能体独立配置 | 使用 MCPGateway |
|---|---|---|
| **节省内存** | 5 套独立配置合计 **7.5 GB**。 | **共享 1.5 GB**，另加网关和连接器开销；可避免 **6 GB 重复内存**。 |
| **把上下文留给工作，工具按需加载** | 每个智能体预先加载 **1,000 个工具定义**，新增 MCP 连接后还可能继续增加。 | 预先只加载 **6 个网关工具，定义数量减少 99.4%**。**1,000** 个工具仍可使用，每个智能体只发现和加载当前需要的工具；新增 MCP 连接也不必让所有智能体预载完整目录。 |

**保留你的智能体和 MCP 连接，不再让每个会话各自携带一份副本。**

*内存数字仅用于说明，并非实测节省；智能体自身还会占用额外内存。定义数量减少不等于令牌节省；已支持延迟加载的客户端，上下文收益可能较小。共享不会扩大模型的上下文窗口，也不会让总内存恒定不变。*

## 工作方式

网关始终向智能体提供 6 个工具：4 个用于发现和调用能力，2 个用于需要独占工作流的集成。新增连接不会扩大这套初始接口；只有选中的工具才会加载完整架构。网关复用你已经配置并完成身份验证的连接，不会替你安装服务或提供凭据。

**前置条件：** Node.js 24 或更高版本、npm、Git，以及当前引导流程所需的支持插件的 Copilot CLI。Agency 可选。

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

**运维参考（英文）：** [查看运维参考](../REFERENCE.md)

**许可证：** [MIT](../../LICENSE)
