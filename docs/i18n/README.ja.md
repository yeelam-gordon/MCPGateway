# MCPGateway — 複数の AI コーディングセッションでローカル MCP サーバーを共有

<a id="languages"></a>
<details>
<summary>Languages / 语言 / 言語 / اللغات (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

コーディングセッションでローカル MCP バックエンドを共有し、メモリの重複を避け、起動処理を再利用し、設定追加だけならエージェント側の既存 MCP 接続を再起動せず維持します（SDK/stdio 経路。実際の効果は追加負荷次第）。

[Copilot CLI で開始](#first-use) · [クライアント検証](../CLIENTS.md#compatibility-summary) · [証拠](#resource-examples)

<img src="../../assets/mcp-gateway-benefits.png" alt="リソース消費の大きい MCP サーバーを共用し、セッションごとの重複起動とメモリ消費を避けます。" width="780">

英語ラベルの概念図であり、実行画面やベンチマークではありません。

- **バックエンドのメモリ重複を避ける:** 仮定の例：5 × 1.5 GB の一式を共有し、ゲートウェイ・コネクターの追加負荷を含める**前**に 6 GB の重複を回避。実測の削減ではありません。
- **起動済みバックエンドを再利用し、重複起動を避ける:** 5 セッションすべてが 12 個の stdio サービスを使う仮定：バックエンド起動は 60 → 12 回。所要時間が 80% 短くなる意味ではありません。
- **バックエンド設定の追加時も既存のエージェント接続を維持:** SDK/stdio の初期化 1 回を維持し、作業完了後に所有するゲートウェイだけを再起動。コネクターは継続し、ホットリロードでも製品の会話 UI の検証でもありません。初期登録やランタイム更新ではクライアント再起動が必要な場合があります。 [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

同じバックエンドとカタログを使う複数セッション向けです。単一セッションや軽いバックエンドでは追加コストが利点を上回る場合があります。

<a id="first-use"></a>
## 最初のセットアップと呼び出し

**前提条件：** Node.js 24 以降、npm、Git、プラグイン対応 Copilot CLI、設定・認証済みの MCP サービス。現在の初期導入は Copilot CLI から行います。主な検証環境は Windows で、Agency は任意です。他のクライアントは互換性と検証範囲が異なります。

設定とバックアップには資格情報が含まれ得ます。非公開で保管し、意図した変更だけ承認してください。

[終了と常駐ランタイム](../REFERENCE.md#planned-exit) · [設定の復元では常駐ゲートウェイは停止しません（rollback ≠ daemon shutdown）](../REFERENCE.md#setup-recovery)

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. プラグインのインストール後、Copilot CLI で `/mcp-gateway-setup` を実行し、プレビューを確認してから承認します。Copilot を閉じて開き直し、返された正確な `readinessCommand` を実行してください。バックアップとロールバックのコマンドを保存します。プラグインだけでは設定は統合されません。

`readinessCommand` は返されたオブジェクトで、コマンド文字列ではありません。`$readinessCommand` に承認済み設定結果のそのオブジェクトをそのまま設定し、以下の PowerShell 例を実行します。`.command` は実行ファイルのパスを、`.args` は空白や引用符を含むパスも含め全引数を順番どおり保持します。配列を一つの引数に結合せず、パスを推測しないでください。この確認では未起動のゲートウェイは起動しません。

承認済み設定結果の `readinessCommand` JSON オブジェクトだけを（出力全体ではなく）、非公開の現在のフォルダーに UTF-8 の `readiness-command.json` として保存します。既知の承認済み `.command` と全 `.args` をそのまま保持し、結合やパスの推測はしません。この設定 JSON のみを解析し、任意の Web・サービスデータは使わないでください。JSON 解析はコード評価ではありません。引数の内容は設定によるためファイルは非公開にしてください。

```powershell
$readinessCommand = Get-Content -Raw -LiteralPath '.\readiness-command.json' | ConvertFrom-Json
$command = $readinessCommand.command
$commandArgs = @($readinessCommand.args)
& $command @commandArgs
```

探索とスキーマ取得に排他利用の予約は不要です。`requiresExclusiveAccess: true` なら `call_tool` の前に `claim_server` が必要です。

> 共有ゲートウェイで[許可された読み取り専用タスク]を行ってください。設定済みサーバーを一覧し、適切なツールを探し、スキーマを確認して許可済みの非機密テスト値で引数を準備してください。通常の承認を得て、排他実行前に予約し、呼び出し完了後に解除してください。実際の結果を示し、結果不明なら再試行せずインストール担当者に引き継いでください。

[SDK tool flow: `list_servers` → `search_tools` → `get_tool_schema` → `claim_server` (exclusive) → `call_tool` → `release_server`](../../README.md#first-use) · [REFERENCE](../REFERENCE.md#unknown-exclusive-result)

2. `list_servers` に `{}` を渡すと、既存のエイリアス、状態、排他フラグが表示されます。許可されたバックエンドを選び、`search_tools` で目的に合う語を検索し、`get_tool_schema` で選んだツールの入力スキーマを取得します。そのスキーマに沿って引数を作り、`call_tool` で承認済みの読み取りを実行します。期待する結果は実際のレコードか、説明された空の結果です。応答があるだけでは成功とは限りません。
3. `requiresExclusiveAccess: true` の場合は呼び出し前に `claim_server`、全呼び出し終了後に `release_server` を使います。非排他バックエンドには不要です。結果不明のタイムアウトは再試行せず、進行中の作業を確認して再起動を調整します。 結果が不明な場合、排他バックエンドはゲートウェイを再起動するまでブロックされたままです。予約の解除やクライアントの切断では安全に解除できず、切断は操作のキャンセルを意味しません。
4. 2 番目のセッションで同じコネクターとカタログを使い、同じ別名で `list_servers` / `search_tools` を繰り返します。初期化済みバックエンドは `ready`、検索は同じカタログの機能を返すはずです。別名の一致だけではプロセス同一性や RAM 削減を証明できません。プロセス再利用は公開試験を参照してください。 [プロセス再利用の方法](../BENCHMARK.md#method) · [カタログキャッシュ試験](../../test/catalog-scale.test.js)

一覧が空なら、選んだ設定と移行プレビューを確認してください。検索結果がなければ、バックエンド自身のツール説明にある具体的な語で絞り込みます。共通のツール名はありません。認証エラーや準備確認の失敗は[認証](../REFERENCE.md#native-http-oauth)と[設定の復旧・ロールバック](../REFERENCE.md#setup-recovery)に従い、呼び出しを繰り返したり別プロセスで迂回したりしないでください。

[英語の完全な例](../../README.md#first-use) · [互換性と制限](../CLIENTS.md#compatibility-summary)

## 制限、プライバシー、復旧

Claude Code、Codex、Gemini CLI、Kimi、Qwen CLI からこの公開文書を検索できても、ネイティブ連携を保証するものではありません。Gemini CLI の導入手順はなく、Antigravity とは別です。Kimi はアダプターのみ検証済みです。設定とバックアップには資格情報が含まれる場合があり、公開しないでください。バックエンドは外部サービスに通信する場合があります。共有はオフライン動作や一定の RAM・トークン削減を保証しません。

利用をやめる前に進行中の作業と呼び出しを完了してください。クライアント設定の復元は常駐ランタイムの停止ではありません。[利用終了と運用担当者への引き継ぎ（英語）](../REFERENCE.md#planned-exit)に従って依頼し、完了状態を確認してください。非公開の状態と資格情報は保持し、無関係なプロセスを停止しないでください。

[プライバシー](../REFERENCE.md#state-and-privacy) · [復旧とロールバック](../REFERENCE.md#setup-recovery)

<a id="resource-examples"></a>

**重複するバックエンドのメモリを削減**

測定結果ではなく仮定の例です。5 つのエージェントセッションがそれぞれ同じ 12 接続を必要とし、バックエンド一式が 1.5 GB を使用するとします。互換性のあるセッションは同じコネクターとカタログを通じて実際のバックエンドプロセスを共有します。

| 構成 | バックエンドのメモリ |
|---|---|
| 個別に起動 | 5 × 1.5 GB = 7.5 GB |
| 一式を共有 | 1.5 GB + ゲートウェイとコネクターの追加メモリ |

追加メモリを含める前の重複削減量：7.5 GB - 1.5 GB = 6 GB。全体の削減量は実測まで不明です。1.5 GB はワークロードやクライアントによらない定数ではなく、5 個のモデルのメモリ削減でもありません。

**起動処理も再利用します。** 12 個の stdio バックエンドを 5 セッションすべてで使う仮定では、個別起動は最大 `5 × 12 = 60` 回、共有は `12` 回です。重複起動を `60 - 12 = 48` 回、つまり `48 / 60 × 100 = 80%` 減らせます。遅延接続では使用する `k` 個のみ接続し、未使用のバックエンドは起動しません。起動回数の計算であり、所要時間が 80% 短くなる意味ではありません。起動遅延は未測定で、並列処理、認証、プラットフォームで変わります。

1000 個のバックエンドツール → 初期ゲートウェイ定義 6 個：(1000 - 6) / 1000 × 100 = 99.4% は定義数の削減率であり、トークンの削減率ではありません。後で取得するスキーマにはコストがあり、既に遅延読み込みするクライアントでは効果が小さい場合があります。合成カタログのテストは 6 ツールと 2 クライアントの探索キャッシュ共有を検証しますが、RSS 性能は測りません。 [catalog-scale.test.js](../../test/catalog-scale.test.js)

**軽量なテストシナリオの実測：プロセスのワーキングセット合計が増加** Windows x64 / Node 24.13.1、3 回の中央値：共有のスキーマ取得＋echo は未初期化バックエンド 426.2 ms、2 番目のクライアント 21.1 ms、5 番目 19.0 ms。最初のクライアント全体は直接 503.5 ms、ゲートウェイ起動済みの共有 894.3 ms、完全なコールド共有起動 1886.7 ms。バックエンドプロセスは 5 → 1 ですが、全プロセスは 5 → 7、ワーキングセット合計は 357.0 MiB → 564.0 MiB と悪化しました。echo 1 ツールの試験は重い実サービスを代表しません。上の 1.5 GB は別の仮定で、実測値ではありません。 [BENCHMARK.md](../BENCHMARK.md)

測定値は各プロセスのワーキングセットの合計です。重複を除いた物理メモリとプライベートバイト（private bytes）は未測定です。

<a id="mechanism"></a>
<a id="バックエンドを再利用しツールを必要なときに探す"></a>

## 仕組み

バックエンド追加時にエージェント側の既存 MCP 接続を再起動する必要はありません。追加設定を同期し、作業終了後に所有するゲートウェイだけを再起動すると、現行コネクターが再接続します。 [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

SDK/stdio 試験では同じコネクターと MCP 接続でゲートウェイ再起動後に新しい別名を発見し echo を実行できました。各製品の会話 UI は未検証です。自動ホットリロードではなく、別名競合は要確認です。初期登録やランタイム更新ではクライアント再起動が必要な場合があります。中断された呼び出しは再実行せず、再起動後は排他利用を再予約します。

企業向け API ガバナンス基盤ではありません。

ゲートウェイがエージェントへ公開するツールは常に 6 個です。4 個は機能の検索と呼び出し、2 個は排他的なワークフローが必要な連携に使います。接続を追加しても初期インターフェイスは増えず、完全なスキーマは選択したツールについてのみ読み込まれます。既に設定・認証済みの接続を再利用し、サービスのインストールや資格情報の提供は行いません。

```text
エージェント A ─┐                           ┌─ 連携サービス A: 複数のツール
エージェント B ─┼─ コネクター ─ MCPGateway ─┼─ 連携サービス B: 複数のツール
エージェント C ─┘                           └─ 連携サービス C: 複数のツール
```

複数のエージェントが同じコネクター経由で MCPGateway を利用し、設定済みのバックエンドから必要なものに接続します。図は共有の仕組みを示すもので、ベンチマークや動作検証ではなく、すべてのバックエンドの起動を意味しません。

<a id="clients"></a>
## クライアント別のインストールとアップグレード

> これはローカライズ版の概要です。完全なインストール、アップグレード、技術情報については、英語版 [README](../../README.md) と下記リンク先の英語クライアントガイドが正本です。

<details>
<summary>クライアント別のインストールとアップグレード</summary>

1 つの共有 MCP カタログを複数のエージェントで利用できます。例えば、Copilot の **10** 接続に、対応済みの Claude 設定から **2** 個の新しい接続を明示的に移行すると、両方のエージェントが同じ **12** 接続を利用できます。

- プラグインのインストールだけでは設定は統合されません。同名の項目はエイリアス定義が完全に同一の場合だけ重複排除されます。同じサービスを指すだけでは不十分で、競合時はレビューのため停止します。
- 移行はプレビューとバックアップを先に行い、未対応のネイティブ設定を拒否します。
- すべてのネイティブクライアントでエンドツーエンドテスト済みという意味ではありません。[移行ガイド（英語）](../CLIENTS.md#cross-client-migration)を参照してください。

| クライアント | インストール | アップグレード | 必要な初期導入 | 検証範囲 |
|---|---|---|---|---|
| GitHub Copilot CLI | [手順](../CLIENTS.md#copilot-cli-install) | [手順](../CLIENTS.md#copilot-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [マーケットプレース・導入経路；隔離設定解析](../CLIENTS.md#compatibility-summary) |
| VS Code（エディター） | [手順](../CLIENTS.md#vs-code-install) | [手順](../CLIENTS.md#vs-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [登録・形式アダプター検証済み；ネイティブ一連のセッション未検証](../CLIENTS.md#compatibility-summary) |
| Claude Code | [手順](../CLIENTS.md#claude-code-install) | [手順](../CLIENTS.md#claude-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [隔離設定の解析済み；モデル・バックエンド未起動](../CLIENTS.md#compatibility-summary) |
| Codex CLI | [手順](../CLIENTS.md#codex-install) | [手順](../CLIENTS.md#codex-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [ネイティブ検証は管理ポリシーで阻止](../CLIENTS.md#compatibility-summary) |
| OpenCode | [手順](../CLIENTS.md#opencode-install) | [手順](../CLIENTS.md#opencode-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [登録・形式アダプター検証済み；ネイティブ一連のセッション未検証](../CLIENTS.md#compatibility-summary) |
| Qwen Code | [手順](../CLIENTS.md#qwen-code-install) | [手順](../CLIENTS.md#qwen-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [登録・形式アダプター検証済み；ネイティブ一連のセッション未検証](../CLIENTS.md#compatibility-summary) |
| Kimi CLI | [手順](../CLIENTS.md#kimi-cli-install) | [手順](../CLIENTS.md#kimi-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [登録・形式アダプター検証済み；ネイティブ一連のセッション未検証](../CLIENTS.md#compatibility-summary) |
| Antigravity CLI | [手順](../CLIENTS.md#antigravity-cli-install) | [手順](../CLIENTS.md#antigravity-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [登録・形式アダプター検証済み；ネイティブ一連のセッション未検証](../CLIENTS.md#compatibility-summary) |

</details>

**運用リファレンス（英語）：** [運用リファレンスを見る](../REFERENCE.md)

**ライセンス：** [MIT](../../LICENSE)
