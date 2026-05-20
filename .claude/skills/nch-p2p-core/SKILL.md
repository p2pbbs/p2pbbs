---
name: nch-p2p-core
description: >
  nch P2P 層（domain / usecase / adapter）の実装ガイド。domain/, usecase/, adapter/ 配下の
  ファイルを新規作成・編集するとき、WebRTC・ゴシップ・署名・ハッシュ・ピア管理・シグナリング・
  IndexedDB について言及されたとき、P2P の設計判断を相談されたときに必ず参照すること。
---

# nch P2P Core — 実装ガイド

> **このドキュメントについて**: コードブロックはすべて設計意図の説明用です。実実装はリポジトリの該当ファイルを参照してください。スキルとコードの間にズレがあった場合はリポジトリ側が正です。

## アーキテクチャ概要

依存方向: `UI → UseCase → Domain ← Adapter`

- **Domain**: 純粋な型定義・インターフェース・ロジック。ブラウザ API / React に依存しない
- **UseCase**: ビジネスロジックの調整役。Domain インターフェースのみに依存する。adapter/ を直接 import しない
- **Adapter**: Domain インターフェースの具象実装（WebRTC, WebSocket, IndexedDB, WebCrypto）
- **UI Smart Component**: Adapter を UseCase にコンストラクタ注入して繋ぐ唯一の場所

### Domain 型の設計原則

実定義は `src/core/domain/model/` を参照。以下は設計意図。

- **Post.id は SHA-256 コンテンツハッシュ**。DB の自動採番でなく内容が ID になるため、どのノードで生成しても同じ id になる。これにより重複排除が content-addressed になる
- **Post の全フィールドは `readonly`**。更新はスプレッドで行い、ミュータブルな操作を禁止する
- **Peer は `{ id, connectedAt }` のみ**。RTCPeerConnection / RTCDataChannel は Adapter が内部管理し、Domain 層には公開しない。Peer 型に通信手段を持たせない
- **GossipMessage は Post の封筒**。`ttl`（ホップ上限）と `path`（通過済みピア ID の配列）でループを防ぐ。boardId / threadId は GossipMessage が持たず、Post が持つ

### Domain インターフェースの設計原則

実定義は `src/core/domain/port/` を参照。以下は設計意図。

- **`IPeerRepository.getConnected()`** はオープン状態のピアのみを返す。Adapter が DC open 時に登録・close 時に削除するため、全件が接続済みと保証されている。UseCase 側でフィルタ不要
- **ISignalingRepository** は「最初の1ピアを紹介する」ブートストラップ役のみ。接続後のピア発見はゴシップ経由。シグナリングサーバー同士は同期不要で、複数存在してよい

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

UseCase が依存する唯一の暗号抽象。ステートレス操作は直接実装し、ステートフル操作は ISigner に委譲する。
実装は `src/core/domain/service/CryptoService.ts` を参照。

### WebCryptoSigner（src/adapter/crypto/WebCryptoSigner.ts）

ISigner の Adapter 実装。Ed25519 鍵ペアをメモリ内（extractable: false）で保持し、
`generateKeyPair` / `sign` / `deriveOdId` を Web Crypto API で実装する。
ステートレスな `verifySignature` は持たない（CryptoService の責務）。
実装は `src/core/adapter/crypto/WebCryptoSigner.ts` を参照。

---

## UseCase の 2 類型

nch の UseCase はパイプライン型とプロトコル型に分かれる。

### P2P の原則: 自分以外のノードは状態機械

P2P では他ノードの内部状態を直接知る方法がない。知れるのは「相手から何が届いたか」と「DC が開いてるか閉じてるか」だけ。各ピアについて「観測したシグナルに基づくローカルな状態モデル」を明示的に持つ。

### パイプライン型

単発のメッセージを上から下に処理する。エントリポイントは 1 つ（`execute`）。ステートレスか、状態があっても副次的（seen Set 等）。

