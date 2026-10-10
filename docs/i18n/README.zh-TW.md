# MCPGateway — 讓多個 AI 程式設計工作階段共用本機 MCP 後端

[English](../../README.md)

> 這是本地化概覽。完整安裝、升級與技術細節以英文 [README](../../README.md) 和下方連結的英文用戶端指南為準。

多開幾個 Copilot CLI 工作階段，不必重複啟動同一套 MCP 服務。MCPGateway 共用已設定的本機後端，按需探索工具，並協調獨佔工作流程；它不是企業 API 治理平台。

**必要條件：** Node.js 24 或更新版本、npm、Git、支援外掛程式的 Copilot CLI，以及已設定並完成驗證的 MCP 服務。目前初次安裝須透過 Copilot CLI；Windows 是主要測試平台，Agency 為選用。其他用戶端的相容性與驗證程度各不相同。

閘道固定向代理程式提供 6 個工具：4 個用於探索與呼叫功能，2 個用於需要獨佔工作流程的整合。新增連線不會擴大這個初始介面；只有選定工具才會載入完整結構描述。閘道重用你已設定並完成驗證的連線，不會替你安裝服務或提供認證資訊。

例如，Copilot 原有 **10** 個連線，明確移轉受支援的 Claude 設定中 **2** 個新連線後，兩者便可共用 **12** 個連線。

- 只安裝外掛程式不會合併設定。同名項目只有在別名定義完全相同時才會去除重複；指向同一服務並不足夠。衝突會停止流程並等待檢閱。
- 移轉先顯示預覽並建立備份，拒絕不支援的原生設定。
- 這不表示所有原生用戶端都已完成端對端測試。請參閱[移轉指南（英文）](../CLIENTS.md#cross-client-migration)。

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

## 首次設定與呼叫

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. 安裝後開啟 Copilot CLI，執行 `/mcp-gateway-setup`，先檢閱預覽再核准預期變更。關閉並重新開啟 Copilot，執行傳回的精確 `readinessCommand`；保留私人備份與回復命令。
2. 呼叫 `list_servers` 並傳入 `{}`，預期看到已設定的別名、狀態與獨佔標記。選取已獲授權的後端，以 `search_tools` 搜尋工作相關詞彙，再以 `get_tool_schema` 取得選定工具的輸入結構描述。依結構描述準備引數，透過 `call_tool` 執行已核准的唯讀工作。預期結果是實際資料或有說明的空結果，仍須檢查錯誤，不能僅以收到回應判定成功。
3. 若 `requiresExclusiveAccess: true`，搜尋前先 `claim_server`，所有呼叫結束後才 `release_server`；非獨佔後端不需認領。逾時且結果不明時不要重試，先檢查進行中的工作，再協調重新啟動。 結果不明時，獨佔後端會維持封鎖，直到閘道重新啟動；釋放認領或中斷用戶端連線都不能安全解除封鎖，中斷連線也不等於取消作業。

[完整英文範例](../../README.md#first-use) · [相容性](../CLIENTS.md#compatibility-summary)

## 限制、隱私與復原

從 Claude Code、Codex、Gemini CLI、Kimi 或 Qwen CLI 找到本儲存庫，不代表保證原生整合。此處沒有 Gemini CLI 安裝流程，Antigravity 是另一個用戶端；Kimi 僅經過配接器測試。設定與備份可能含有認證資訊，請勿公開或提交到版本控制。後端仍可能連線至遠端服務；共用不等於離線，也不保證固定的記憶體或 token 節省。

清單為空時，檢查所選設定與移轉預覽；搜尋無結果時，改用後端工具說明中的詞彙。驗證或就緒檢查失敗時，依操作參考處理，不要另開程序繞過閘道。停止使用時，還原用戶端設定不等於關閉常駐執行階段；請參閱擁有者交接與完成檢查。

[隱私](../REFERENCE.md#state-and-privacy) · [復原與回復](../REFERENCE.md#setup-recovery) · [停止使用與擁有者交接](../REFERENCE.md#planned-exit)

設定會先顯示預覽；核准後才會變更設定，並建立私人備份、傳回就緒檢查與精確回復命令。設定與備份可能含有認證資訊，請勿公開或提交到版本控制。

**操作參考（英文）：** [查看操作參考](../REFERENCE.md)

**授權：** [MIT](../../LICENSE)
