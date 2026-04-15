---
name: nch-testing
description: >
  nch P2P テスト戦略ガイド。*.test.ts の新規作成・編集時、テスト設計の相談時、
  「どうテストする？」「エッジケースは？」という問いかけがあったとき、
  WebRTC DataChannel / ゴシップ伝播 / シグナリング / ピア離脱などに関するテストを
  書くときに必ず参照すること。domain/、usecase/、adapter/ に関するテストにも適用する。
---

# nch Testing — P2P テスト戦略ガイド

## テストの基本方針

- **命名規則**: `test_Action_Condition_Result`（例: `test_receiveMessage_invalidSignature_rejectsWithoutSaving`）
- **テスト対象は必ず `src/` から import する**。テストファイル内でクラスを再定義しない
- **CryptoService は `vi.spyOn` でモック**する。個別の hashService / signatureService を直接 spyOn しない
- **`biome-ignore` / `eslint-disable` などの警告抑制コメント使用禁止**。警告が出る場合は根本原因を修正して解消すること。型エラーを `as any` で握り潰す、lintエラーを無視コメントで隠すことは認めない
- Level 1（Domain）: モック不要の純粋 TS テスト
- Level 2（UseCase）: Repository / CryptoService をモック
- Level 3（Component）: Smart Component は UseCase モックで繋ぎこみを検証

### Peer フィクスチャの注意

**Domain の `Peer` 型は `{ id: string; connectedAt: number }` のみ。**
`RTCDataChannel` / `RTCPeerConnection` はフィールドに含まない（Adapter が内部管理）。

```typescript
// ✅ 正しい Peer フィクスチャ
{ id: "peer-b", connectedAt: Date.now() }

// ❌ 誤り — connection / channel は Domain Peer に属さない
{ id: "peer-b", channel: { readyState: "open" }, connection: pc }
```

`createMockDataChannel` は Adapter 層のテスト用スタブ。`peerRepo.getConnected()` が返す Peer フィクスチャとは無関係。

---

## WebRTC DataChannel のモック

実際の RTCPeerConnection はブラウザ環境が必要なため、Vitest ではスタブで代替する。

> **必須: DataChannel テストでは `vi.waitFor` を使うこと**
>
> `simulateReceive` はイベントハンドラを**同期的に**呼び出す。
> `channel.onmessage` が `async` 関数として登録されている場合、`simulateReceive` は
> ハンドラの完了を**待たずに**返る。そのため、以下のように必ず `vi.waitFor` で
> 非同期処理の完了を待つこと。
>
> ```typescript
> simulateReceive(channel, msg);
> await vi.waitFor(() => expect(postRepo.save).toHaveBeenCalled(), { timeout: 1000 });
> ```
>
> `await usecase.execute()` を直接呼ぶ場合（simulateReceive を使わない場合）は
> vi.waitFor は不要だが、DataChannel 経由の受信テストでは simulateReceive + vi.waitFor
> のパターンが実際のイベント駆動を正確にシミュレートする。

```typescript
// tests/helpers/mockDataChannel.ts

/** RTCDataChannel の最小スタブ */
export function createMockDataChannel(overrides: Partial<RTCDataChannel> = {}): RTCDataChannel {
  const handlers: Record<string, ((e: Event) => void) | null> = {
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
  };

  const channel = {
    readyState: "open" as RTCDataChannelState,
    send: vi.fn(),
    close: vi.fn(),
    get onopen() { return handlers.onopen; },
    set onopen(fn) { handlers.onopen = fn; },
    get onclose() { return handlers.onclose; },
    set onclose(fn) { handlers.onclose = fn; },
    get onmessage() { return handlers.onmessage; },
    set onmessage(fn) { handlers.onmessage = fn; },
    ...overrides,
  } as unknown as RTCDataChannel;

  return channel;
}

/** RTCPeerConnection の最小スタブ */
export function createMockPeerConnection(): RTCPeerConnection {
  return {
    iceConnectionState: "connected" as RTCIceConnectionState,
    oniceconnectionstatechange: null,
    close: vi.fn(),
    createDataChannel: vi.fn(() => createMockDataChannel()),
    createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "dummy-sdp" }),
    createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "dummy-sdp" }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn().mockResolvedValue(undefined),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    ondatachannel: null,
  } as unknown as RTCPeerConnection;
}

/** DataChannel にメッセージを疑似受信させるヘルパー */
export function simulateReceive(channel: RTCDataChannel, data: unknown): void {
  const handler = (channel as unknown as { onmessage: ((e: MessageEvent) => void) | null }).onmessage;
  if (handler) {
    handler(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

/** DataChannel を open 状態にするヘルパー */
export function simulateOpen(channel: RTCDataChannel): void {
  const handler = (channel as unknown as { onopen: ((e: Event) => void) | null }).onopen;
  if (handler) handler(new Event("open"));
}

/** DataChannel を close 状態にするヘルパー */
export function simulateClose(channel: RTCDataChannel): void {
  const obj = channel as unknown as { onclose: ((e: Event) => void) | null; readyState: string };
  obj.readyState = "closed";
  if (obj.onclose) obj.onclose(new Event("close"));
}
```

