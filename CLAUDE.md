# nch

ultrathink.

P2P 匿名掲示板。ブラウザ完結。
タスク実行前に本ファイルと `.claude/skills/` 配下の関連スキルを参照すること。

## MVP スコープ

- React + TypeScript、ブラウザのみで動作
- 1板 1スレ固定
- ゴシッププロトコルでレス伝播（ファンアウト 5）
- WebRTC DataChannel、IPv6 のみ
- シグナリングサーバーは別立て（WebSocket）
- コンテンツハッシュ + Ed25519 署名で改竄検知

## Tech Stack

- **Language:** TypeScript (strict)
- **UI:** React + Vite + Tailwind CSS
- **P2P:** WebRTC DataChannel
- **Signaling:** WebSocket
- **Crypto:** Web Crypto API (Ed25519, SHA-256)
- **Storage:** IndexedDB
- **Test:** Vitest + React Testing Library
- **Lint / Format:** Biome
- **Git Hooks:** husky + lint-staged

## Architecture

Clean Architecture。依存方向は UI → UseCase → Domain ← Adapter。

- **Domain:** 型定義と純粋ロジック。React や WebRTC に依存しない。Peer 型は id と connectedAt のみ持ち、WebRTC の型は含まない
- **UseCase:** ビジネスロジック。Domain のインターフェースに依存し、Adapter の実装には依存しない
- **Adapter:** 外部接続の実装。Domain のインターフェースを実装する。ブラウザ版（WebRTC）と Node.js 版（シードノード用）の2実装がありうる。Domain/UseCase はどちらかを知らない
- **UI:** React コンポーネント。UseCase を呼ぶのは Smart Component のみ

### DIP

UseCase は Domain 層の抽象インターフェースに依存する。Adapter 層の具象を直接 import しない。Smart Component が Adapter の実体を UseCase に注入する。

### Smart / Dumb

UseCase を import できるのは Smart Component のみ。他はすべて Dumb で、データは props で受け取る。UI 固有の閉じた状態（入力欄の値等）のみ自身で管理してよい。

### シグナリングとピア発見

シグナリングサーバーはブートストラップ。役割は「最初の1ピアを紹介する」だけ。接続確立後のピア発見はゴシップネットワーク経由で行う。シグナリングサーバー同士は同期不要で、誰でも立てられる。複数存在してよい。

### シードノード

Node.js で動くヘッドレスピア。24時間稼働し過去ログを保持する。他のピアと対等で管理権限や特権はない。ブラウザのノードと同じ UseCase/Domain コードを使い、Adapter 層だけが異なる。MVP ではシグナリングサーバーと同じマシンで動かす。

### CryptoService パターン

暗号操作は CryptoService（domain/service）に統合する。

- **ステートレスな操作**（verifySignature, computePostHash, verifyPostHash）は CryptoService が直接実装する。crypto.subtle はブラウザ組み込みAPIなので domain に置いてよい
- **ステートフルな操作**（generateKeyPair, sign, deriveOdId）は ISigner ポート（domain/port）を経由して Adapter（WebCryptoSigner）に委譲する。秘密鍵の保持が必要なため

UseCase は CryptoService のみに依存する。

### 永続化

InMemoryPostStore の裏に IndexedDB を足すハイブリッド構成。起動時に IndexedDB → メモリ読み込み。save 時にメモリ + IndexedDB 両方に書く。getSnapshot は常にメモリから返す（同期、useSyncExternalStore 互換）。セッション鍵（CryptoKey）も IndexedDB に保存（extractable: false のまま structured clone）。

### 投稿順序（Lamport clock）

スレ内の投稿順序は Lamport clock で決定する。各ノードがスレ単位で整数カウンタを持つ。

- 投稿時: `max(自カウンタ, 受信済み最大値) + 1` を投稿の lamport に設定
- 受信時: `max(自カウンタ, 受信した投稿の lamport)` でカウンタ更新。+1 しない
- 表示順: lamport 昇順。同値の場合は post.id（コンテンツハッシュ）昇順で安定ソート

lamport は署名ペイロードおよびコンテンツハッシュの計算に含める。timestamp（Unix ms）は表示用のみで、順序保証には使わない。

### ドメインモデル

- Post は boardId, threadId を持つ（「このレスはこのスレに属する」はドメインルール）
- Post は displayNumber を持たない。displayNumber は UI 層で lamport ソート後のインデックスから派生する表示ラベル。つまり、UI層にて`type DisplayPost = Post & { readonly displayNumber: number };`のような形で付与する。
- 安価（`>>5`）の表示上の数字は displayNumber だが、リンク先は post.id（コンテンツハッシュ）で解決する。P2P ではノード間で displayNumber がズレうるため
- GossipMessage は Post を運ぶ封筒。boardId/threadId は持たない（Post が持つ）
- IPostStore.save(post) は post.threadId で保存先を決定する

## ユビキタス言語

コード上の命名はこの用語に従う。新規用語が必要になったら本セクションに追記すること。

