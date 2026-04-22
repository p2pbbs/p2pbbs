# Story 7: WebRTC 接続確立

## ユーザーストーリー

掲示板を開いたユーザーとして、ページを開くだけで自動的に他のピアと接続され、投稿をやり取りできる状態になる。

## 受け入れ条件

- [ ] ページ読み込み時にシグナリングサーバーへ自動接続し、discover でピアリストを取得する
- [ ] 取得したピアに対して WebRTC DataChannel が確立される
- [ ] 他のピアからの offer を受けて answer を返し、DataChannel が確立される
- [ ] DataChannel open 後に ping/pong（または heartbeat）で疎通を確認できる
- [ ] 最大 8 本の active 接続を管理する（MAX_ACTIVE_PEERS = 8）
- [ ] 接続上限に達したら新規 offer を拒否する
- [ ] 両方が同時に offer を送った場合（glare）、Peer ID 辞書順で解決される
- [ ] ICE candidate が非同期で出るたびにシグナリング経由で相手に送られる
- [ ] STUN サーバー（Google 公開 STUN）で NAT 越えを試みる。TURN は使わない
- [ ] 接続失敗（ICE failed）はクラッシュしない。他のピアで補完される
- [ ] DataChannel close 時にセッションが除去される
- [ ] HeartbeatTracker と統合されている（trackPeer / removePeer）
- [ ] IPeerConnectionFactory でブラウザ API を抽象化し、将来の Node.js 対応に備える

## 設計判断

### 3 層構成: Factory + PeerSession + PeerManager

```
IPeerConnectionFactory (domain/port)
  └ create(): IPeerConnection
       └ createDataChannel / createOffer / createAnswer / ...

PeerSession (usecase)
  - 1つのピアとの接続ライフサイクル
  - offer/answer/ICE ハンドシェイク
  - IPeerConnection を Factory 経由で受け取る

PeerManager (usecase, Mediator パターン)
  - シグナリングメッセージの振り分け (route)
  - sessions Map の管理
  - MAX_ACTIVE_PEERS 制約
  - glare 解決
  - ロジックは持たない。PeerSession に委譲する
```

### IPeerConnectionFactory / IPeerConnection / IDataChannel

```typescript
interface IDataChannel {
  send(data: string): void;
  close(): void;
  onMessage(handler: (data: string) => void): () => void;
  onOpen(handler: () => void): () => void;
  onClose(handler: () => void): () => void;
}

interface IPeerConnection {
  createDataChannel(label: string): IDataChannel;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  onIceCandidate(handler: (candidate: RTCIceCandidateInit) => void): () => void;
  onDataChannel(handler: (channel: IDataChannel) => void): () => void;
  close(): void;
}

interface IPeerConnectionFactory {
  create(): IPeerConnection;
}
```

ブラウザ版: BrowserPeerConnectionFactory が `new RTCPeerConnection({ iceServers })` をラップ。
Node.js 版（Story 10）: node-datachannel 等で同じインターフェースを実装。

### PeerSession

1 つのピアとの接続セッション。WebRTC のハンドシェイク手順を閉じ込める。

```typescript
class PeerSession {
  constructor(
    peerId: string,
    pc: IPeerConnection,
    sendSignal: (envelope: SignalingEnvelope) => void,
    onChannelReady: (dc: IDataChannel) => void,
  ) {}

  // 自分が offer 側
  async initiateOffer(): Promise<void>;

  // 相手の offer を受けて answer を返す
  async handleOffer(sdp: RTCSessionDescriptionInit): Promise<void>;

  // 相手の answer を受け取る
  async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void>;

  // ICE candidate を受け取る
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;

  close(): void;
}
```

### PeerManager (Mediator)

ロジックを持たない。振り分けと状態管理のみ。

```typescript
class PeerManager {
  private readonly sessions = new Map<string, PeerSession>();

  constructor(
    signaling: ISignalingTransport,
    factory: IPeerConnectionFactory,
    peerId: string,
    onChannel: (peerId: string, dc: IDataChannel) => void,
  ) {}

  // discover で得たピアに接続しに行く
  connectTo(targetId: string): void;

  // シグナリングメッセージの振り分け
  private route(env: SignalingEnvelope): void;

  // セッション除去
  removeSession(peerId: string): void;
}
```

### Glare 解決

両方が同時に offer を送った場合:

- route で offer を受信したとき、既にそのピアへの session がある = 自分も offer を送った
- Peer ID を辞書順比較。自分のほうが小さければ相手の offer を無視（自分の offer が勝つ）
- 自分のほうが大きければ既存 session を破棄して相手の offer を受け入れる
- WebRTC の rollback は使わない。session ごと作り直すほうがシンプル

### STUN 設定

```typescript
export const STUN_URL = "stun:stun.l.google.com:19302";
```

constants に定義。TURN は使わない。繋がらないペアは繋がらない（ネットワーク全体のゴシップで補完）。

### HeartbeatTracker 統合

- DataChannel open → HeartbeatTracker.trackPeer(peerId)
- DataChannel close → HeartbeatTracker.removePeer(peerId)
- HeartbeatTracker.onDead → PeerManager.removeSession(peerId)
- heartbeat 送信: DataChannelMessage `{ type: "heartbeat" }` を DataChannel で直接送信

### App.tsx の初期化フロー

```
1. discover(peerId) → ピアリスト取得
2. リスト内の各ピアに PeerManager.connectTo()
3. signaling.onMessage → PeerManager.route()
4. DataChannel open → WebRTCGateway に登録（Story 8）
```

## エッジケース

- discover で 0 件返される → 誰かが来るまで待機。signaling.onMessage で offer が来たら受ける
- 3 件返されて 1 件だけ接続成功 → 1 本で十分。ゴシップは届く
- 接続中にシグナリングサーバーが落ちる → 既存 DataChannel は影響なし
- ICE gathering が完了しない → タイムアウト後に session を破棄。クラッシュしない
- DataChannel の label が一致しない → "nch" 固定
- 相手が非対応ブラウザ → offer/answer が成立しない。無視
- 同一ブラウザの 2 タブが同じシグナリングに繋がる → 異なる Peer ID なので別ノードとして接続確立（同一マシン内の loopback）

## 影響範囲

- `core/domain/port/IPeerConnectionFactory.ts`（新規）
- `core/domain/port/IPeerConnection.ts`（新規）
- `core/domain/port/IDataChannel.ts`（新規）
- `core/usecase/PeerSession.ts`（新規）
- `core/usecase/PeerManager.ts`（新規）
- `core/adapter/peer/BrowserPeerConnectionFactory.ts`（新規）
- `core/adapter/peer/BrowserPeerConnection.ts`（新規）
- `core/adapter/peer/BrowserDataChannel.ts`（新規）
- `core/config/constants.ts`（STUN_URL, MAX_ACTIVE_PEERS 追加）
- `ui/App.tsx`（初期化フローに discover + PeerManager 統合）
- `tests/`（PeerSession, PeerManager, glare, heartbeat 統合）

## テスト戦略

### Unit テスト（vitest、全モック）

**PeerManager:**

- offer/answer/ice-candidate の振り分けが正しい session に届く
- MAX_ACTIVE_PEERS 超過で connectTo / offer 受信が無視される
- glare 解決: Peer ID 辞書順で勝つ側が残る
- 存在しない from の answer/ice-candidate が無視される
- removeSession で session.close + Map から除去

**PeerSession:**

- initiateOffer → createDataChannel + createOffer + setLocalDescription + sendSignal の順序
- handleOffer → setRemoteDescription + createAnswer + setLocalDescription + sendSignal
- handleAnswer → setRemoteDescription
- addIceCandidate → pc.addIceCandidate
- onIceCandidate コールバック → sendSignal
- DataChannel open → onChannelReady コールバック
- close → pc.close

PeerSession は IPeerConnection のモックを注入してテストする。WebRTC のブラウザ API には触らない。

### テストしないもの

**BrowserPeerConnection / BrowserDataChannel / BrowserPeerConnectionFactory:**
ブラウザ API の薄いラッパー（各 20-30 行）でロジックがない。Unit テストを書いても「モックが正しく振る舞うか」のテストになる。実際の接続は手動テストで確認する。

### 手動テスト（PoC）

- 同一マシンでブラウザ 2 つ → DataChannel 確立 + heartbeat 疎通
- 異なるマシンで IPv6 接続
- 片方を閉じてもう片方がクラッシュしないこと

### E2E（PoC 後、余裕があれば）

Playwright で 2 タブ起動 → 投稿伝播を確認。

## 見積もり

L