---

## WebSocket シグナリングのモック

```typescript
// tests/helpers/mockSignaling.ts
import type { GossipMessage } from "../../src/domain/Message";

export function createMockWebSocket(): WebSocket {
  const handlers: Record<string, ((e: Event) => void) | null> = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    get onopen() { return handlers.onopen; },
    set onopen(fn) { handlers.onopen = fn; },
    get onmessage() { return handlers.onmessage; },
    set onmessage(fn) { handlers.onmessage = fn; },
    get onclose() { return handlers.onclose; },
    set onclose(fn) { handlers.onclose = fn; },
  } as unknown as WebSocket;
}

/** SDP offer/answer のダミーデータ */
export const dummySdp: RTCSessionDescriptionInit = { type: "offer", sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n" };

/** ICE candidate のダミーデータ */
export const dummyIceCandidate: RTCIceCandidateInit = {
  candidate: "candidate:1 1 udp 2122260223 192.168.0.1 54321 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
};
```

---

## Post / GossipMessage フィクスチャ

```typescript
// tests/helpers/fixtures.ts
import type { Post } from "../../src/domain/Post";
import type { GossipMessage } from "../../src/domain/Message";

export function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "hash-abc123",
    number: 1,
    name: "名無しさん",
    body: "テスト本文",
    odId: "abcd1234",
    timestamp: 1_700_000_000_000,
    signature: "valid-sig",
    publicKey: "pubkey-base64",
    ...overrides,
  };
}

export function makeGossipMessage(overrides: Partial<GossipMessage> = {}): GossipMessage {
  return {
    type: "post",
    boardId: "board-1",
    threadId: "thread-1",
    post: makePost(),
    ttl: 3,
    path: ["peer-origin"],
    ...overrides,
  };
}
```

---

## ReceiveMessageUseCase のテスト例

DataChannel スタブを使って UseCase のパイプラインを E2E 検証する。

```typescript
// src/usecase/ReceiveMessageUseCase.dataChannel.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReceiveMessageUseCase } from "../../src/usecase/ReceiveMessageUseCase";
import { CryptoService } from "../../src/domain/service/CryptoService";
import { createMockDataChannel, simulateReceive } from "../helpers/mockDataChannel";
import { makeGossipMessage } from "../helpers/fixtures";
import type { GossipMessage } from "../../src/domain/Message";

describe("ReceiveMessageUseCase — DataChannel 経由の受信", () => {
  let postRepo: { save: ReturnType<typeof vi.fn>; findByThread: ReturnType<typeof vi.fn> };
  let peerRepo: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; getAll: ReturnType<typeof vi.fn>; getConnected: ReturnType<typeof vi.fn> };
  let crypto: CryptoService;
  let sendToChannel: ReturnType<typeof vi.fn>;
  let usecase: ReceiveMessageUseCase;

  beforeEach(() => {
    postRepo = { save: vi.fn().mockResolvedValue(undefined), findByThread: vi.fn() };
    peerRepo = {
      add: vi.fn(), remove: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
      // Peer は id + connectedAt のみ。channel / connection は含まない
      getConnected: vi.fn().mockReturnValue([
        { id: "peer-b", connectedAt: Date.now() },
        { id: "peer-c", connectedAt: Date.now() },
      ]),
    };
    crypto = new CryptoService({ generateKeyPair: vi.fn(), sign: vi.fn(), deriveOdId: vi.fn() } as any);
    vi.spyOn(crypto, "verifySignature").mockResolvedValue(true);
    vi.spyOn(crypto, "verifyPostHash").mockResolvedValue(true);
    sendToChannel = vi.fn();
    usecase = new ReceiveMessageUseCase(postRepo, peerRepo, crypto, "self-id", sendToChannel);
  });

  it("test_receiveMessage_validMessageViaDataChannel_savesAndFansOut", async () => {
    const channel = createMockDataChannel();
    // DataChannel から GossipMessage を受信したとき UseCase を呼ぶ想定
    channel.onmessage = async (e: MessageEvent) => {
      const msg = JSON.parse(e.data) as GossipMessage;
      await usecase.execute(msg);
    };

    const msg = makeGossipMessage({ ttl: 2 });
    simulateReceive(channel, msg);

    // 非同期処理の完了を待つ
    await vi.waitFor(() => expect(postRepo.save).toHaveBeenCalledOnce());
    expect(sendToChannel).toHaveBeenCalled();
    const [, forwarded] = sendToChannel.mock.calls[0] as [string, GossipMessage];
    expect(forwarded.ttl).toBe(1);
    expect(forwarded.path).toContain("self-id");
  });
});
```