| 用語 | 英語 | 意味 |
|------|------|------|
| 板 | Board | スレッドの集合 |
| スレ | Thread | レスの集合 |
| レス | Post | 1つの書き込み |
| ピア | Peer | 接続中の他ノAード |
| ファンアウト | Fanout | 転送先の数（固定5） |
| ゴシップ | Gossip | レスの伝播プロトコル |
| シグナリング | Signaling | ピア発見（WebSocket） |
| OD ID | OD ID | セッション鍵由来の表示用ID |
| Lamport クロック | LamportClock | lamport カウンタを管理する domain service。 |
| エンベロープ | GossipMessage | Post を運ぶ封筒。 |
| シードノード | Seed Node | 常駐するヘッドレスピア。他のピアと対等 |
| 暗号サービス | CryptoService | crypto 系操作の統合ファサード |
| 署名者 | ISigner / WebCryptoSigner | 秘密鍵を保持しステートフルな暗号操作を行う |
| ダイジェスト | ThreadDigest | スレの要約情報。threadId / maxLamport / postCount を含む |
| 投稿可能 | Postable | 接続中のピア全員から digest を受信し、投稿フォームが有効化された状態 |
| データ同期ゲートウェイ | IDataSyncGateway | digest と sync の両方を扱うピア間通信インターフェース。WebRTCGateway が実装する |
| 投稿インジェスター | PostIngester | 署名・ハッシュ検証・重複排除・保存・clock merge を担う domain service。gossip と sync で共有 |

## Implementation Rules

### 命名

ドメインの意図を表現する。ユビキタス言語に従う。
`handleClick` → `postMessage`。`DataList` → `ThreadView`。

### Error Handling

エラーは回復戦略で3種に分類する。

- **retry:** ピア接続失敗、シグナリング一時切断、DataChannel 送信失敗。Adapter 層で自動リトライし、UseCase には成功か最終失敗かだけを返す
- **ignore:** 署名検証失敗、ハッシュ不一致。不正メッセージを捨ててログに記録。ユーザーには見せない
- **fatal:** Web Crypto API 非対応、IndexedDB 容量不足、シグナリングに一切繋がらない。UI まで伝播して表示する

Domain 層で NchError（code + recovery + message）を定義する。Adapter 層で外部例外をキャッチして NchError に変換する。

### Logging

ブラウザ完結のため送り先はない。console に構造化ログを出す。
domain/port に ILogger を定義し、adapter で ConsoleLogger を実装する。UseCase にコンストラクタで注入する。

ログはイベントIDで識別する。メッセージ文字列ではなくイベントIDでテスト・検索する。
イベントIDは必要になったら追加する。最初から全部決めない。

### コードの水準

CS 学部卒が読んで理解できる水準を保つ。高度なパターンや過剰な抽象化を避け、素直な実装を優先する。

### 計算量

ゴシップ伝播はホットパス。重複判定は Set で O(1)、ファンアウト先選択は O(k) で k 固定。ホットパス以外では過剰な最適化を避ける。

### Coding Workflow

1. Domain の型と Repository インターフェースを定義
2. UseCase を実装（Adapter 実装には依存しない）
3. Adapter を実装
4. UI で繋ぐ

## Testing

Vitest。カバレッジはユニットテストで追う。結合・E2E は MVP では後回し。

### 命名規則

`test_Action_Condition_Result`

### Level 1: Domain

純粋 TS の検証。モック不要。

### Level 2: UseCase

Repository / Adapter をモック。ビジネスロジックの正当性を検証。エッジケースを重点的に。

### Level 3: Component

Dumb は props + `vi.fn()` で表示・発火を検証。Smart は UseCase モックで繋ぎこみを検証。

## Code Quality

### tsconfig

`strict: true`, `noUncheckedIndexedAccess: true`。

### Biome

`noExplicitAny: error`。推奨ルールセットを有効化。

### husky + lint-staged

コミット時にステージ済み `.ts/.tsx` に対して Biome チェック + 関連テスト実行。不合格ならコミット不可。

## Three Amigos

feature 着手前に 3 視点で仕様を叩く。

- **PO:** nch の思想に合うか？ 複数板・スレへの拡張に支障はないか？
- **Dev:** Clean Arch 的に実装可能か？ WebRTC の制約は？ 計算量は？
- **QA:** エッジケースは？ ピア離脱、同時投稿、順序保証は？

ユーザーの意思決定後、実装チケットを出力する:

```
## [タイトル]
### 受け入れ条件
- [ ] ...
### エッジケース
- ...
### 影響範囲
- 変更対象レイヤー
### 見積もり
- S / M / L
```

## Skills & Sub-agents

### プロジェクト固有スキル

- `.claude/skills/nch-p2p-core/SKILL.md` — P2P 層の実装ガイドライン
- `.claude/skills/nch-testing/SKILL.md` — P2P テスト戦略

### Sub-agents

| agent | 役割 | スキル |
|-------|------|--------|
| core-architect | domain / usecase / adapter の設計・実装・テスト | nch-p2p-core |
| ui-builder | React UI 層 | frontend-design |
| qa-reviewer | テスト設計・レビュー | nch-testing, webapp-testing |
