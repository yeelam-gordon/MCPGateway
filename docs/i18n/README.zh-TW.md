# Shared MCP Gateway 快速入門

[English](../../README.md)

> 這是本地化快速入門。英文 [README](../../README.md) 是進階用法與最新技術細節的權威來源。

## 一個閘道，連接既有的 MCP 後端

Shared MCP Gateway 讓 Copilot 預先只載入固定的 **6 個閘道工具**，再依需求尋找並呼叫你已設定的後端。即使後端目錄包含約 **1,000 個工具**，也不必一開始就把所有工具定義交給用戶端。

它會在多個 Copilot CLI 工作階段之間重用後端目錄與連線，減少重複啟動本機服務。閘道不會替你安裝 MCP 伺服器，也不會提供認證資訊；請繼續使用原有方式設定伺服器與驗證。

6 個前端工具包含 4 個探索/執行工具，以及 2 個通用伺服器租約工具。租約適用於任何需要獨佔工作流程狀態的後端，不只限於瀏覽器自動化。

## 必要條件

- Node.js 24 或更新版本、npm 與 Git
- 支援外掛程式的 Copilot CLI
- 既有的 Copilot MCP 設定，以及後端需要的驗證
- Agency 為選用項目；一般 Copilot CLI 使用者不需要它

## 安裝

請在終端機中執行，**不要**在 Copilot 對話中執行：

```text
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

接著啟動 Copilot，並在 Copilot 內執行：

```text
/mcp-gateway-setup
```

只安裝外掛程式不會移轉 MCP 設定。設定命令會先顯示預覽；核准後，它會備份既有設定、將後端定義儲存在私有目錄，並把用戶端設定切換到共享閘道連接器。

請妥善保管設定輸出中的備份路徑與精確還原命令。後端目錄和備份可能含有認證資訊，請勿公開或提交到版本控制。

完成後關閉並重新開啟 Copilot。第一次使用連接器時，閘道會自動啟動；不需要另外開啟終端機長期執行它。

## 運作方式

1. `list_servers` 列出已設定的後端別名，而不啟動所有後端。
2. `search_tools` 在指定後端中搜尋相關工具摘要。
3. `get_tool_schema` 只取得所選工具的完整輸入結構描述。
4. `call_tool` 驗證參數與允許清單後呼叫工具。
5. `claim_server` 與 `release_server` 為需要獨佔存取的伺服器保護完整工作流程，並在活動呼叫結束後釋放租約。

MCP 用戶端、閘道與 MCP 伺服器各自負責不同角色，但日常使用不需要理解協定細節：繼續設定原有後端，讓 Copilot 透過閘道探索並呼叫即可。

## 更新與還原

更新外掛程式後，仍須執行 `/mcp-gateway-setup` 才會明確採用新的執行階段。先讓活動呼叫完成，再套用更新並重新開啟 Copilot；只下載外掛程式不會取代正在執行的閘道。

若設定失敗，請關閉 Copilot，並使用設定輸出中的確切備份路徑與還原命令。不要以刪除私有後端目錄的方式排解問題。
更多設定同步、用戶端整合、租約與疑難排解資訊，請參閱英文 [README](../../README.md)。

**授權：** [MIT](../../LICENSE)