---

## 複数ノードのゴシップ伝播テスト

1プロセス内で複数の UseCase インスタンスを作り、ノード間のメッセージ転送を直接関数呼び出しでシミュレートする。

```typescript
// src/usecase/gossip.propagation.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReceiveMessageUseCase } from "../../src/usecase/ReceiveMessageUseCase";
import { CryptoService } from "../../src/domain/service/CryptoService";
import { makePost, makeGossipMessage } from "../helpers/fixtures";
import type { GossipMessage } from "../../src/domain/Message";

/**
 * 3ノード構成: A → B → C
 * A が投稿を送信 → B が受信・転送 → C が受信・保存
 */
describe("ゴシップ伝播 — 3ノード構成", () => {
  function makeNode(selfId: string, neighbors: string[]) {
    const postRepo = { save: vi.fn().mockResolvedValue(undefined), findByThread: vi.fn() };
    const peerRepo = {
      add: vi.fn(), remove: vi.fn(), getAll: vi.fn(),
      // Peer は id + connectedAt のみ。channel / connection は含まない
      getConnected: vi.fn().mockReturnValue(neighbors.map((id) => ({ id, connectedAt: Date.now() }))),
    };
    const crypto = new CryptoService({ generateKeyPair: vi.fn(), sign: vi.fn(), deriveOdId: vi.fn() } as any);
    vi.spyOn(crypto, "verifySignature").mockResolvedValue(true);
    vi.spyOn(crypto, "verifyPostHash").mockResolvedValue(true);

    // sendToChannel は隣接ノードの usecase.execute を呼ぶクロージャになる
    // （後から外部から差し込む）
    const sendToChannel = vi.fn();
    const usecase = new ReceiveMessageUseCase(postRepo, peerRepo, crypto, selfId, sendToChannel);

    return { selfId, postRepo, peerRepo, usecase, sendToChannel };
  }

  it("test_gossip_AtoB_toBtoC_CReceivesPost", async () => {
    const nodeA = makeNode("node-a", ["node-b"]);
    const nodeB = makeNode("node-b", ["node-c"]);
    const nodeC = makeNode("node-c", []);

    // A の sendToChannel が B の execute を呼ぶ
    nodeA.sendToChannel.mockImplementation(async (_peerId: string, msg: GossipMessage) => {
      await nodeB.usecase.execute(msg);
    });
    // B の sendToChannel が C の execute を呼ぶ
    nodeB.sendToChannel.mockImplementation(async (_peerId: string, msg: GossipMessage) => {
      await nodeC.usecase.execute(msg);
    });

    // A がメッセージを受信（自分で作った投稿を自分で受け取る場合も想定）
    const msg = makeGossipMessage({ ttl: 2, path: ["node-a"] });
    await nodeA.usecase.execute(msg);

    // B でも C でも保存されること
    expect(nodeB.postRepo.save).toHaveBeenCalledOnce();
    expect(nodeC.postRepo.save).toHaveBeenCalledOnce();

    // C はファンアウト先なし（getConnected が空）なので sendToChannel は呼ばれない
    expect(nodeC.sendToChannel).not.toHaveBeenCalled();
  });
});
```

---

## ピア途中離脱のテスト

