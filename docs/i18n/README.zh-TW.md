# MCPGateway — 讓多個 AI 程式設計工作階段共用本機 MCP 後端

多開幾個 Copilot CLI 工作階段，不必重複啟動同一套 MCP 服務。MCPGateway 共用已設定的本機後端，按需探索工具，並協調獨佔工作流程；它不是企業 API 治理平台。

- 共用較重後端的記憶體與啟動工作，減少每個工作階段各自開一份。
- 透過 6 個初始閘道工具按需探索能力與取得結構描述。
- 新增後端，保留現有智慧代理 MCP 連線。 [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

加入後端時不用重新啟動智慧代理的現有 MCP 連線：同步新增設定、結束進行中的工作流程，再只重新啟動自有閘道；目前的連接器會重新連線。 [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

適合多個工作階段共用同一後端與目錄；單一工作階段或輕量後端可能不划算，閘道也有額外用量。

[開始：安裝並執行首次授權讀取](#first-use) · [MCP / Copilot CLI](../CLIENTS.md#shared-core-install) · [6 個工具 / 2 個用戶端](../../test/catalog-scale.test.js)

[減少重複後端的記憶體用量](#resource-examples): 5 × 1.5 GB = 7.5 GB → 1.5 GB + 閘道與連接器額外用量.

<img src="../../assets/mcp-gateway-benefits.png" alt="共用較重後端的記憶體與啟動工作，減少每個工作階段各自開一份。" width="780">

英文標示的概念圖：多個工作階段共用後端，並非執行畫面或效能測試。假設每套 1.5 GB，6 GB 是計入額外用量前省下的重複記憶體；實測輕量後端的總用量反而更高。

<a id="first-use"></a>
## 首次設定與呼叫

**必要條件：** Node.js 24 或更新版本、npm、Git、支援外掛程式的 Copilot CLI，以及已設定並完成驗證的 MCP 服務。目前初次安裝須透過 Copilot CLI；Windows 是主要測試平台，Agency 為選用。其他用戶端的相容性與驗證程度各不相同。

設定與備份可能含認證資訊；請保持私密，只核准預期變更。

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. 安裝後開啟 Copilot CLI，執行 `/mcp-gateway-setup`，先檢閱預覽再核准預期變更。關閉並重新開啟 Copilot，執行傳回的精確 `readinessCommand`；保留私人備份與回復命令。

探索與取得結構描述不要求認領；若 `requiresExclusiveAccess: true`，須在 `call_tool` 前先 `claim_server`。

2. 呼叫 `list_servers` 並傳入 `{}`，預期看到已設定的別名、狀態與獨佔標記。選取已獲授權的後端，以 `search_tools` 搜尋工作相關詞彙，再以 `get_tool_schema` 取得選定工具的輸入結構描述。依結構描述準備引數，透過 `call_tool` 執行已核准的唯讀工作。預期結果是實際資料或有說明的空結果，仍須檢查錯誤，不能僅以收到回應判定成功。
3. 若 `requiresExclusiveAccess: true`，呼叫前先 `claim_server`，所有呼叫結束後才 `release_server`；非獨佔後端不需認領。逾時且結果不明時不要重試，先檢查進行中的工作，再協調重新啟動。 結果不明時，獨佔後端會維持封鎖，直到閘道重新啟動；釋放認領或中斷用戶端連線都不能安全解除封鎖，中斷連線也不等於取消作業。
4. 在第二個工作階段使用同一連接器與目錄，以 `list_servers` / `search_tools` 查詢同一別名。已初始化後端應顯示 `ready`，探索結果應來自同一目錄。別名相同不證明程序身分或記憶體節省；程序共用見公開測試。 [程序共用方法](../BENCHMARK.md#method) · [目錄快取測試](../../test/catalog-scale.test.js)

[完整英文範例](../../README.md#first-use) · [相容性](../CLIENTS.md#compatibility-summary)

## 限制、隱私與復原

從 Claude Code、Codex、Gemini CLI、Kimi 或 Qwen CLI 找到本儲存庫，不代表保證原生整合。此處沒有 Gemini CLI 安裝流程，Antigravity 是另一個用戶端；Kimi 僅經過配接器測試。設定與備份可能含有認證資訊，請勿公開或提交到版本控制。後端仍可能連線至遠端服務；共用不等於離線，也不保證固定的記憶體或 token 節省。

清單為空時，檢查所選設定與移轉預覽；搜尋無結果時，改用後端工具說明中的詞彙。驗證或就緒檢查失敗時，依操作參考處理，不要另開程序繞過閘道。停止使用時，還原用戶端設定不等於關閉常駐執行階段；請參閱擁有者交接與完成檢查。

[隱私](../REFERENCE.md#state-and-privacy) · [復原與回復](../REFERENCE.md#setup-recovery) · [停止使用與擁有者交接](../REFERENCE.md#planned-exit)

設定會先顯示預覽；核准後才會變更設定，並建立私人備份、傳回就緒檢查與精確回復命令。設定與備份可能含有認證資訊，請勿公開或提交到版本控制。

**操作參考（英文）：** [查看操作參考](../REFERENCE.md)

**授權：** [MIT](../../LICENSE)


<a id="resource-examples"></a>

**減少重複後端的記憶體用量**

假設情境，並非效能測試：5 個智慧代理工作階段各需同一組 12 個連線，一整套後端使用 1.5 GB。相容的工作階段透過同一連接器與目錄共用實際後端程序。

| 部署方式 | 後端記憶體 |
|---|---|
| 各自執行副本 | 5 × 1.5 GB = 7.5 GB |
| 共用一套後端 | 1.5 GB + 閘道與連接器的額外用量 |

計入額外用量前省下的重複後端記憶體：7.5 GB - 1.5 GB = 6 GB。總節省量須實測才能確定。1.5 GB 並非所有工作負載或用戶端的固定值；這不是省下五個模型的記憶體。

**啟動工作也能共用。** 假設 12 個 stdio 後端都由 5 個工作階段各自使用：獨立執行最多啟動 `5 × 12 = 60` 次，共用只需 `12` 次；避免 `60 - 12 = 48` 次重複啟動，即 `48 / 60 × 100 = 80%` 的啟動次數。延遲連線只連接實際使用的 `k` 個後端，不會啟動未使用的後端。這是工作次數，不代表啟動耗時縮短 80%；此處未測延遲，並行啟動、服務驗證和平台都會影響耗時。

1000 個後端工具 → 6 個初始閘道定義：(1000 - 6) / 1000 × 100 = 99.4%，僅指定義數量減少，並非 token 減少 99.4%。後續索取結構描述仍有成本；已延後載入定義的用戶端收益可能較小。合成目錄測試驗證六個工具與兩個用戶端共用探索快取，不測 RSS 記憶體效能。 [catalog-scale.test.js](../../test/catalog-scale.test.js)

**輕量測試後端的實測：可共用，但總記憶體與冷啟動未改善。** Windows x64 / Node 24.13.1，3 次試驗中位數：共用時結構描述加 echo 呼叫為冷後端 426.2 ms、第二用戶端 21.1 ms、第五用戶端 19.0 ms。首用戶端總耗時為獨立 503.5 ms、閘道已就緒時共用 894.3 ms；完全冷啟動共用為 1886.7 ms。後端程序 5 → 1，但總程序 5 → 7，工作集總和 357.0 MiB → 564.0 MiB，淨記憶體用量更差。單一 echo 工具測試不能代表重型實際服務；上方 1.5 GB 是另外的假設，不是實測。 [BENCHMARK.md](../BENCHMARK.md)

<a id="mechanism"></a>

SDK/stdio 測試驗證同一連接器與 MCP 連線在閘道重啟後探索新別名並執行 echo；未測試各品牌智慧代理的對話介面。並非自動熱載入；衝突別名須審查，首次註冊或執行階段升級仍可能要求用戶端重啟。中斷呼叫不會重播，重啟後須重新認領獨佔所有權。

```text
智慧代理 A ─┐                       ┌─ 整合服務 A: 多個工具
智慧代理 B ─┼─ 連接器 ─ MCPGateway ─┼─ 整合服務 B: 多個工具
智慧代理 C ─┘                       └─ 整合服務 C: 多個工具
```

多個智慧代理透過同一個連接器存取 MCPGateway，再依需要連線至選定的已設定後端。此圖僅說明共用機制，不是效能測試或實際執行的驗證，也不表示所有後端都會啟動。

> 這是本地化概覽。完整安裝、升級與技術細節以英文 [README](../../README.md) 和下方連結的英文用戶端指南為準。

[English](../../README.md)

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
