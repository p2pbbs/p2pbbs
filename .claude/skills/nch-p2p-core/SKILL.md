---
name: nch-p2p-core
description: >
  nch P2P 層（domain / usecase / adapter）の実装ガイド。domain/, usecase/, adapter/ 配下の
  ファイルを新規作成・編集するとき、WebRTC・ゴシップ・署名・ハッシュ・ピア管理・シグナリング・
  IndexedDB について言及されたとき、P2P の設計判断を相談されたときに必ず参照すること。
---

# nch P2P Core — 実装ガイド

## アーキテクチャ概要

依存方向: `UI → UseCase → Domain ← Adapter`

- **Domain**: 純粋な型定義・インターフェース・ロジック。ブラウザ API / React に依存しない
- **UseCase**: ビジネスロジックの調整役。Domain インターフェースのみに依存する。adapter/ を直接 import しない
- **Adapter**: Domain インターフェースの具象実装（WebRTC, WebSocket, IndexedDB, WebCrypto）
- **UI Smart Component**: Adapter を UseCase にコンストラクタ注入して繋ぐ唯一の場所

### Domain 型（正規定義）

```typescript
// src/domain/Post.ts
export type Post = {
  readonly id: string; // SHA-256 コンテンツハッシュ（事実上の投稿ID）
  readonly number: number; // スレ内連番、1始まり
  readonly name: string; // 投稿者名、デフォルト "名無しさん"
  readonly body: string;
  readonly odId: string; // SHA-256(publicKey) の先頭8文字
  readonly timestamp: number; // Unix ms
  readonly signature: string; // Ed25519 署名（base64）
  readonly publicKey: string; // Ed25519 公開鍵（base64）
};

// src/domain/Message.ts
export type GossipMessage = {
  readonly type: "post";
  readonly boardId: string;
  readonly threadId: string;
  readonly post: Post;
  readonly ttl: number; // ホップ上限。0 で転送停止
  readonly path: string[]; // 通過済みピアID。ループ防止用
};

// src/domain/Peer.ts
// Domain の Peer は通信手段を持たない。RTCPeerConnection / RTCDataChannel は Adapter が内部管理する
export type Peer = {
  readonly id: string;
  readonly connectedAt: number;
};
```

### Domain インターフェース（src/domain/ に定義）

```typescript
export interface IPostRepository {
  save(post: Post, threadId: string, boardId: string): Promise<void>;
  findByThread(threadId: string): Promise<Post[]>;
}

export interface IPeerRepository {
  add(peer: Peer): void;
  remove(peerId: string): void;
  getAll(): Peer[];
  getConnected(): Peer[]; // Adapter が open 状態のピアのみ登録しているため、全件が接続済み
}

// シグナリングは「最初の1ピアを紹介する」ブートストラップ役。接続後のピア発見はゴシップ経由
export interface ISignalingRepository {
  connect(url: string): Promise<void>;
  sendOffer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void>;
  sendAnswer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void>;
  sendIceCandidate(
    peerId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void>;
  disconnect(): void;
}
```

---

## 暗号操作の設計パターン（CryptoService）

暗号操作はステートフルかステートレスかで責務を分離する。

| 責務                                                   | 場所                                | 理由                                                 |
| ------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------- |
| `verifySignature`, `computePostHash`, `verifyPostHash` | `domain/service/CryptoService.ts`   | Post の中身だけで完結するステートレス処理            |
| `generateKeyPair`, `sign`, `deriveOdId`                | `adapter/crypto/WebCryptoSigner.ts` | 秘密鍵（セッション状態）を必要とするステートフル処理 |
| 統合ファサード                                         | `domain/service/CryptoService.ts`   | UseCase が依存する唯一の暗号抽象                     |

### ISigner（src/domain/port/ISigner.ts）

```typescript
/** 秘密鍵を保持するステートフルな署名器の抽象 */
export interface ISigner {
  generateKeyPair(): Promise<{ publicKey: string }>;
  sign(draft: Omit<Post, "id" | "signature">): Promise<Post>;
  deriveOdId(publicKey: string): Promise<string>;
}
```