```typescript
// src/usecase/gossip.peerLeave.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReceiveMessageUseCase } from "../../src/usecase/ReceiveMessageUseCase";
import { CryptoService } from "../../src/domain/service/CryptoService";
import { makeGossipMessage } from "../helpers/fixtures";
import type { GossipMessage } from "../../src/domain/Message";

describe("ゴシップ伝播 — ピア途中離脱", () => {
  it("test_fanout_peerLeaveDuringFanout_remainingPeersReceiveMessage", async () => {
    const postRepo = { save: vi.fn().mockResolvedValue(undefined), findByThread: vi.fn() };

    const connectedPeers = [
      { id: "peer-b" },
      { id: "peer-c" },
      { id: "peer-d" }, // このピアが途中離脱する
    ];

    const peerRepo = {
      add: vi.fn(), remove: vi.fn(), getAll: vi.fn(),
      getConnected: vi.fn().mockReturnValue(connectedPeers),
    };

    const crypto = new CryptoService({ generateKeyPair: vi.fn(), sign: vi.fn(), deriveOdId: vi.fn() } as any);
    vi.spyOn(crypto, "verifySignature").mockResolvedValue(true);
    vi.spyOn(crypto, "verifyPostHash").mockResolvedValue(true);

    const sendErrors: string[] = [];
    const sendToChannel = vi.fn().mockImplementation((peerId: string) => {
      // peer-d への送信は失敗（チャンネルが閉じている）
      if (peerId === "peer-d") {
        sendErrors.push(peerId);
        // 実際の PeerAdapter は readyState チェックで握り潰すが、ここでは記録だけ
      }
    });

    const usecase = new ReceiveMessageUseCase(postRepo, peerRepo, crypto, "self-id", sendToChannel);
    const msg = makeGossipMessage({ ttl: 2, path: [] });

    await usecase.execute(msg);

    // 保存は成功している
    expect(postRepo.save).toHaveBeenCalledOnce();
    // peer-b と peer-c には届いている（peer-d への送信試行は別途 PeerAdapter が握り潰す）
    const calledPeers = sendToChannel.mock.calls.map(([id]: [string]) => id);
    expect(calledPeers).toContain("peer-b");
    expect(calledPeers).toContain("peer-c");
  });
});
```

---

## シードノード（Node.js 版 Adapter）のテスト

シードノードはブラウザ版と同じ UseCase / Domain コードを使い、Adapter 層だけが異なる。
テスト戦略はブラウザ版と同じ — `sendToChannel` を vi.fn() でモックし、UseCase の execute() を直接呼ぶ。

Node.js 版 PeerAdapter（仮称 `NodePeerAdapter`）の単体テストでは、
WebSocket や net.Socket をスタブにする。ReceiveMessageUseCase テストでは Adapter の違いを意識しない。

```typescript
// シードノードでも UseCase テストのパターンは共通
// peerRepo.getConnected() が返す Peer は { id, connectedAt } のみ（ブラウザ版と同じ）
const peerRepo = {
  add: vi.fn(),
  remove: vi.fn(),
  getAll: vi.fn(),
  getConnected: vi.fn().mockReturnValue([
    { id: "seed-peer-1", connectedAt: Date.now() },
  ]),
};
```

---

## エッジケース一覧

| ケース | テスト戦略 |
|--------|-----------|
| 不正署名 | `vi.spyOn(crypto, "verifySignature").mockResolvedValue(false)` |
| 不正ハッシュ | `vi.spyOn(crypto, "verifyPostHash").mockResolvedValue(false)` |
| 重複メッセージ | 同一 `post.id` で `execute()` を2回呼ぶ |
| TTL=0 | `makeGossipMessage({ ttl: 0 })` — 保存はされるが転送しない |
| TTL=1 | `makeGossipMessage({ ttl: 1 })` — 保存後 `ttl-1=0` になるので転送しない |
| path に自分含む | `makeGossipMessage({ path: ["self-id"] })` — fanout でフィルタされる |
| ピア未接続 | `peerRepo.getConnected.mockReturnValue([])` |
| ピア途中離脱 | `simulateClose(channel)` → `peerRepo.remove` が呼ばれることを検証 |
| 同時投稿 | `Promise.all([usecase.execute(msg1), usecase.execute(msg2)])` |

---

## 非同期パイプラインの待ち合わせ

ゴシップ受信→処理→再転送は複数の非同期ステップを含む。

```typescript
// 推奨: vi.waitFor でポーリング
await vi.waitFor(() => expect(postRepo.save).toHaveBeenCalled(), { timeout: 1000 });

// 推奨: Promise.all で並列実行の完了を待つ
await Promise.all([
  usecase.execute(msg1),
  usecase.execute(msg2),
]);

// 推奨: 伝播チェーンが終わるまで待つ（3ノードテスト）
await nodeA.usecase.execute(msg);
// sendToChannel の mockImplementation が await するので execute が返れば伝播完了
```

---

## テスト構成の推奨ディレクトリ

```
tests/
  helpers/
    fixtures.ts          # Post / GossipMessage フィクスチャ
    mockDataChannel.ts   # RTCDataChannel スタブ
    mockSignaling.ts     # WebSocket スタブ
src/
  domain/
    *.test.ts            # Level 1: 純粋ロジックのテスト（モック不要）
  usecase/
    *.test.ts            # Level 2: UseCase テスト（CryptoService / Repo をモック）
  adapter/
    *.test.ts            # Level 3: Adapter 単体テスト（必要なら）
```
