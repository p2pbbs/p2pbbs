# nch

ブラウザ完結の P2P 匿名掲示板

## 背景

2026年3月、米レジストラの判断で 5ch.net のドメインが剥奪され掲示板が一時停止した。
同じことは DNS・CDN・データセンター・ISP の全レイヤーで起こりうる。
単一障害点を持たない掲示板の実証として、P2P でテキスト掲示板を動かす。

P2P にする目的は、有害な投稿を許容・保護することではなく、コミュニティ外の単一主体の恣意的判断でプラットフォーム全体が停止する構造を解消すること。法執行機関の介入を妨げる意図はなく、公開後に有害投稿が蔓延し、有効な対策を打てる見込みがない場合は予告なしに閉鎖する可能性がある。

## MVP 仕様

- ブラウザ完結（インストール不要）
- 1板 1スレ固定
- ゴシッププロトコルでレス伝播（ファンアウト 5）
- WebRTC DataChannel でピア間通信
- IPv6 のみ（NAT traversal を回避）
- TURN なし。STUN は余裕があれば
- シグナリングサーバーは別立て（WebSocket）
- コンテンツハッシュ + Ed25519 署名で改竄検知

## 検証したいこと

1. ゴシップ伝播のレイテンシは実用的か
2. ノードの出入りにネットワークは耐えるか
3. ハッシュ + 署名で改竄検知が機能するか
4. 「URL を開くだけ」で人が集まるか

## Tech Stack

React + TypeScript + Vite + Tailwind CSS。Biome で lint/format 統一。Vitest でテスト。

P2P にブラウザ完結を求めると WebRTC DataChannel 一択。
シグナリングだけ WebSocket で別立て。これが唯一の中央要素で、将来的に冗長化 or DHT 化を検討する。

## アーキテクチャ

Clean Architecture。依存方向は UI → UseCase → Domain ← Adapter。
通常のクラサバと違い、バックエンドサーバーが存在しない。DB の代わりに IndexedDB、サーバーの代わりにピアネットワークが来る。

### なぜ Clean Architecture か

P2P 掲示板は Adapter 層の入れ替えが頻繁に起こりうる（WebRTC の実装変更、ストレージの変更、シグナリングプロトコルの変更）。UseCase と Domain がこれらに依存しないことで、P2P 層の実験と改善を高速に回せる。

### レイヤー構成

**Domain** — 型定義（Board, Thread, Post, Peer, GossipMessage）と純粋ロジック（ハッシュ、署名検証）。外部依存なし。

**UseCase** — ここが厚い。投稿（署名→保存→ゴシップ発火）、受信（検証→重複判定→保存→再ファンアウト）、ネットワーク参加、過去ログ同期。

**Adapter** — ここも厚い。WebRTC DataChannel 管理、ゴシップ伝播（ファンアウト制御）、WebSocket シグナリング、IndexedDB 保存、Web Crypto API ラッパー。

**UI** — ここは薄い。Smart/Dumb 分離のみ。Smart Component だけが UseCase を呼ぶ。Atomic Design は入れない（MVP の UI 要素が少なすぎる）。

### ドメインモデル

5ch の主要概念を Board（板）→ Thread（スレ）→ Post（レス）の3層で表現。
Post にはコンテンツハッシュ（投稿ID兼改竄検知）、Ed25519 署名、セッション由来の OD ID を持たせる。
GossipMessage は Post を運ぶエンベロープで、TTL とパス情報でループ防止と伝播制限を行う。

MVP では板もスレも1つ固定だが、型に boardId / threadId を持たせることで複数板・複数スレへの拡張を可能にしている。

## 開発プロセス

### Three Amigos

feature 着手前に PO / Dev / QA の3視点で仕様を叩く。Gherkin は出力しない。
ユーザーの意思決定後、実装チケットに落とす。

### Sub-agents（Claude Code）

| agent | 役割 |
|-------|------|
| core-architect | domain / usecase / adapter の設計・実装・テスト |
| ui-builder | React UI 層 |
| qa-reviewer | テスト設計・レビュー |

### テスト

ユニットテスト中心。P2P の性質上、通信周りのエッジケース（不正署名、重複メッセージ、ピア離脱、TTL切れ）を重点的にカバーする。結合・E2E は MVP では後回し。

## 将来の課題（MVP 後）

- 複数板・複数スレ対応
- IPv4 / NAT traversal
- PoW によるスパム対策と鍵量産防止
- クライアント側フィルタリング（共有 NG リスト）
- 過疎スレの永続化戦略
- シグナリングサーバーの冗長化 / 脱中央化
- 1000レス制限、sage、安価

## 先行事例

- 新月: https://shingetsu.info/index.ja
- WebRTC BBS: https://github.com/tsujio/webrtc-bbs

## inspired by

https://mevius.5ch.io/test/read.cgi/tech/1772805675/