### CryptoService（src/domain/service/CryptoService.ts）

```typescript
import type { Post } from "../Post";
import type { ISigner } from "../port/ISigner";

/**
 * 暗号操作の統合ファサード。
 * UseCase はこのクラスのみに依存する。
 * ステートレス操作は自前で実装し、ステートフル操作は ISigner に委譲する。
 */
export class CryptoService {
  constructor(private readonly signer: ISigner) {}

  // --- ステートレス（Post の中身だけで完結）---

  async computePostHash(post: Omit<Post, "id" | "signature">): Promise<string> {
    const content = [post.name, post.body, post.timestamp, post.publicKey].join(
      "|",
    );
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(content),
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async verifyPostHash(post: Post): Promise<boolean> {
    return (await this.computePostHash(post)) === post.id;
  }

  async verifySignature(post: Post): Promise<boolean> {
    const rawKey = Uint8Array.from(atob(post.publicKey), (c) =>
      c.charCodeAt(0),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const sig = Uint8Array.from(atob(post.signature), (c) => c.charCodeAt(0));
    const payload = new TextEncoder().encode(
      [post.name, post.body, post.timestamp].join("|"),
    );
    return crypto.subtle.verify("Ed25519", key, sig, payload);
  }

  // --- ステートフル（ISigner に委譲）---

  generateKeyPair(): Promise<{ publicKey: string }> {
    return this.signer.generateKeyPair();
  }

  sign(draft: Omit<Post, "id" | "signature">): Promise<Post> {
    return this.signer.sign(draft);
  }

  deriveOdId(publicKey: string): Promise<string> {
    return this.signer.deriveOdId(publicKey);
  }
}
```

### WebCryptoSigner（src/adapter/crypto/WebCryptoSigner.ts）

```typescript
import type { ISigner } from "../../domain/port/ISigner";
import type { Post } from "../../domain/Post";

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** Ed25519 鍵ペアを保持するアダプタ。秘密鍵は extractable: false でメモリ内のみ */
export class WebCryptoSigner implements ISigner {
  private keyPair: CryptoKeyPair | null = null;

  async generateKeyPair(): Promise<{ publicKey: string }> {
    this.keyPair = await crypto.subtle.generateKey("Ed25519", false, [
      "sign",
      "verify",
    ]);
    const raw = await crypto.subtle.exportKey("raw", this.keyPair.publicKey);
    return { publicKey: bytesToBase64(new Uint8Array(raw)) };
  }

  async sign(draft: Omit<Post, "id" | "signature">): Promise<Post> {
    if (!this.keyPair)
      throw new Error("generateKeyPair() を先に呼んでください");
    const payload = new TextEncoder().encode(
      [draft.name, draft.body, draft.timestamp].join("|"),
    );
    const sigBuf = await crypto.subtle.sign(
      "Ed25519",
      this.keyPair.privateKey,
      payload,
    );
    const signature = bytesToBase64(new Uint8Array(sigBuf));
    // id の計算は CryptoService.computePostHash が行うのでここでは行わない
    // Smart Component が CryptoService.sign() を呼ぶことで自動的に id が付与される
    // （WebCryptoSigner.sign は id を空文字で返し、CryptoService がラップして id を付ける設計でも可）
    const content = [
      draft.name,
      draft.body,
      draft.timestamp,
      draft.publicKey,
    ].join("|");
    const hashBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(content),
    );
    const id = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { ...draft, id, signature };
  }

  async deriveOdId(publicKey: string): Promise<string> {
    const raw = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
    const buf = await crypto.subtle.digest("SHA-256", raw);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 8);
  }
}
```

---

## UseCase: ReceiveMessageUseCase

受信した GossipMessage を検証・保存・転送する。nch のホットパス。

**パイプライン順序（この順序を守ること）:**
`署名検証 → ハッシュ検証 → 重複判定 → 保存 → TTL チェック → ファンアウト`

> **重複判定を署名検証より前に行ってはいけない。**
> 攻撃者が既知の post.id を持つ不正メッセージを先に送ると、署名検証なしで seen に登録されてしまい、
> 後から届く本物のメッセージがスキップされる。必ず署名・ハッシュで正当性を確認してから seen に追加する。

