# Story 8: WebRTCGateway — ブラウザ間で投稿が伝播する

## ユーザーストーリー

掲示板を異なるブラウザ（またはマシン）で開いたユーザーとして、片方で投稿したレスがもう片方に表示される。

## 受け入れ条件

- [ ] 異なるブラウザ間で投稿が伝播する（WebRTC DataChannel 経由）
- [ ] 投稿の表示順が両方で同じ（lamport 昇順 → post.id 昇順）
- [ ] 署名・ハッシュ検証が WebRTC 経由でも動作する
- [ ] 改竄されたメッセージが拒否される
- [ ] 3台以上でゴシップの再ファンアウトが動く
- [ ] BroadcastChannelGateway が削除され、WebRTCGateway に統一されている
- [ ] GossipController / ReceiveMessageUseCase に変更がない（Adapter 差し替えのみ）
- [ ] 片方がタブを閉じてもう片方がクラッシュしない

## 設計判断

### 所有関係

```
PeerManager (直接所有)
  ├── sessions: Map<peerId, PeerSession>
  │     └── PeerSession が IPeerConnection を所有
  └── channels: Map<peerId, IDataChannel>
       （PeerSession が生成し、onChannelReady で PeerManager に渡す）
```

- PeerManager は IPeerConnection を直接触らない。PeerSession 経由
- PeerManager は DC を直接持つ（heartbeat 送受信 + WebRTCGateway への参照貸し出し）
- DC の追加/削除は PeerManager だけが行う

### WebRTCGateway

IGossipMessageGateway の WebRTC 実装。状態を持たない。PeerManager が所有する Map への参照を読むだけ。

```typescript
class WebRTCGateway implements IGossipMessageGateway {
  private readonly handlers = new Set<(msg: GossipMessage) => void>();

  constructor(
    /** PM が所有する Map への参照。send 時に毎回最新の接続先を読む。 */
    private readonly channelsRef: ReadonlyMap<string, IDataChannel>,
  ) {}

  send(message: GossipMessage): void {
    const data = JSON.stringify({ type: "gossip", message });
    for (const dc of this.channelsRef.values()) {
      dc.send(data);
    }
  }

  onReceive(handler: (msg: GossipMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** DC から来た生データを解釈して gossip なら handlers に通知する。 */
  handleIncoming(raw: string): void {
    try {
      const result = DataChannelMessageSchema.safeParse(JSON.parse(raw));
      if (!result.success || result.data.type !== "gossip") return;
      for (const h of this.handlers) h(result.data.message);
    } catch { /* malformed JSON は無視 */ }
  }
}
```

### ReadonlyMap による参照渡し

Map は参照型。PM が追加/削除した結果がリアルタイムに反映される。WebRTCGateway はスナップショットではなく参照を受け取る。ReadonlyMap にすることで「PM だけが追加/削除できる。WebRTCGateway は読むだけ」が型で保証される。

```typescript
// PeerManager
get activeChannels(): ReadonlyMap<string, IDataChannel> {
  return this.channels;
}
```

### DC の2人の利用者

| 利用者 | DC を使う目的 | DC の中身を知るか |
|--------|-------------|----------------|
| PeerManager (heartbeat) | ピアの生死確認 | heartbeat だけ見る。gossip は無視 |
| WebRTCGateway (gossip) | 投稿の伝播 | gossip だけ見る。heartbeat は無視 |

PM は heartbeat の送受信に DC を使う。それ以外は onChannel で外に貸し出す。WebRTCGateway は DC.onMessage で gossip を受信し、DC.send で gossip を送信する。互いの関心は完全に分離。

### App.tsx の配線

```typescript
const peerManager = new PeerManager(
  signaling, factory, peerId,
  (_peerId, dc) => {
    dc.onMessage((raw) => webrtcGateway.handleIncoming(raw));
  },
  logger,
);

// PM が所有する Map の参照。PM が追加/削除した結果がリアルタイムに反映される
const activeChannelsRef = peerManager.activeChannels;
const webrtcGateway = new WebRTCGateway(activeChannelsRef);

// Phase 1 と同じ。gateway の具象が変わっただけ
const receiveUseCase = new ReceiveMessageUseCase(
  postStore, cryptoService, clock, peerId, webrtcGateway, logger,
);
const controller = new GossipController(webrtcGateway, receiveUseCase);
controller.start();
```

- PeerManager と WebRTCGateway は互いの型を知らない
- 循環参照なし
- GossipController / ReceiveMessageUseCase は変更なし

### BroadcastChannelGateway の削除

WebRTC に統一する。同一ブラウザの2タブも WebRTC 経由（シグナリング → SDP/ICE → DataChannel）。削除対象：

- `src/core/adapter/gossip/BroadcastChannelGateway.ts`
- `tests/adapter/gossip/BroadcastChannelGateway.test.ts`

## エッジケース

- WebRTCGateway.send 時に channelsRef が空（ピアが0） → 何も送らない。エラーにならない
- DC.send が例外を投げる（DC が closing 中） → try/catch で無視
- handleIncoming に不正 JSON が来る → 無視
- handleIncoming に heartbeat が来る → gossip ではないので handlers に通知しない（PM 側で処理済み）

## テスト戦略

### Unit テスト

**WebRTCGateway:**

- send → channelsRef の全 DC に送信される
- send → channelsRef が空なら何もしない
- onReceive → handleIncoming で gossip を受けたら handler が呼ばれる
- onReceive → unsubscribe 後は handler が呼ばれない
- handleIncoming → heartbeat は handlers に通知しない
- handleIncoming → 不正 JSON でクラッシュしない

**統合テスト（Unit レベル）:**

- PostMessageUseCase → WebRTCGateway.send → DC.send が呼ばれる
- DC.onMessage → WebRTCGateway.handleIncoming → GossipController → ReceiveMessageUseCase.execute が呼ばれる

### 手動テスト

- デプロイ済み環境で2台のブラウザから投稿が伝播する
- 3台以上で再ファンアウトが動く

## 影響範囲

- `core/adapter/gossip/WebRTCGateway.ts`（新規）
- `core/usecase/PeerManager.ts`（activeChannels getter 追加）
- `ui/App.tsx`（配線変更: BroadcastChannelGateway → WebRTCGateway）
- `core/adapter/gossip/BroadcastChannelGateway.ts`（削除）
- `tests/adapter/gossip/BroadcastChannelGateway.test.ts`（削除）
- `tests/adapter/gossip/WebRTCGateway.test.ts`（新規）

## 見積もり

M