#### 骨格

```typescript
class PipelineUseCase {
  // 状態は副次的なものだけ（重複排除など）
  private readonly seen = new Set<string>();

  async execute(message: Message): Promise<void> {
    // 1. 検証ステップ群（失敗したら即 return。順序が重要）
    if (!(await this.validate(message))) return;

    // 2. 重複排除（検証パスしたものだけ seen に登録）
    if (this.seen.has(message.id)) return;
    this.seen.add(message.id);

    // 3. 保存
    await this.store(message);

    // 4. 転送（TTL / ファンアウト等のガードを含む）
    await this.forward(message);
  }
}
```

この構造により:

- **順序の強制**: 各ステップが独立した `if` ブロックになるため、ステップの順序入れ替えがコード上で明示される
- **早期リターン**: 検証失敗・重複・TTL 切れは即 return。ネストしない
- **seen は検証後**: 重複判定を検証より前に置かない（seen 汚染攻撃を防ぐ）

#### UseCase: ReceiveMessageUseCase

受信した GossipMessage を検証・保存・転送する。nch のホットパス。

**パイプライン順序（この順序を守ること）:**
`署名検証 → ハッシュ検証 → 重複判定 → 保存 → TTL チェック → ファンアウト`

> **重複判定を署名検証より前に行ってはいけない。**
> 攻撃者が既知の post.id を持つ不正メッセージを先に送ると、署名検証なしで seen に登録されてしまい、
> 後から届く本物のメッセージがスキップされる。必ず署名・ハッシュで正当性を確認してから seen に追加する。

実装は `src/core/usecase/ReceiveMessageUseCase.ts` を参照。

#### UseCase: PostMessageUseCase

ReceiveMessageUseCase と同じパイプライン型。`crypto.sign` → `postRepo.save` → ファンアウトの順。
実装は `src/core/usecase/PostMessageUseCase.ts` を参照。

### プロトコル型

複数のピアと継続的にやり取りする。エントリポイントが複数（`onPeerConnected`, `onPeerDisconnected`, `onXxxReceived` 等）。ピアごとの状態機械を内部に持つ。

例: ExchangeDigestUseCase, HeartbeatTracker, CYCLONShuffleUseCase

#### 実装パターン

```typescript
type PeerState = "awaiting" | "received"; // プロトコルごとに定義

class ProtocolUseCase {
  // 1. ピアごとの状態を型付き Map で保持
  //    Map にキーが存在する = DC open 中。削除 = DC close
  //    値 = プロトコル上の状態
  /** DC open 中のピアのプロトコル状態。DC close でエントリ削除。 */
  private readonly connectedPeers = new Map<string, PeerState>();

  // 2. 各イベントは「状態遷移 + 副作用」として書く
  onPeerConnected(peerId: string): void {
    this.connectedPeers.set(peerId, "awaiting");
    this.sendInitialMessage(peerId); // 副作用
  }

  onPeerDisconnected(peerId: string): void {
    this.connectedPeers.delete(peerId); // チャーン: エントリごと消える
    this.evaluate();
  }

  onMessageReceived(peerId: string, message: T): void {
    if (!this.connectedPeers.has(peerId)) return; // 未知のピアは無視
    this.connectedPeers.set(peerId, "received");
    this.evaluate();
  }

  // 3. 集約判定は全ピアの状態を宣言的に検査する
  private evaluate(): void {
    // 1回収束型: 全ピアが条件を満たしたか判定（ExchangeDigestUseCase）
    // 継続型: 状態に応じて次のアクションを決定（HeartbeatTracker, CYCLON）
  }
}
```

この構造により:

- **チャーン耐性**: DC close でエントリが削除されるため、切断ピアの状態が残らない
- **状態の可視性**: Map の中身を見れば全ピアの現在の状態が一覧できる
- **テスト容易性**: 状態遷移のカバレッジでテストケースを設計できる