```typescript
// src/usecase/ReceiveMessageUseCase.ts
import type { GossipMessage } from "../domain/Message";
import type { IPostRepository } from "../domain/IPostRepository";
import type { IPeerRepository } from "../domain/IPeerRepository";
import type { CryptoService } from "../domain/service/CryptoService";

const FANOUT = 5;

/**
 * ゴシップメッセージの受信パイプライン。
 * 署名検証→ハッシュ検証→重複排除→保存→ファンアウトを順に実行する。
 */
export class ReceiveMessageUseCase {
  /** セッション内の重複排除用。post.id（コンテンツハッシュ）を記録 */
  private readonly seen = new Set<string>();

  constructor(
    private readonly postRepo: IPostRepository,
    private readonly peerRepo: IPeerRepository,
    private readonly crypto: CryptoService,
    private readonly selfId: string,
    private readonly sendToChannel: (
      peerId: string,
      msg: GossipMessage,
    ) => void,
  ) {}

  async execute(msg: GossipMessage): Promise<void> {
    const { post } = msg;

    // 1. 署名検証（先に検証してから seen に追加する）
    if (!(await this.crypto.verifySignature(post))) return;

    // 2. ハッシュ検証
    if (!(await this.crypto.verifyPostHash(post))) return;

    // 3. 重複排除（O(1)）
    if (this.seen.has(post.id)) return;
    this.seen.add(post.id);

    // 4. 保存
    await this.postRepo.save(post, msg.threadId, msg.boardId);

    // 5. TTL ゲート
    if (msg.ttl <= 0) return;

    // 6. 転送用エンベロープを構築
    const forwarded: GossipMessage = {
      ...msg,
      ttl: msg.ttl - 1,
      path: [...msg.path, this.selfId],
    };

    // 7. ファンアウト（path 済みピアを除外してランダムに最大 FANOUT 件へ転送）
    const targets = this.peerRepo
      .getConnected()
      .filter((p) => !forwarded.path.includes(p.id))
      .sort(() => Math.random() - 0.5)
      .slice(0, FANOUT);

    for (const peer of targets) {
      this.sendToChannel(peer.id, forwarded);
    }
  }
}
```

### UseCase: PostMessageUseCase

```typescript
// src/usecase/PostMessageUseCase.ts
import type { GossipMessage } from "../domain/Message";
import type { IPostRepository } from "../domain/IPostRepository";
import type { IPeerRepository } from "../domain/IPeerRepository";
import type { CryptoService } from "../domain/service/CryptoService";

const TTL_INITIAL = 7;
const FANOUT = 5;

export class PostMessageUseCase {
  constructor(
    private readonly postRepo: IPostRepository,
    private readonly peerRepo: IPeerRepository,
    private readonly crypto: CryptoService,
    private readonly selfId: string,
    private readonly sendToChannel: (
      peerId: string,
      msg: GossipMessage,
    ) => void,
  ) {}

  async execute(draft: {
    name: string;
    body: string;
    threadId: string;
    boardId: string;
  }): Promise<void> {
    const post = await this.crypto.sign({
      number: 0,
      name: draft.name,
      body: draft.body,
      odId: this.selfId.slice(0, 8),
      timestamp: Date.now(),
      publicKey: (await this.crypto.generateKeyPair()).publicKey,
    });

    await this.postRepo.save(post, draft.threadId, draft.boardId);

    const msg: GossipMessage = {
      type: "post",
      boardId: draft.boardId,
      threadId: draft.threadId,
      post,
      ttl: TTL_INITIAL,
      path: [this.selfId],
    };

    const peers = this.peerRepo
      .getConnected()
      .sort(() => Math.random() - 0.5)
      .slice(0, FANOUT);

    for (const peer of peers) {
      this.sendToChannel(peer.id, msg);
    }
  }
}
```

---

## Adapter: PeerAdapter（RTCPeerConnection ライフサイクル）

PeerAdapter には2実装がありうる。Domain/UseCase はどちらかを知らない。

