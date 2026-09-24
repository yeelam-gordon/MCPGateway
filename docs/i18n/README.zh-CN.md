# Shared MCP Gateway 快速入门

[English](../../README.md)

> 这是本地化快速入门。英文 [README](../../README.md) 是高级用法和最新技术细节的权威来源。

## 一个网关，连接已有的 MCP 后端

Shared MCP Gateway 让 Copilot 只需预先加载固定的 **6 个网关工具**，再按需查找和调用你已经配置的后端。即使后端目录包含约 **1,000 个工具**，也不必一开始就把所有工具定义都交给客户端。

它会在多个 Copilot CLI 会话之间复用后端目录和连接，从而减少重复启动的本地服务。网关不会替你安装 MCP 服务，也不会提供凭据；请继续使用原有方式配置服务器和身份验证。

6 个前端工具包括 4 个发现/执行工具，以及 2 个通用的服务器租约工具。租约适用于任何需要独占工作流状态的后端，并不只针对浏览器自动化。

## 前置条件

- Node.js 24 或更高版本、npm 和 Git
- 支持插件的 Copilot CLI
- 已有的 Copilot MCP 配置，以及后端所需的身份验证
- Agency 是可选项；普通 Copilot CLI 用户不需要它

## 安装

在终端中运行，**不要**在 Copilot 对话中运行：

```text
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

然后启动 Copilot，并在 Copilot 内运行：

```text
/mcp-gateway-setup
```

安装插件本身不会迁移 MCP 配置。设置命令会先显示预览；批准后，它会备份现有配置、把后端定义保存到私有目录，并将客户端配置切换到共享网关连接器。

请妥善保管设置输出中的备份路径和精确恢复命令。后端目录和备份可能包含凭据，不要公开或提交到版本控制。

完成后关闭并重新打开 Copilot。首次使用连接器时，网关会自动启动；无需另开终端长期运行它。

## 工作方式

1. `list_servers` 列出已配置的后端别名，而不会启动所有后端。
2. `search_tools` 在指定后端中搜索相关工具摘要。
3. `get_tool_schema` 只读取选中工具的完整输入架构。
4. `call_tool` 验证参数和允许列表后调用工具。
5. `claim_server` 和 `release_server` 为需要独占访问的服务器保护整个工作流，并在活动调用结束后释放租约。

MCP 客户端、网关和 MCP 服务器承担不同角色，但日常使用不需要理解协议细节：继续配置原有后端，让 Copilot 通过网关发现并调用它们即可。

## 更新和恢复

更新插件后，运行 `/mcp-gateway-setup` 才会明确采用新的运行时。先让活动调用完成，再应用更新并重新打开 Copilot；仅下载插件不会替换正在运行的网关。

如果设置失败，请关闭 Copilot，并使用设置输出中的确切备份路径和恢复命令。不要通过删除私有后端目录来排障。
更多配置同步、客户端集成、租约和故障排除信息，请参阅英文 [README](../../README.md)。

**许可证：** [MIT](../../LICENSE)
