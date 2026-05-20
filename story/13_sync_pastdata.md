# [Story 13] 過去データの自動取得

## ユーザーストーリー

掲示板に新しく参加した利用者として、板にどのスレが存在するか、各スレにどのような投稿があるかが自動的に画面に反映され、自分の書き込みも既存利用者の画面で正しい順序に並ぶ。

## 概要

P2P 掲示板では、新規参加したノードは過去のデータを持っていない。本ストーリーでは、接続先のピアから「どのスレにどれだけの投稿があるか」というメタ情報（digest）を交換し、それに基づいて不足している投稿データ（sync）を自動的にやり取りする仕組みを実装する。

digest は軽量なメタ情報の交換、sync は実際の投稿データの送受信であり、この 2 段階に分離することで Lamport クロックの同期を先に行い、投稿順序の正しさを保証してから過去データを取得できる。

ADR「P2P データ同期戦略」（docs/adr_sync_strategy.md）に基づく。

## 達成条件

本ストーリー全体（13a + 13b）が完了した時点で、以下が達成されている。

- 新しく板を開いた利用者の画面に、既存のスレ一覧と過去の投稿が自動的に表示される
- 投稿順序が全ノードで整合している
- 過去データの取得が完了するまで投稿フォームが無効化され、準備完了後に有効化される
- 改竄された投稿や重複投稿が画面に表示されない

## プロトコル設計

```typescript
type DataChannelMessage =
  | { type: "gossip"; message: GossipMessage }
  | { type: "heartbeat" }
  | { type: "digest"; boardId: string; threads: ThreadDigest[] }
  | { type: "sync"; boardId: string; posts: Post[] };

type ThreadDigest = {
  threadId: string;
  maxLamport: number;
  postCount: number;
};
```

- **digest**: スレごとのメタ情報。軽量。ピアが情報を持っていない場合でも空配列 `threads: []` を即座に返す。これにより受信側は「応答した／応答していない」を常に判定できる
- **sync**: 実際の投稿データ。重量。1 メッセージあたり最大 100 件。超える場合は分割送信
- digest / sync は `boardId` を必ず含む。MVP は 1 板固定だが、複数板対応時にプロトコル互換性を保つため

## 定数

| 名前 | 値 | 根拠 |
|------|-----|------|
| digest 定期送信間隔 | 10 秒 | ADR 準拠 |
| sync 1 メッセージあたり最大件数 | 100 | 100 件 × 約 500 bytes ≒ 50 KB。DataChannel 上限（Chrome 256 KB）に対して十分な余裕 |
| `LamportClock.MAX_LAMPORT` | 1000 | スレ最大レス数（1,000）準拠。この値を超える Lamport 値は拒否する |

## ユビキタス言語（追加）

| 用語 | 英語 | 意味 |
|------|------|------|
| ダイジェスト | ThreadDigest | スレの要約情報。threadId / maxLamport / postCount を含む |
| 投稿可能 | Postable | 接続中のピア全員から digest を受信し、投稿フォームが有効化された状態 |

---

# [Story 13a] Digest 交換と投稿フォーム制御

## ユーザーストーリー

掲示板に新しく参加した利用者として、接続しているピアとの情報交換が完了するまで投稿フォームが無効化され、準備が整った時点で有効化される。投稿順序が既存利用者と正しく整合する。

## 受け入れ条件

- [ ] 板を開くと、接続しているピアとの間でスレの一覧情報（各スレの投稿件数や進行度）が自動的に交換される
- [ ] 情報交換が完了するまでの間、投稿フォームは無効化されており書き込めない
- [ ] digest 未着の直接ピアがいなくなり、かつ少なくとも 1 ピアから digest を受信済みの時点で、投稿フォームが有効化される
- [ ] 接続先のピアが全員新規参加で情報を持っていなかった場合も、応答を受け取った扱いとなり投稿フォームが有効化される
- [ ] 投稿フォーム有効化後の自分の書き込みは、既存利用者の画面で正しい順序（末尾）に表示される
- [ ] 自分が現在開いていない板に関する情報を受信した場合、画面の表示には影響しない

## エッジケース

- 接続できているピアが 0 人の状態では投稿フォームは無効のままとなる。エラー表示は Story 18 が担当する
- 利用中にピアが切断されても、残りのピアから応答を受け取り次第、投稿フォームが有効化される。応答しないピアは WebRTC 層の heartbeat タイムアウトにより切断され、投稿可能判定の対象から除外される
- 悪意のあるピアが Lamport クロックの値を偽って送ってきた場合でも、スレの最大レス数（1,000）を超える値は無視される
- 投稿フォーム有効化後に新しいピアが接続してきても、投稿フォームの状態は変化しない

## 影響範囲

- domain: DataChannelMessage に digest variant 追加、ThreadDigest 型新規、LamportClock に safeMerge 追加
- usecase: ExchangeDigestUseCase 新規
- adapter: WebRTCGateway にピア指定送信 + digest ディスパッチ追加
- ui: useCanPost フック新規、PostForm 無効化制御
- docs: CLAUDE.md ユビキタス言語表更新、ADR 改訂

## 見積もり

M

---

# [Story 13b] 過去データの Sync

## ユーザーストーリー

掲示板に新しく参加した利用者として、それ以前に他の利用者が作成したスレと書き込んだ投稿が自動的に画面に表示される。

## 前提

Story 13a（Digest 交換と投稿フォーム制御）が完了していること。ExchangeDigestUseCase が各ピアの ThreadDigest を把握済みの状態で、その差分に基づいて sync を行う。