- **ブラウザ版（WebRTCPeerAdapter）**: WebRTC DataChannel で通信。ブラウザで動く
- **Node.js 版（NodePeerAdapter）**: シードノード用。WebSocket や Node.js の net モジュールで通信

> **設計の鉄則**: Domain の `Peer` 型は `{ id, connectedAt }` のみ。RTCPeerConnection / RTCDataChannel は
> Adapter が内部の `channels` Map で管理し、Domain 層には一切公開しない。

```typescript
// src/adapter/WebRTCPeerAdapter.ts
import type { IPeerRepository } from "../../domain/IPeerRepository";
import type { GossipMessage } from "../../domain/Message";

/** ブラウザ版 PeerAdapter。RTCDataChannel を内部管理し、Domain に通信手段を公開しない */
export class WebRTCPeerAdapter {
  // チャンネルを内部 Map で管理する。Domain の Peer 型は id + connectedAt のみ
  private readonly channels = new Map<string, RTCDataChannel>();

  constructor(
    private readonly peerRepo: IPeerRepository,
    private readonly onMessage: (msg: GossipMessage) => void,
  ) {}

  async createPeer(peerId: string): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const channel = pc.createDataChannel("gossip", { ordered: false });
    this.wire(peerId, pc, channel);
    return pc;
  }

  acceptPeer(peerId: string, pc: RTCPeerConnection): void {
    pc.ondatachannel = (e) => this.wire(peerId, pc, e.channel);
  }

  private wire(
    peerId: string,
    pc: RTCPeerConnection,
    channel: RTCDataChannel,
  ): void {
    channel.onopen = () => {
      this.channels.set(peerId, channel);
      // Domain の Peer は id + connectedAt のみ
      this.peerRepo.add({ id: peerId, connectedAt: Date.now() });
    };
    channel.onclose = () => {
      this.channels.delete(peerId);
      this.peerRepo.remove(peerId);
    };
    channel.onmessage = (e: MessageEvent<string>) => {
      this.onMessage(JSON.parse(e.data) as GossipMessage);
    };
    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === "disconnected" ||
        pc.iceConnectionState === "failed"
      ) {
        this.channels.delete(peerId);
        this.peerRepo.remove(peerId);
      }
    };
  }

  send(peerId: string, msg: GossipMessage): void {
    // 内部 Map からチャンネルを取得して送信。Domain の Peer 型は参照しない
    const channel = this.channels.get(peerId);
    if (channel?.readyState === "open") {
      channel.send(JSON.stringify(msg));
    }
  }
}
```

### シグナリングとブートストラップ

シグナリングサーバーの役割は「最初の1ピアを紹介する」だけ。接続確立後のピア発見はゴシップ経由。
誰でも立てられ、複数存在してよい。シグナリングサーバー同士は同期不要。

### シードノード

Node.js で動くヘッドレスピア。24時間稼働し過去ログを保持する。
他のピアと対等で管理権限・特権はない。UseCase / Domain のコードはブラウザ版と共通で、Adapter 層だけが異なる。

---

## ユニットテスト（Vitest）

### テストの鉄則

- **テスト対象は必ず `src/` から import すること。** テストファイル内にクラスや関数を再定義してはいけない（実ソースとの乖離を検出できなくなるため）
- 命名規則: `test_Action_Condition_Result`
- UseCase テストは `CryptoService` のメソッドを `vi.spyOn` でモックする