#### 通信パターンと命名

P2P の通信パターンに応じて語彙を使い分ける。

| パターン                          | nch の例                  | 使う語彙                | 避ける語彙                    |
| --------------------------------- | ------------------------- | ----------------------- | ----------------------------- |
| 双方向 push（互いに送りつけ合う） | digest 交換               | exchange, send/receive  | request/response, query/reply |
| 片方向 push                       | gossip, sync push         | broadcast, push, fanout | —                             |
| request-response                  | シグナリング offer/answer | request, respond        | —                             |

状態名は「自分が何を観測したか」で命名する。「相手に何を期待してるか」で命名しない。

- ✅ `"awaiting"` / `"received"` — 自分がまだ受け取ってない / 受け取った
- ❌ `"responded"` / `"pending"` — 相手が応答した / 応答待ち

---

## Adapter: PeerAdapter（RTCPeerConnection ライフサイクル）

PeerAdapter には2実装がありうる。Domain/UseCase はどちらかを知らない。

- **ブラウザ版（WebRTCPeerAdapter）**: WebRTC DataChannel で通信。ブラウザで動く
- **Node.js 版（NodePeerAdapter）**: シードノード用。WebSocket や Node.js の net モジュールで通信

> **設計の鉄則**: Domain の `Peer` 型は `{ id, connectedAt }` のみ。RTCPeerConnection / RTCDataChannel は
> Adapter が内部の `channels` Map で管理し、Domain 層には一切公開しない。

Adapter がこの境界を守る仕組みは以下の意図で実装する：

```typescript
// channels は Adapter の内部管理。Domain の Peer 型には含まない
private readonly channels = new Map<string, RTCDataChannel>();

// DC open → Peer を登録（id + connectedAt のみ）
channel.onopen = () => {
  this.channels.set(peerId, channel);
  this.peerRepo.add({ id: peerId, connectedAt: Date.now() });
};

// DC close → 両方から削除
channel.onclose = () => {
  this.channels.delete(peerId);
  this.peerRepo.remove(peerId);
};
```

実装は `src/core/adapter/peer/WebRTCPeerAdapter.ts` を参照。

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

テスト設計の詳細は nch-testing スキルを参照。

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
| ピアごとの状態を Set + count 等で暗黙管理する                  | 明示的な型付き `Map<peerId, State>` で管理。状態遷移が型から読めるようにする             |
| プロトコル型 UseCase で req/res 語彙を使う                     | 双方向 push は「送りつけ合う」。`responded` ではなく `received`                          |
| 初期化の循環依存を Smart Component に露出させる                | `bootstrap()` 関数に `let` + クロージャの時間的結合を封じ込める                          |

## 実装フロー（CLAUDE.md より）

1. Domain 型 + Repository インターフェースを定義
2. UseCase を実装（Adapter import なし、CryptoService 経由で暗号操作）
3. Adapter（WebCryptoSigner, PeerAdapter 等）を実装
4. Smart Component で Adapter → CryptoService → UseCase の順に注入

### Bootstrap パターン

手動 DI で UseCase 同士に循環依存が発生する場合（UseCase A のコールバックが UseCase B を呼び、UseCase B のコンストラクタに UseCase A が必要、等）、`bootstrap()` 関数に `let` + クロージャの時間的結合を封じ込める。

```typescript
// src/ui/bootstrap.ts
export function bootstrap(deps: ...): BootstrapResult {
    // let + closure の時間的結合はここに封じ込め
    let useCaseA: UseCaseA;
    const adapter = new Adapter((peerId) => useCaseA.onEvent(peerId));
    useCaseA = new UseCaseA(adapter);
    return { adapter, useCaseA };
}
```

Smart Component は `bootstrap()` の戻り値だけを受け取る。`?.` による null ガードは不要になる。循環を閉じ込める `let` が 2 個を超えたら bootstrap 関数への切り出しを検討する。
