# Shared MCP Gateway

[English](../../README.md)

> 這是本地化概覽。完整安裝、升級與技術細節以英文 [README](../../README.md) 和下方連結的英文用戶端指南為準。

## 節省記憶體。把內容空間留給工作。工具隨選載入。

**更多代理程式應該完成更多工作，而不是複製同一套 MCP 設定。**

### 5 個代理程式，12 個 MCP 連線，共用一套設定

*示例情境：這 **12** 個連線提供 **1,000** 個工具，每套獨立設定使用 **1.5 GB** 本機處理程序記憶體。*

| 效益 | 每個代理程式各自設定 | 使用 MCPGateway |
|---|---|---|
| **節省記憶體** | 5 套獨立設定合計 **7.5 GB**。 | **共用 1.5 GB**，另加閘道與連接器負擔；可避免 **6 GB 重複記憶體**。 |
| **把內容空間留給工作，工具隨選載入** | 每個代理程式預先載入 **1,000 個工具定義**，新增 MCP 連線後還可能繼續增加。 | 預先只載入 **6 個閘道工具，定義數量減少 99.4%**。**1,000** 個工具仍可使用，每個代理程式只探索和載入目前需要的工具；新增 MCP 連線也不必讓所有代理程式預載完整目錄。 |

**保留你的代理程式與 MCP 連線，不再讓每個工作階段各自攜帶一份副本。**

*記憶體數字僅供說明，並非實測節省；代理程式本身還會使用額外記憶體。定義數量減少不等於權杖節省；已支援延遲載入的用戶端，內容空間效益可能較小。共用不會擴大模型的內容視窗，也不會讓總記憶體固定不變。*

## 運作方式

閘道固定向代理程式提供 6 個工具：4 個用於探索與呼叫功能，2 個用於需要獨佔工作流程的整合。新增連線不會擴大這個初始介面；只有選定工具才會載入完整結構描述。閘道重用你已設定並完成驗證的連線，不會替你安裝服務或提供認證資訊。

**必要條件：** Node.js 24 或更新版本、npm、Git，以及目前引導流程所需且支援外掛程式的 Copilot CLI。Agency 為選用項目。

## 依用戶端安裝與升級

共用執行階段目前透過 Copilot CLI 建立；其他用戶端會連到同一個穩定連接器。下列連結前往英文用戶端指南，該指南是安裝與升級的權威來源。

| 用戶端 | 安裝 | 升級 |
|---|---|---|
| GitHub Copilot CLI | [安裝](../CLIENTS.md#copilot-cli-install) | [升級](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code（編輯器） | [安裝](../CLIENTS.md#vs-code-install) | [升級](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [安裝](../CLIENTS.md#claude-code-install) | [升級](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [安裝](../CLIENTS.md#codex-install) | [升級](../CLIENTS.md#codex-upgrade) |
| OpenCode | [安裝](../CLIENTS.md#opencode-install) | [升級](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [安裝](../CLIENTS.md#qwen-code-install) | [升級](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [安裝](../CLIENTS.md#kimi-cli-install) | [升級](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [安裝](../CLIENTS.md#antigravity-cli-install) | [升級](../CLIENTS.md#antigravity-cli-upgrade) |

設定會先顯示預覽；核准後才會變更設定，並建立私人備份、傳回就緒檢查與精確回復命令。設定與備份可能含有認證資訊，請勿公開或提交到版本控制。

**操作參考（英文）：** [查看操作參考](../REFERENCE.md)

**授權：** [MIT](../../LICENSE)