```typescript
// src/usecase/ReceiveMessageUseCase.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReceiveMessageUseCase } from "../../src/usecase/ReceiveMessageUseCase";
import { CryptoService } from "../../src/domain/service/CryptoService";
import type { GossipMessage } from "../../src/domain/Message";
import type { Post } from "../../src/domain/Post";

const validPost: Post = {
  id: "abc123",
  number: 1,
  name: "名無しさん",
  body: "hello",
  odId: "deadbeef",
  timestamp: 1_700_000_000_000,
  signature: "sig",
  publicKey: "pubkey",
};

const validMsg: GossipMessage = {
  type: "post",
  boardId: "b1",
  threadId: "t1",
  post: validPost,
  ttl: 3,
  path: ["peer-a"],
};

describe("ReceiveMessageUseCase", () => {
  let postRepo: {
    save: ReturnType<typeof vi.fn>;
    findByThread: ReturnType<typeof vi.fn>;
  };
  let peerRepo: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
    getConnected: ReturnType<typeof vi.fn>;
  };
  let crypto: CryptoService;
  let sendToChannel: ReturnType<typeof vi.fn>;
  let usecase: ReceiveMessageUseCase;

  beforeEach(() => {
    postRepo = {
      save: vi.fn().mockResolvedValue(undefined),
      findByThread: vi.fn(),
    };
    peerRepo = {
      add: vi.fn(),
      remove: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
      getConnected: vi.fn().mockReturnValue([]),
    };
    // CryptoService の spy — ISigner モックは不要（メソッドを直接 spyOn）
    crypto = new CryptoService({
      generateKeyPair: vi.fn(),
      sign: vi.fn(),
      deriveOdId: vi.fn(),
    } as any);
    vi.spyOn(crypto, "verifySignature").mockResolvedValue(true);
    vi.spyOn(crypto, "verifyPostHash").mockResolvedValue(true);
    sendToChannel = vi.fn();
    usecase = new ReceiveMessageUseCase(
      postRepo,
      peerRepo,
      crypto,
      "self-id",
      sendToChannel,
    );
  });

  it("test_receiveMessage_validGossipMessage_savesAndFansOut", async () => {
    // Peer は id + connectedAt のみ。channel は含まない（Adapter 内部管理）
    peerRepo.getConnected.mockReturnValue([
      { id: "peer-b", connectedAt: Date.now() },
      { id: "peer-c", connectedAt: Date.now() },
    ]);

    await usecase.execute(validMsg);

    expect(postRepo.save).toHaveBeenCalledWith(validPost, "t1", "b1");
    expect(sendToChannel).toHaveBeenCalledTimes(2);
    const [, forwarded] = sendToChannel.mock.calls[0] as [
      string,
      GossipMessage,
    ];
    expect(forwarded.ttl).toBe(2);
    expect(forwarded.path).toContain("self-id");
  });

  it("test_receiveMessage_invalidSignature_rejectsWithoutSaving", async () => {
    vi.spyOn(crypto, "verifySignature").mockResolvedValue(false);

    await usecase.execute(validMsg);

    expect(postRepo.save).not.toHaveBeenCalled();
    expect(sendToChannel).not.toHaveBeenCalled();
  });

  it("test_receiveMessage_duplicateHash_skipsWithoutSaving", async () => {
    await usecase.execute(validMsg);
    postRepo.save.mockClear();
    sendToChannel.mockClear();

    await usecase.execute(validMsg);

    expect(postRepo.save).not.toHaveBeenCalled();
    expect(sendToChannel).not.toHaveBeenCalled();
  });
});
```

---

## 実行時バリデーション

外部境界から入ってくるデータは必ず検証する。`as Type` キャストで信頼しない。

| 境界                            | 方法                            | 失敗時               |
| ------------------------------- | ------------------------------- | -------------------- |
| IndexedDB 読み込み（Post）      | `PostSchema.safeParse`          | warn ログ + スキップ |
| BroadcastChannel 受信           | `GossipMessageSchema.safeParse` | warn ログ + スキップ |
| 将来の WebRTC DataChannel 受信  | `GossipMessageSchema.safeParse` | warn ログ + スキップ |
| IndexedDB 読み込み（CryptoKey） | `instanceof CryptoKey`          | null 扱い → 再生成   |

### 型定義と zod スキーマのセット定義

ドメインモデル（Post, GossipMessage）は **各モデルファイルで zod スキーマと `z.infer` による型導出をセット**で定義する。
手書きの型定義と zod スキーマを別ファイルに分離しない。

```typescript
// src/core/domain/model/Post.ts
import { z } from "zod";

export const PostSchema = z.object({
  id: z.string(),
  // ...
});

export type Post = z.infer<typeof PostSchema>;
```

### CryptoKey の特例

CryptoKey は opaque オブジェクトで zod では検証できない。`instanceof CryptoKey` で最低限ガードする。

