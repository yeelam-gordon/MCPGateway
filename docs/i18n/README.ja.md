# MCPGateway — 複数の AI コーディングセッションでローカル MCP サーバーを共有

[English](../../README.md)

> これはローカライズ版の概要です。完全なインストール、アップグレード、技術情報については、英語版 [README](../../README.md) と下記リンク先の英語クライアントガイドが正本です。

## バックエンドを再利用し、ツールを必要なときに探す。

複数の Copilot CLI セッションが同じ MCP バックエンドを個別に起動する必要はありません。設定済みのローカルサービスを共有し、排他的なワークフローを調整します。企業向け API ガバナンス基盤ではありません。

**前提条件：** Node.js 24 以降、npm、Git、プラグイン対応 Copilot CLI、設定・認証済みの MCP サービス。現在の初期導入は Copilot CLI から行います。主な検証環境は Windows で、Agency は任意です。他のクライアントは互換性と検証範囲が異なります。

## 仕組み

ゲートウェイがエージェントへ公開するツールは常に 6 個です。4 個は機能の検索と呼び出し、2 個は排他的なワークフローが必要な連携に使います。接続を追加しても初期インターフェイスは増えず、完全なスキーマは選択したツールについてのみ読み込まれます。既に設定・認証済みの接続を再利用し、サービスのインストールや資格情報の提供は行いません。

1 つの共有 MCP カタログを複数のエージェントで利用できます。例えば、Copilot の **10** 接続に、対応済みの Claude 設定から **2** 個の新しい接続を明示的に移行すると、両方のエージェントが同じ **12** 接続を利用できます。

- プラグインのインストールだけでは設定は統合されません。同名の項目はエイリアス定義が完全に同一の場合だけ重複排除されます。同じサービスを指すだけでは不十分で、競合時はレビューのため停止します。
- 移行はプレビューとバックアップを先に行い、未対応のネイティブ設定を拒否します。
- すべてのネイティブクライアントでエンドツーエンドテスト済みという意味ではありません。[移行ガイド（英語）](../CLIENTS.md#cross-client-migration)を参照してください。

## クライアント別のインストールとアップグレード

共有ランタイムは現在 Copilot CLI から作成し、他のクライアントは同じ安定したコネクターへ接続します。以下は英語クライアントガイドへのリンクで、インストールとアップグレードの正本です。

| クライアント | インストール | アップグレード |
|---|---|---|
| GitHub Copilot CLI | [手順](../CLIENTS.md#copilot-cli-install) | [手順](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code（エディター） | [手順](../CLIENTS.md#vs-code-install) | [手順](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [手順](../CLIENTS.md#claude-code-install) | [手順](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [手順](../CLIENTS.md#codex-install) | [手順](../CLIENTS.md#codex-upgrade) |
| OpenCode | [手順](../CLIENTS.md#opencode-install) | [手順](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [手順](../CLIENTS.md#qwen-code-install) | [手順](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [手順](../CLIENTS.md#kimi-cli-install) | [手順](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [手順](../CLIENTS.md#antigravity-cli-install) | [手順](../CLIENTS.md#antigravity-cli-upgrade) |

設定はまずプレビューされ、承認後にのみ変更されます。非公開バックアップ、準備確認、正確なロールバックコマンドが提供されます。設定やバックアップに資格情報が含まれる場合があるため、公開またはバージョン管理へコミットしないでください。

## 最初のセットアップと呼び出し

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. プラグインのインストール後、Copilot CLI で `/mcp-gateway-setup` を実行し、プレビューを確認してから承認します。Copilot を閉じて開き直し、返された正確な `readinessCommand` を実行してください。バックアップとロールバックのコマンドを保存します。プラグインだけでは設定は統合されません。
2. `list_servers` に `{}` を渡すと、既存のエイリアス、状態、排他フラグが表示されます。許可されたバックエンドを選び、`search_tools` で目的に合う語を検索し、`get_tool_schema` で選んだツールの入力スキーマを取得します。そのスキーマに沿って引数を作り、`call_tool` で承認済みの読み取りを実行します。期待する結果は実際のレコードか、説明された空の結果です。応答があるだけでは成功とは限りません。
3. `requiresExclusiveAccess: true` の場合は検索前に `claim_server`、全呼び出し終了後に `release_server` を使います。非排他バックエンドには不要です。結果不明のタイムアウトは再試行せず、進行中の作業を確認して再起動を調整します。 結果が不明な場合、排他バックエンドはゲートウェイを再起動するまでブロックされたままです。所有権の解放やクライアントの切断では安全に解除できず、切断は操作のキャンセルを意味しません。

[英語の完全な例](../../README.md#first-use) · [互換性と制限](../CLIENTS.md#compatibility-summary)

## 制限、プライバシー、復旧

Claude Code、Codex、Gemini CLI、Kimi、Qwen CLI からこの公開文書を検索できても、ネイティブ連携を保証するものではありません。Gemini CLI の導入手順はなく、Antigravity とは別です。Kimi はアダプターのみ検証済みです。設定とバックアップには資格情報が含まれる場合があり、公開しないでください。バックエンドは外部サービスに通信する場合があります。共有はオフライン動作や一定の RAM・トークン削減を保証しません。

利用をやめる前に進行中の作業と呼び出しを完了してください。クライアント設定の復元は常駐ランタイムの停止ではありません。[利用終了と運用担当者への引き継ぎ（英語）](../REFERENCE.md#planned-exit)に従って依頼し、完了状態を確認してください。非公開の状態と資格情報は保持し、無関係なプロセスを停止しないでください。

[プライバシー](../REFERENCE.md#state-and-privacy) · [復旧とロールバック](../REFERENCE.md#setup-recovery)

**運用リファレンス（英語）：** [運用リファレンスを見る](../REFERENCE.md)

**ライセンス：** [MIT](../../LICENSE)
