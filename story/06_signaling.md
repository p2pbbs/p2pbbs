# Story 6: 別のブラウザで投稿したレスが表示される（WebRTC）

## ユーザーストーリー

掲示板を異なるブラウザ（またはマシン）で開いたユーザーとして、片方で投稿したレスがもう片方に表示される。

## 受け入れ条件

- [ ] Chrome と Firefox など異なるブラウザ間で投稿が伝播する
- [ ] 異なるマシン間で投稿が伝播する（IPv6）
- [ ] Phase 1 と同じ表示順（lamport 昇順 → post.id 昇順）
- [ ] 署名・ハッシュ検証が WebRTC 経由でも動作する
- [ ] ブラウザを閉じても他のピア同士の通信に影響しない
- [ ] シグナリングサーバーが落ちても既存ピア同士は通信を継続できる

## 設計判断（共通）

### Peer ID と OD ID の区別

| | OD ID | Peer ID |
|---|---|---|
| 用途 | 投稿者の表示用 ID | ネットワーク上のノード識別 |
| スコープ | 同一ブラウザで共通 | タブごとにユニーク |
| 生成 | セッション公開鍵ハッシュ先頭8文字 | タブ起動時のランダム UUID |
| 使う場所 | Post.odId | シグナリング、GossipMessage.path、ピア管理 |

同一ブラウザの2タブは同じ OD ID だが異なる Peer ID を持つ。別ノードとして扱われる。

### エラー設計

#### SignalingErrorCode

```typescript
export const SignalingErrorCode = {
  CAPACITY_EXCEEDED: "capacity_exceeded",
  INVALID_MESSAGE: "invalid_message",
} as const;

export type SignalingErrorCode =
  typeof SignalingErrorCode[keyof typeof SignalingErrorCode];
```

#### エラー通知フロー

エラーの詳細は通常メッセージ（`type: "error"`）で通知してから、標準の WebSocket close code で切断する。独自の close code は使わない。

- `1000` — 正常切断
- `1001` — サーバーシャットダウン
- `1008` — ポリシー違反（容量超過、不正メッセージ）

#### クライアント側のエラー変換

| 状況 | recovery | code |
|------|----------|------|
| 接続失敗 / 切断 | retry（ライブラリが自動再接続） | `signaling.connection_failed` |
| 容量超過 | retry（ライブラリが自動再接続） | `signaling.capacity_exceeded` |
| ピア 0 件 | retry（定期再要求） | `signaling.no_peers` |
| 不正メッセージ受信 | ignore | `signaling.invalid_message` |

シグナリングのエラーは fatal にしない。既存の DataChannel が生きていれば投稿と閲覧は続けられる。

#### UI 表示

| 状態 | 表示 |
|------|------|
| ピア 0、シグナリング接続済み | 「他のユーザーを待っています」 |
| ピアあり | 表示なし（正常状態） |
| シグナリングにも繋がらない + ピア 0 | 「ネットワークに接続できません」 |

操作はブロックしない。ステータス表示のみ。

---

## [6a] シグナリング基盤（core 側）

### 受け入れ条件

- [ ] ISignalingTransport インターフェースが domain/port に定義されている
- [ ] SignalingEnvelope / SignalingPayload の型が zod スキーマ付きで定義されている
- [ ] SignalingErrorCode が const 定義されている
- [ ] WebSocketSignalingTransport が ISignalingTransport を実装している
- [ ] クライアント側 WebSocket に `reconnecting-websocket` を使用し、自動再接続が動作する
- [ ] WebSocket 接続時に `join`（Peer ID 付き）を送信し、ピアリストを受け取れる
- [ ] SDP offer/answer と ICE candidate を SignalingEnvelope として送受信できる
- [ ] DataChannelMessage 型が定義されている（`gossip` | `heartbeat`）
- [ ] heartbeat の送信ロジック（30秒間隔）と dead 判定（90秒タイムアウト）が実装されている
- [ ] constants に SIGNALING_URL のデフォルト値が定義されている
- [ ] 不正な JSON / スキーマ不一致の受信でクラッシュしない（safeParse）
- [ ] Peer ID（タブごとのランダム UUID）を App.tsx の初期化で生成している
- [ ] GossipMessage.path が OD ID ではなく Peer ID を使用している
- [ ] PostMessageUseCase の path 初期値が Peer ID になっている
- [ ] ReceiveMessageUseCase の selfId が Peer ID になっている
- [ ] Phase 1 の既存テストが Peer ID ベースに修正されている

### 設計判断

#### DataChannelMessage

WebRTC 接続確立後、DataChannel 上で区別する2種類のメッセージ。

