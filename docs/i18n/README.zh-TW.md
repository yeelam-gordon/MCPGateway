# MCPGateway — 讓多個程式設計工作階段共用本機 MCP 後端

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

多個工作階段共用一組後端：避免記憶體重複占用、重用啟動工作，並在已驗證的 SDK/stdio 設定變更路徑保留現有 MCP 連線（從你的代理程式到閘道的現有連線）。

[開始使用](#first-use) · [相容性（英文）](../CLIENTS.md#compatibility-summary) · [證據與限制（英文）](../BENCHMARK.md) · [Copilot 更新](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="重複後端合為一組；重複啟動變為共用啟動；SDK/stdio 實驗中，現有 MCP 連線跨越工作結束後的自有閘道重啟。" width="780">

概念示意圖，使用英文標籤；不是執行畫面或效能測試。 [SVG](../../assets/mcp-gateway-benefits.svg)

- **避免重複後端記憶體:** 假設 5 × 1.5 GB 後端共用一組，計入閘道與連接器額外負擔**之前**避免 6 GB 重複占用；不是實測淨節省。
- **重用後端啟動工作:** 假設五個工作階段都使用十二個 stdio 服務，啟動次數 60 → 12；不代表啟動耗時縮短 80%。
- **保留現有 MCP 連線:** SDK/stdio 實驗僅新增設定、結束活動工作後重啟自有閘道，保留了現有連線。不是熱載入、進行中呼叫的連續性或所有原生對話介面的證明；首次註冊與執行階段升級仍可能需要重啟用戶端。 [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**適合與略過:** 適合共用同一連接器與目錄的多個工作階段。單一工作階段或輕量後端使用直接 MCP 可能更簡單。輕量測試的程序工作集總和為 357.0 → 564.0 MiB，從全新閘道啟動到首次共用請求的有用結果耗時為 1886.7 ms，對比直接模式 503.5 ms；淨效益取決於額外負擔。 [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## 首次有用結果：透過共用閘道執行已獲授權的唯讀工作

需要 Node.js 24+、npm、Git、支援外掛的 Copilot CLI，以及已設定並完成所需驗證的 MCP 整合。初次安裝透過 Copilot CLI；Windows 是主要測試平台，其他用戶端的驗證程度不同。 [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**安裝前:** 設定、私有目錄與備份可能含認證資訊，請勿公開。後端可能連線至遠端服務。安裝會建立常駐執行階段；還原用戶端設定或刪除外掛不會關閉閘道程序。 [REFERENCE](../REFERENCE.md#planned-exit) 本機私有狀態與儲存的閘道權杖僅限擁有者存取，未額外加密。

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. 啟動 Copilot CLI，執行 `/mcp-gateway-setup`。檢閱預覽，只核准預期變更；保留私人備份與回復命令。只安裝外掛不會合併設定。
2. 關閉並重新開啟 Copilot，依命令物件說明執行傳回的精確 `readinessCommand`。只檢查就緒狀態的命令不會啟動尚未執行的閘道。 [readinessCommand](../REFERENCE.md#readiness-command-object) 只儲存傳回的 JSON 物件；`.command` 是已核准的執行檔，`.args` 是保持原順序的精確引數。
3. 在既有整合中選擇無害、已獲授權的唯讀工作。只替換下方括號中的工作；別名、工具與引數必須來自探索結果及輸入結構描述，不要猜測。

> 請用共用閘道完成[我獲授權的唯讀工作]。依序使用 `list_servers`、定向 `search_tools` 與 `get_tool_schema`，以獲授權且不敏感的測試值準備符合結構描述的引數。取得正常核准；若 `requiresExclusiveAccess: true`，在 `call_tool` 前先 `claim_server` 一次，所有呼叫結束後 `release_server`；非獨佔後端不需認領。顯示實際資料或有說明的空結果，並檢查錯誤，不以收到閘道回應判定成功。結果不明時不要重試，維持封鎖並私下交由安裝負責人處理。

4. 第二個工作階段使用同一連接器與目錄查詢相同別名：應看到 `ready` 與相同目錄能力。這檢查共用探索，不證明程序身分或 RAM 節省。 [MCP](../REFERENCE.md#first-shared-workflow) [公開 echo 範例與結果](../REFERENCE.md#public-echo-illustration).

**失敗時:** 目錄為空先檢查所選設定與預覽；搜尋無結果時使用後端說明中的詞彙。驗證或就緒失敗依參考處理，不另開程序繞過閘道。獨佔結果不明時，釋放或斷線不是取消，也不能安全解除封鎖；先核對下游結果，再協調自有閘道重啟並重新認領。 [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**停止使用:** 先結束工作並等待呼叫完成，還原或移除所有相關用戶端連接器，再依負責人交接流程確認自有閘道已停止。還原設定不等於關閉程序；保留私有狀態、認證資訊、歷史與無關程序。 [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
此頁是本地化概覽；完整方法、數值出處與維運說明在英文指南。原生用戶端支援範圍不代表本地化理解已獲人工驗證。 [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