```typescript
// ✅ CryptoKey の instanceof ガード
if (
  record.privateKey instanceof CryptoKey &&
  record.publicKey instanceof CryptoKey
) {
  return { privateKey: record.privateKey, publicKey: record.publicKey };
}
return null; // 破損 → 再生成にフォールバック
```

---

## コールバックの書き方

コールバック登録時、アロー関数の中身が宣言的に読めるかで判断する。メソッド名だけで意図が伝わるならインラインで良い。処理の流れを読み込まないと意図がわからないなら名前付きメソッドに委譲する。

### OK: 各行が自明なメソッド呼び出しで、ブランチがないならインライン

```typescript
button.onClick(() => setCount(count + 1));

dc.onClose(() => {
  this.channels.delete(peerId);
  this.heartbeat.removePeer(peerId);
  this.removeSession(peerId);
});
```

複数行でも、上から読んで意図がわかるなら OK。

### NG: パース・ブランチ・エラーハンドリングをインラインに書く

```typescript
dc.onMessage((raw) => {
  try {
    const result = DataChannelMessageSchema.safeParse(JSON.parse(raw));
    if (!result.success) return;
    if (result.data.type === "heartbeat") {
      this.heartbeat.receiveFrom(peerId);
    }
  } catch {
    /* ignore */
  }
});
```

### OK: 名前付きメソッドに委譲

```typescript
dc.onMessage((raw) => this.handleHeartbeat(peerId, raw));
```

```typescript
private handleHeartbeat(peerId: string, raw: string): void {
  try {
    const result = DataChannelMessageSchema.safeParse(JSON.parse(raw));
    if (!result.success) return;
    if (result.data.type === "heartbeat") {
      this.heartbeat.receiveFrom(peerId);
    }
  } catch { /* ignore malformed messages */ }
}
```

### ISP: 振る舞いとイベントのインターフェース分離

コールバックを登録できるインターフェースは、振る舞い（送信側）とイベント（受信側）を分離する。

```typescript
// 送信側: send/close だけ
interface IDataChannel {
  send(data: string): void;
  close(): void;
}

// 受信側: イベント登録だけ
interface IDataChannelEvents {
  onMessage(handler: (data: string) => void): () => void;
  onOpen(handler: () => void): () => void;
  onClose(handler: () => void): () => void;
}
```

異なるコンテキストで異なるメソッドだけを使う場合に適用する。同じコンテキストで全メソッドを使うインターフェースには分離不要。

## よくある落とし穴

| 落とし穴                                                       | 対処                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| UseCase 内で Adapter を直接 import                             | インターフェース経由で注入。Smart Component が具象を持つ                                 |
| Domain 型のフィールドが mutable                                | 全フィールド `readonly`。更新はスプレッドで                                              |
| 重複判定を署名検証より前に行う                                 | **必ず署名→ハッシュ→重複の順**（seen 汚染攻撃を防ぐ）                                    |
| ファンアウトで path 済みピアを含む                             | `filter((p) => !forwarded.path.includes(p.id))` を忘れずに                               |
| TTL が 0 以下でも転送する                                      | `if (msg.ttl <= 0) return;`                                                              |
| 非対応ブラウザで Ed25519 を使う                                | 起動時に `crypto.subtle.generateKey("Ed25519", ...)` で対応確認                          |
| Domain の Peer に connection / channel を持たせる              | Peer は `{ id, connectedAt }` のみ。RTCDataChannel は Adapter の channels Map で管理     |
| テスト内でクラスを再定義する                                   | 必ず `src/` から import する。再定義は禁止                                               |
| `biome-ignore` / `eslint-disable` などの警告抑制コメントを使う | 禁止。根本原因を修正すること。型エラーは `as any` で握り潰さず、正しい型・設計で解決する |

## 実装フロー（CLAUDE.md より）

1. Domain 型 + Repository インターフェースを定義
2. UseCase を実装（Adapter import なし、CryptoService 経由で暗号操作）
3. Adapter（WebCryptoSigner, PeerAdapter 等）を実装
4. Smart Component で Adapter → CryptoService → UseCase の順に注入
