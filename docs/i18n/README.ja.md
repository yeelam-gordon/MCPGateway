# MCPGateway — 複数のコーディングセッションでローカル MCP バックエンドを共有

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

複数のセッションで一組のバックエンドを共有し、メモリの重複と起動のやり直しを避けます。検証済みの SDK/stdio 設定変更経路では、既存の MCP 接続を維持できます（エージェントからゲートウェイへの既存の接続）。

[使い始める](#first-use) · [互換性（英語）](../CLIENTS.md#compatibility-summary) · [根拠と制限（英語）](../BENCHMARK.md) · [Copilot の更新](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="重複したバックエンドを一組にまとめ、起動処理を共有する。SDK/stdio 実験では、作業完了後の自分が管理するゲートウェイ再起動をまたいで既存の MCP 接続を維持する。" width="780">

英語ラベルの概念図です。実行画面やベンチマークではありません。 [SVG](../../assets/mcp-gateway-benefits.svg)

- **バックエンドのメモリ重複を避ける:** 5 × 1.5 GB の一式を共有する仮定では、ゲートウェイ・コネクターの追加負荷を含める**前**に 6 GB の重複を回避します。実測の純削減ではありません。
- **バックエンドの起動処理を再利用:** 5 セッションすべてが 12 個の stdio サービスを使う仮定で、起動は 60 → 12 回。所要時間が 80% 短くなる意味ではありません。
- **既存の MCP 接続を維持:** SDK/stdio 実験では設定追加のみを行い、作業完了後に自分が管理するゲートウェイを再起動して接続を維持しました。ホットリロード、実行中の呼び出し継続、全製品の会話 UI の証明ではありません。初期登録やランタイム更新ではクライアント再起動が必要な場合があります。 [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**適する場合・見送る場合:** 同じコネクターとカタログを使う複数セッション向けです。1 セッションや軽量バックエンドなら直接 MCP のほうが簡単な場合があります。軽量試験のプロセス・ワーキングセット合計は 357.0 → 564.0 MiB、ゲートウェイを新規起動して最初の共有リクエストの有用な結果を得るまでの時間は 1886.7 ms、直接接続は 503.5 ms。正味のリソース節約は追加負荷次第です。 [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## 最初の有用な結果：共有ゲートウェイで許可された読み取りを行う

Node.js 24+、npm、Git、プラグイン対応 Copilot CLI、設定・必要な認証を済ませた MCP 連携が必要です。初期導入は Copilot CLI 経由で、主な検証環境は Windows。クライアントごとに検証範囲が異なります。 [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**インストール前に:** 設定、非公開カタログ、バックアップには資格情報が含まれる場合があります。公開しないでください。バックエンドは外部サービスと通信する場合があります。常駐ランタイムが作成され、設定復元やプラグイン削除ではゲートウェイは停止しません。 [REFERENCE](../REFERENCE.md#planned-exit) ローカルの非公開状態と保存されたゲートウェイトークンは所有者のみアクセス可能で、追加の暗号化はありません。

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Copilot CLI で `/mcp-gateway-setup` を実行します。プレビューを確認し、意図した変更だけ承認してください。非公開バックアップと復元コマンドを保存します。プラグインだけでは設定は統合されません。
2. Copilot を閉じて開き直し、コマンドオブジェクトの説明に従って返された正確な `readinessCommand` を実行します。確認専用コマンドは停止中のゲートウェイを起動しません。 [readinessCommand](../REFERENCE.md#readiness-command-object) 返された JSON オブジェクトだけを保存します。`.command` は承認済み実行ファイル、`.args` は順序を保つ正確な引数です。
3. 既存の連携で無害な許可済み読み取りを選びます。以下の括弧内のタスクだけ置き換えてください。別名、ツール、引数は探索とスキーマから取得し、推測しないでください。

> 共有ゲートウェイで[許可された読み取り専用タスク]を行ってください。`list_servers`、絞り込んだ `search_tools`、`get_tool_schema` の順に使い、許可済みの非機密テスト値からスキーマに合う引数を準備してください。通常の承認を得てください。`requiresExclusiveAccess: true` なら `call_tool` の前に一度 `claim_server`、全呼び出し完了後に `release_server` を使います。非排他バックエンドに予約は不要です。実際のレコードか説明付きの空結果を示し、エラーを確認してください。応答だけで成功とは判断しません。結果不明なら再試行せずブロックを保ち、導入担当者に非公開で引き継いでください。

4. 同じコネクターとカタログを使う2番目のセッションで同じ別名を検索します。`ready` と同じ機能が期待されます。共有探索の確認であり、プロセス同一性や RAM 削減の証明ではありません。 [MCP](../REFERENCE.md#first-shared-workflow) [公開 echo の例と結果](../REFERENCE.md#public-echo-illustration).

**失敗したら:** 空のカタログは選択した設定とプレビューを確認し、検索はバックエンド説明の語で絞ります。認証・準備確認の失敗は参考手順に従い、並行プロセスで迂回しないでください。排他呼び出しの結果不明時、解除や切断はキャンセルや安全な解除ではありません。下流の結果を照合して自分が管理するゲートウェイの再起動を調整し、新たに予約してください。 [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**利用をやめる:** 作業と呼び出しを完了し、対象クライアントのコネクターを復元・削除してから、担当者への引き継ぎに従い自分が管理するゲートウェイの停止を確認します。設定復元は停止ではありません。非公開状態、資格情報、履歴、無関係なプロセスは保持します。 [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
これは日本語の概要です。方法、数値の出典、運用詳細は英語ガイドにあります。ネイティブクライアントの対応範囲と、利用者による日本語理解の検証は別です。 [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