```typescript
type DataChannelMessage =
  | { type: "gossip"; message: GossipMessage }
  | { type: "heartbeat" }
```

heartbeat はゴシップに乗せない。DataChannel の直接通信。

#### heartbeat

- 間隔 30 秒、タイムアウト 90 秒（3回分）
- 一方的に送りつける。応答を求めない
- 双方が送り合うので、片方だけ生きてる場合も検知できる
- 相手からの heartbeat が 90 秒来なかったら dead → active から除去
- ICE state は参照しない、beforeunload も実装しない

#### WebSocket ライブラリ

クライアント側は `reconnecting-websocket` を使用する。指数バックオフによる自動再接続が組み込まれており、再接続ロジックを自前実装しない。

#### 将来の拡張ポイント

- DataChannelSignalingTransport: ISignalingTransport の DataChannel 実装（PoC 後）
- GossipMessage に `type: "signaling"` 追加（PoC 後）

### エッジケース

- WebSocket 接続失敗 → reconnecting-websocket が自動リトライ
- シグナリングサーバーからピアが 0 件返される → 待機状態。定期的に再要求
- WebSocket が途中で切断 → reconnecting-websocket が自動再接続、再 join

### 影響範囲

- `core/domain/port/ISignalingTransport.ts`（新規）
- `core/domain/model/SignalingEnvelope.ts`（新規、zod スキーマ付き）
- `core/domain/model/DataChannelMessage.ts`（新規、zod スキーマ付き）
- `core/domain/model/SignalingErrorCode.ts`（新規）
- `core/adapter/signaling/WebSocketSignalingTransport.ts`（新規）
- `core/config/constants.ts`（SIGNALING_URL, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS 追加）
- `package.json`（reconnecting-websocket 追加）
- `ui/App.tsx`（Peer ID 生成を追加）
- `core/usecase/PostMessageUseCase.ts`（path の初期値を Peer ID に変更）
- `core/usecase/ReceiveMessageUseCase.ts`（selfId を Peer ID に変更）
- `tests/`（path / selfId 関連のテストを Peer ID ベースに修正）

### 見積もり

M

---

## [6b] シグナリングサーバー

### 受け入れ条件

- [ ] Node.js + Express + ws で WebSocket サーバーが動作する
- [ ] `join`（Peer ID 付き）を受信したら接続中ピアからランダムに最大3件を返す
- [ ] SignalingEnvelope を受信したら `to` に該当するピアの WebSocket に転送する
- [ ] 投稿データは一切通さない（中継するのは SignalingEnvelope のみ）
- [ ] WebSocket 切断時にピアが接続中リストから除去される
- [ ] エラーは `type: "error"` メッセージで通知してから標準 close code で切断する
- [ ] wss（TLS）対応
- [ ] CORS 設定あり
- [ ] 接続数上限による DoS 対策あり（定数化。MVP では 1000）
- [ ] 不正な JSON / スキーマ不一致でクラッシュしない（safeParse）
- [ ] `packages/signaling/` にモノレポ構成で配置
- [ ] 6a で定義した SignalingEnvelope / SignalingErrorCode の型を共有する

### 設計判断

#### サーバーの状態

メモリのみ。永続化不要。

```typescript
// Map<peerId, WebSocket>
const peers = new Map<string, WebSocket>();
```

#### プロトコル（クライアント → サーバー）

```typescript
type ClientMessage =
  | { type: "join"; peerId: string }
  | { type: "signal"; envelope: SignalingEnvelope }
```

#### プロトコル（サーバー → クライアント）

```typescript
type ServerMessage =
  | { type: "peers"; peers: string[] }
  | { type: "signal"; envelope: SignalingEnvelope }
  | { type: "error"; code: SignalingErrorCode; message: string }
```

#### DoS 対策

- 同時接続数上限（定数化。MVP では 1000）
- 上限到達時は `type: "error"` で `capacity_exceeded` を送信してから `1008` で close

#### ホスティング

無料枠で動く場所（Render, Fly.io, Railway 等）。MVP ではローカルでも可。

### エッジケース

- 1人目が join → ピアが 0 件返される → 2人目が来るまで待機
- シグナリングサーバー再起動 → 既存の WebRTC DataChannel は影響なし
- `to` に該当するピアが既に切断済み → envelope を破棄（クライアント側で ICE timeout）
- 同一 Peer ID の二重接続 → 先着優先。後から来た方に `type: "error"` で通知して close

### 影響範囲

- `packages/signaling/`（新規）
  - `server.ts` — Express + ws サーバー
  - `types.ts` — ClientMessage / ServerMessage
  - `package.json`
- ルートの `package.json`（workspaces 設定）
- `tsconfig` の参照設定

### 見積もり

M
