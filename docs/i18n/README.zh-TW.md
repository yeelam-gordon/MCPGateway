# MCPGateway — 讓多個 AI 程式設計工作階段共用本機 MCP 後端

<a id="languages"></a>
<details>
<summary>Languages / 语言 / 言語 / اللغات (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

跨程式設計工作階段共用本機 MCP 後端：避免記憶體重複占用，重用已啟動的後端，新增後端設定時保留智慧代理端現有 MCP 連線，不必重啟該連線（SDK/stdio 路徑；淨效益取決於額外負擔）。

[透過 Copilot CLI 開始](#first-use) · [用戶端驗證](../CLIENTS.md#compatibility-summary) · [證據](#resource-examples)

<img src="../../assets/mcp-gateway-benefits.png" alt="讓多個工作階段共用資源需求較高的 MCP 後端程序，避免各自重複啟動、各占一份記憶體。" width="780">

英文標示的概念圖：多個工作階段共用後端，並非執行畫面或效能測試。

- **避免重複後端記憶體:** 假設 5 × 1.5 GB 後端共用一套，計入閘道與連接器額外負擔**之前**避免 6 GB 重複占用，不是實測節省。
- **避免重複啟動後端:** 假設 5 個工作階段都使用 12 個 stdio 服務：60 → 12 次後端啟動，不代表啟動耗時縮短 80%。
- **僅新增後端設定，保留智慧代理連線:** SDK/stdio 的 1 次初始化跨越工作結束後的自有閘道重啟；連接器持續執行，並非熱載入，也未驗證各品牌對話介面。首次註冊或執行階段升級仍可能須重啟用戶端。 [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

適合多個工作階段共用同一後端與目錄；單一工作階段或輕量後端可能不划算，閘道也有額外負擔。

<a id="first-use"></a>
## 首次設定與呼叫

**必要條件：** Node.js 24 或更新版本、npm、Git、支援外掛程式的 Copilot CLI，以及已設定並完成驗證的 MCP 服務。目前初次安裝須透過 Copilot CLI；Windows 是主要測試平台，Agency 為選用。其他用戶端的相容性與驗證程度各不相同。

設定與備份可能含認證資訊；請保持私密，只核准預期變更。

[退出與持續執行環境](../REFERENCE.md#planned-exit) · [還原用戶端設定不會停止常駐閘道程序（rollback ≠ daemon shutdown）](../REFERENCE.md#setup-recovery)

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. 安裝後開啟 Copilot CLI，執行 `/mcp-gateway-setup`，先檢閱預覽再核准預期變更。關閉並重新開啟 Copilot，執行傳回的精確 `readinessCommand`；保留私人備份與回復命令。

`readinessCommand` 是傳回的物件，不是命令字串。將 `$readinessCommand` 設為已核准設定結果中原樣傳回的物件，再執行下方 PowerShell 範例。`.command` 保留完整執行檔路徑，`.args` 依序保留所有引數，包括含空格或引號的路徑。不要將陣列串成一個引數，也不要猜測路徑；檢查不會啟動不存在的閘道。

只將已核准設定結果中的 `readinessCommand` JSON 物件（不是全部輸出）以 UTF-8 存為私人目前資料夾中的 `readiness-command.json`。保留已知且已核准的 `.command` 與所有 `.args` 原值，不串接引數或猜測路徑。只解析這份設定 JSON，不使用任意網頁或服務資料；解析不是執行程式碼。引數內容依設定而異，請保持檔案私密。

```powershell
$readinessCommand = Get-Content -Raw -LiteralPath '.\readiness-command.json' | ConvertFrom-Json
$command = $readinessCommand.command
$commandArgs = @($readinessCommand.args)
& $command @commandArgs
```

探索與取得結構描述不要求認領；若 `requiresExclusiveAccess: true`，須在 `call_tool` 前先 `claim_server`。

> 請用共用閘道完成[我獲授權的唯讀工作]：列出已設定後端、探索適合工具、檢查輸入結構描述，以獲授權且不敏感的測試值準備引數。依正常流程取得核准；僅在獨佔執行前認領，呼叫結束後釋放。顯示實際結果；結果不明時不要重試，交由安裝負責人依操作員交接流程處理。

[SDK tool flow: `list_servers` → `search_tools` → `get_tool_schema` → `claim_server` (exclusive) → `call_tool` → `release_server`](../../README.md#first-use) · [REFERENCE](../REFERENCE.md#unknown-exclusive-result)

2. 呼叫 `list_servers` 並傳入 `{}`，預期看到已設定的別名、狀態與獨佔標記。選取已獲授權的後端，以 `search_tools` 搜尋工作相關詞彙，再以 `get_tool_schema` 取得選定工具的輸入結構描述。依結構描述準備引數，透過 `call_tool` 執行已核准的唯讀工作。預期結果是實際資料或有說明的空結果，仍須檢查錯誤，不能僅以收到回應判定成功。
3. 若 `requiresExclusiveAccess: true`，呼叫前先 `claim_server`，所有呼叫結束後才 `release_server`；非獨佔後端不需認領。逾時且結果不明時不要重試，先檢查進行中的工作，再協調重新啟動。 結果不明時，獨佔後端會維持封鎖，直到閘道重新啟動；釋放認領或中斷用戶端連線都不能安全解除封鎖，中斷連線也不等於取消作業。
4. 在第二個工作階段使用同一連接器與目錄，以 `list_servers` / `search_tools` 查詢同一別名。已初始化後端應顯示 `ready`，探索結果應來自同一目錄。別名相同不證明程序身分或記憶體節省；程序共用見公開測試。 [程序共用方法](../BENCHMARK.md#method) · [目錄快取測試](../../test/catalog-scale.test.js)

[完整英文範例](../../README.md#first-use) · [相容性](../CLIENTS.md#compatibility-summary)

## 限制、隱私與復原

從 Claude Code、Codex、Gemini CLI、Kimi 或 Qwen CLI 找到本儲存庫，不代表保證原生整合。此處沒有 Gemini CLI 安裝流程，Antigravity 是另一個用戶端；Kimi 僅經過轉接器測試。設定與備份可能含有認證資訊，請勿公開或提交到版本控制。後端仍可能連線至遠端服務；共用不等於離線，也不保證固定的記憶體或 token 節省。

清單為空時，檢查所選設定與移轉預覽；搜尋無結果時，改用後端工具說明中的詞彙。驗證或就緒檢查失敗時，依操作參考處理，不要另開程序繞過閘道。停止使用時，還原用戶端設定不等於關閉常駐執行階段；請參閱擁有者交接與完成檢查。

[隱私](../REFERENCE.md#state-and-privacy) · [復原與回復](../REFERENCE.md#setup-recovery) · [停止使用與擁有者交接](../REFERENCE.md#planned-exit)

<a id="resource-examples"></a>

**減少重複後端的記憶體用量**

假設情境，並非效能測試：5 個智慧代理工作階段各需同一組 12 個連線，一整套後端使用 1.5 GB。相容的工作階段透過同一連接器與目錄共用實際後端程序。

| 部署方式 | 後端記憶體 |
|---|---|
| 各自執行副本 | 5 × 1.5 GB = 7.5 GB |
| 共用一套後端 | 1.5 GB + 閘道與連接器的額外負擔 |

計入額外負擔前省下的重複後端記憶體：7.5 GB - 1.5 GB = 6 GB。總節省量須實測才能確定。1.5 GB 並非所有工作負載或用戶端的固定值；這不是省下五個模型的記憶體。

**啟動工作也能共用。** 假設 12 個 stdio 後端都由 5 個工作階段各自使用：獨立執行最多啟動 `5 × 12 = 60` 次，共用只需 `12` 次；避免 `60 - 12 = 48` 次重複啟動，即 `48 / 60 × 100 = 80%` 的啟動次數。延遲連線只連接實際使用的 `k` 個後端，不會啟動未使用的後端。這是工作次數，不代表啟動耗時縮短 80%；此處未測延遲，並行啟動、服務驗證和平台都會影響耗時。

1000 個後端工具 → 6 個初始閘道定義：(1000 - 6) / 1000 × 100 = 99.4%，僅指定義數量減少，並非 token 減少 99.4%。後續索取結構描述仍有成本；已延後載入定義的用戶端收益可能較小。合成目錄測試驗證六個工具與兩個用戶端共用探索快取，不測 RSS 記憶體效能。 [catalog-scale.test.js](../../test/catalog-scale.test.js)

**輕量後端實測：程序工作集總和增加** Windows x64 / Node 24.13.1，3 次試驗中位數：共用時結構描述加 echo 呼叫為冷後端 426.2 ms、第二用戶端 21.1 ms、第五用戶端 19.0 ms。首用戶端總耗時為獨立 503.5 ms、閘道已就緒時共用 894.3 ms；完全冷啟動共用為 1886.7 ms。後端程序 5 → 1，但總程序 5 → 7，工作集總和 357.0 MiB → 564.0 MiB，程序工作集總和較高，未測獨占實體記憶體。單一 echo 工具測試不能代表重型實際服務；上方 1.5 GB 是另外的假設，不是實測。 [BENCHMARK.md](../BENCHMARK.md)

測量的是程序工作集總和；去除重複計算的實體記憶體與私有位元組（private bytes）均未測量。

<a id="mechanism"></a>

## 工作方式

加入後端時不用重新啟動智慧代理的現有 MCP 連線：同步新增設定、結束進行中的工作流程，再只重新啟動自有閘道；目前的連接器會重新連線。 [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

SDK/stdio 測試驗證同一連接器與 MCP 連線在閘道重啟後探索新別名並執行 echo；未測試各品牌智慧代理的對話介面。並非自動熱載入；衝突別名須審查，首次註冊或執行階段升級仍可能要求用戶端重啟。中斷呼叫不會重播，重啟後須重新認領獨佔所有權。

它不是企業 API 治理平台。

閘道固定向智慧代理提供 6 個工具：4 個用於探索與呼叫功能，2 個用於需要獨佔工作流程的整合。新增連線不會擴大這個初始介面；只有選定工具才會載入完整結構描述。閘道重用你已設定並完成驗證的連線，不會替你安裝服務或提供認證資訊。

```text
智慧代理 A ─┐                       ┌─ 整合服務 A: 多個工具
智慧代理 B ─┼─ 連接器 ─ MCPGateway ─┼─ 整合服務 B: 多個工具
智慧代理 C ─┘                       └─ 整合服務 C: 多個工具
```

多個智慧代理透過同一個連接器存取 MCPGateway，再依需要連線至選定的已設定後端。此圖僅說明共用機制，不是效能測試或實際執行的驗證，也不表示所有後端都會啟動。

<a id="clients"></a>
## 依用戶端安裝與升級

> 這是本地化概覽。完整安裝、升級與技術細節以英文 [README](../../README.md) 和下方連結的英文用戶端指南為準。

<details>
<summary>依用戶端安裝與升級</summary>

例如，Copilot 原有 **10** 個連線，明確移轉受支援的 Claude 設定中 **2** 個新連線後，兩者便可共用 **12** 個連線。

- 只安裝外掛程式不會合併設定。同名項目只有在別名定義完全相同時才會去除重複；指向同一服務並不足夠。衝突會停止流程並等待檢閱。
- 移轉先顯示預覽並建立備份，拒絕不支援的原生設定。
- 這不表示所有原生用戶端都已完成端對端測試。請參閱[移轉指南（英文）](../CLIENTS.md#cross-client-migration)。

| 用戶端 | 安裝 | 升級 | 須先完成引導安裝 | 驗證程度 |
|---|---|---|---|---|
| GitHub Copilot CLI | [安裝](../CLIENTS.md#copilot-cli-install) | [升級](../CLIENTS.md#copilot-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [市集/安裝流程；隔離設定解析](../CLIENTS.md#compatibility-summary) |
| VS Code（編輯器） | [安裝](../CLIENTS.md#vs-code-install) | [升級](../CLIENTS.md#vs-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [註冊/格式轉接器已測；未完成原生端到端工作階段](../CLIENTS.md#compatibility-summary) |
| Claude Code | [安裝](../CLIENTS.md#claude-code-install) | [升級](../CLIENTS.md#claude-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [隔離設定解析通過；未啟動模型或後端](../CLIENTS.md#compatibility-summary) |
| Codex CLI | [安裝](../CLIENTS.md#codex-install) | [升級](../CLIENTS.md#codex-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [原生驗證受管理原則阻擋](../CLIENTS.md#compatibility-summary) |
| OpenCode | [安裝](../CLIENTS.md#opencode-install) | [升級](../CLIENTS.md#opencode-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [註冊/格式轉接器已測；未完成原生端到端工作階段](../CLIENTS.md#compatibility-summary) |
| Qwen Code | [安裝](../CLIENTS.md#qwen-code-install) | [升級](../CLIENTS.md#qwen-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [註冊/格式轉接器已測；未完成原生端到端工作階段](../CLIENTS.md#compatibility-summary) |
| Kimi CLI | [安裝](../CLIENTS.md#kimi-cli-install) | [升級](../CLIENTS.md#kimi-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [註冊/格式轉接器已測；未完成原生端到端工作階段](../CLIENTS.md#compatibility-summary) |
| Antigravity CLI | [安裝](../CLIENTS.md#antigravity-cli-install) | [升級](../CLIENTS.md#antigravity-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [註冊/格式轉接器已測；未完成原生端到端工作階段](../CLIENTS.md#compatibility-summary) |

</details>

**操作參考（英文）：** [查看操作參考](../REFERENCE.md)

**授權：** [MIT](../../LICENSE)