## 受け入れ条件

- [ ] 板を開いた直後、他の利用者が作成済みのスレの一覧が自動的に画面に表示される
- [ ] スレを開くと、他の利用者がそれ以前に書き込んだ過去の投稿が自動的に画面に表示される
- [ ] 過去投稿の件数が多い場合、届いたものから順に画面へ追加されていく
- [ ] 後から接続したピアが新しいスレや未取得の投稿を持っていた場合も、随時画面に追加される
- [ ] 自分が保持しているスレや投稿は、後から接続してきたピアにも自動的に届く
- [ ] 相手より自分の方が多く投稿を持っているスレがあれば、不足分を自動的に送る
- [ ] 署名やハッシュが一致しない投稿は受信しても画面に表示されない
- [ ] 同じ投稿が複数の経路から届いた場合でも、画面上は重複表示されない

## エッジケース

- 大量の過去投稿を一度に送信する場合、1 回の送信あたりの上限（100 件）を超えないように分割される。受信側も 101 件以上を含む送信を受け取った場合は拒否する
- 通常の投稿受信（ゴシップ経由）と過去投稿の取得が同時に発生しても、重複排除により二重に表示されることはない
- 過去投稿の検証パイプライン（署名・ハッシュ検証）は通常の投稿受信と同じ基準が適用されるが、受け取った過去投稿は他のピアへ再転送されない

## 影響範囲

- domain: DataChannelMessage に sync variant 追加、PostVerifier 新規（ReceiveMessageUseCase から検証パイプラインを切り出し）
- usecase: ReceiveMessageUseCase リファクタ（PostVerifier 経由に変更、外向き挙動不変）、ExchangeDigestUseCase に sync push ロジック追加
- usecase: ExchangeDigestUseCase に定期 digest 送信（10 秒間隔）+ 差分追跡（lastSentState）を追加
- adapter: WebRTCGateway に sync ディスパッチ追加
- docs: ADR 改訂

## 見積もり

M

---

# 設計メモ（実装着手者向け）

受け入れ条件には含まれない参照情報。

## 主要シグネチャ

```typescript
// src/core/usecase/ExchangeDigestUseCase.ts
class ExchangeDigestUseCase {
  constructor(boardId: string, /* deps... */) {}
  canPost(): boolean;
  subscribe(handler: () => void): () => void;
}

// src/core/domain/service/LamportClock.ts
class LamportClock {
  safeMerge(incoming: number): void; // incoming > MAX_LAMPORT(1000) は無視 + warn ログ
}

// src/core/domain/service/PostVerifier.ts（13b で新規）
class PostVerifier {
  // 署名検証 → ハッシュ検証 → seen 重複排除 → 保存 → clock merge
  // この順序を守る。特に clock merge は save の後（既存テストで検証済みの制約）
}

// src/ui/hooks/useCanPost.ts
function useCanPost(useCase: ExchangeDigestUseCase): boolean;
// usePosts と同形: useSyncExternalStore で canPost() を購読
```

## WebRTCGateway 拡張

現在の `send(msg)` は全チャンネルへのブロードキャスト。digest / sync はピアごとに内容が異なるため、ピア指定送信が必要。

```typescript
// 既存: ブロードキャスト（gossip 用）
send(msg: GossipMessage): void;

// 追加: ピア指定送信（digest / sync 用）
sendTo(peerId: string, msg: DataChannelMessage): void;
```

## PostVerifier の責務境界（13b）

ReceiveMessageUseCase のパイプラインを分割する。

ReceiveMessageUseCase に残す処理:

1. スキーマ検証（GossipMessageSchema.safeParse）
2. self-path チェック（path に selfId が含まれていたらスキップ）
3. **PostVerifier 呼び出し**
4. TTL チェック
5. ファンアウト（gateway.send）

PostVerifier が担う処理:

1. 署名検証
2. ハッシュ検証
3. seen 重複排除
4. 保存
5. clock merge（保存の後。この順序は既存テストで検証済み）

sync 受信では PostVerifier のみ呼び出し、ファンアウトしない。

## ExchangeDigestUseCase のピア接続認知

ピアの接続・切断を知る必要がある。コンストラクタでコールバックを注入するか、IPeerRepository の変更を subscribe する形で実現する。判断は 13a 実装時に確定。

## 複数板拡張への配慮

MVP は 1 板 1 スレ固定だが、以下の点で将来の複数板対応に備える。

- digest / sync メッセージに `boardId` を必ず含める
- ExchangeDigestUseCase はコンストラクタで `boardId` を受ける
- 受信した digest / sync の `boardId` が自分のものと一致しない場合は無視する

将来の複数板対応（Epic 候補）では、板単位の P2P mesh 設計、シグナリングの板別ピア紹介、板切替時の WebRTC 再接続などを扱う。

## 関連チケット

| ID | タイトル |
|----|----------|
| Epic（候補）| 複数板対応: 板単位 mesh、シグナリングの板別ピア紹介、UI 板切替 |
| Story 15 | `thread_created` の gossip 即時伝播 |
| Story 16 | FANOUT 5 → 8 + CLAUDE.md ユビキタス言語表修正 |
| Story 17 | MAX_ACTIVE_PEERS = 8 と CYCLON シャッフル導入 |
| Story 18 | ローディング UI + 接続エラー表示 + 接続ピア数表示 |
| Story 19 | 部分欠損検知後の補完プロトコル（postIds 交換）|
