# [Story 15] 板・スレ対応

## ユーザーストーリー

掲示板のユーザーとして、複数の板から好きな板を選び、板の中で複数のスレを閲覧でき、新しいスレを立てられる。

## 概要

MVP では 1 板 1 スレ固定だったが、本ストーリーで複数板・複数スレに対応する。板一覧は constants に定数定義（mona, yaruo）し、スレはユーザーが自由に作成できる。

スレ作成は gossip で即座に全ノードに伝播し（約 6 秒で到達）、新規参加ノードは anti-entropy（digest 交換 → sync push）で既存スレを発見する。スレメタデータ（Thread エンティティ）は sync メッセージに同梱されるため、新規参加者は digest 交換の直後にスレ一覧を表示できる。

UI は pull モデルを採用する。store はネットワークからのデータで常時更新されるが、UI は自分のタイミング（ページ遷移時・pull-to-refresh）で store を読みに行く。これにより「クリック先がズレる」「読んでる途中にリストが並び替わる」を防ぐ。将来的に core がライブラリ化され、UI が自由に差し替えられる構造の第一歩でもある。

## 全体の受け入れ条件

- [ ] 板一覧画面で mona と yaruo の 2 板が表示される
- [ ] 板を選択するとスレ一覧が表示される（勢い順）
- [ ] スレを選択するとレス一覧が表示される
- [ ] 新規スレを作成できる（タイトル + 本文。本文が >>1 になる）
- [ ] スレ作成は gossip で即座に全ノードに伝播する
- [ ] 新規参加ノードが既存スレを digest 交換 → sync で発見できる
- [ ] 1 板あたり最大 100 スレ。上限到達時は最古のスレが消える（FIFO）
- [ ] 1 スレあたり最大 1000 レス。上限到達時は投稿フォームが無効化される
- [ ] スレタイトルは日本語約 50 文字（150 bytes）以内
- [ ] Thread エンティティは Ed25519 署名付き。改竄されたスレは表示されない
- [ ] 板切り替え時に WebRTC 接続を再構築する
- [ ] ブラウザリロード後もスレ一覧が復元される（IndexedDB 永続化）
- [ ] スレ一覧・レス一覧は pull-to-refresh で更新する（自動更新しない）
- [ ] レス一覧でスレ遷移後に追加されたレスが「新着」としてわかる

## 設計判断

### Thread エンティティ

```typescript
type Thread = {
  readonly threadId: string;   // String(createdAt) — Unix ms の文字列（13桁）
  readonly boardId: string;
  readonly title: string;
  readonly createdAt: number;
  readonly signature: string;  // Ed25519
  readonly publicKey: string;
};
```

threadId は createdAt（Unix ms）の文字列表現。5ch の dat と同じ発想。100 スレ程度で同一 ms 衝突はほぼ起きない。万一衝突した場合は先着が勝ち、後着は重複排除される。postId（64 hex chars）と違い URL に出るため短さを優先した。署名が全フィールドを含むため改竄は防止される。将来の投稿クォータ / PoW のため署名を付与する。

### GossipMessage 拡張

```typescript
type GossipMessage =
  | { type: "post"; post: Post; ttl: number; path: string[] }
  | { type: "thread_created"; thread: Thread; post: Post; ttl: number; path: string[] }
```

thread_created は Thread + >>1 Post をアトミックに伝播する。

### sync メッセージ拡張

```typescript
{ type: "sync", boardId: string, posts: Post[], threads: Thread[] }
```

相手が持っていない threadId の Thread エンティティを sync に同梱する。これにより anti-entropy 経路でもスレタイトルが取得でき、スレ一覧を表示できる。

### ThreadDigest（変更なし）

```typescript
type ThreadDigest = { threadId: string; maxLamport: number; postCount: number; };
```

dcmessage.ts から独立ファイルに移動するが、型自体は変更なし。digest はスレの要約であり、title 等の静的情報は含めない（digest の軽量性を維持）。

### LamportClockMap

`Map<threadId, LamportClock>` でスレ単位の clock を管理。存在しない threadId にアクセスしたら lamport 0 の新規 clock を自動生成。MAX_LAMPORT は据え置き 1000（スレ単位）。

### UI の 3 層モデル

```
Network (WebRTC) → Store (InMemory + IndexedDB、常時最新) → UI (pull で読み取り)
```

UI hooks は useState + refresh callback で実装。useSyncExternalStore は使わない（push モデルの排除）。hooks ディレクトリは既存の `/ui/hooks/` をそのまま使い、`useThreadList` / `usePostList` を追加する。

### Thread 検証パイプライン

1. Thread 署名検証
2. threadId === String(createdAt) 一致チェック
3. Post 署名・ハッシュ検証（PostIngester 経由）
4. post.threadId === thread.threadId 一致チェック
5. threadId で重複排除
6. Thread 保存 + Post 保存
7. TTL チェック → ファンアウト

### 定数

```typescript
const BOARDS = [
  { boardId: "mona", name: "モナー" },
  { boardId: "yaruo", name: "やる夫" },
] as const;

const GENESIS_THREADS: Record<string, Thread> = { ... }; // 各板に 1 つ

const MAX_THREADS_PER_BOARD = 100;
const MAX_POSTS_PER_THREAD = 1000;
const MAX_THREAD_TITLE_BYTES = 150;
```

### ルーティング

```
/                              → BoardListView（板一覧）
/board/:boardId                → ThreadListView（スレ一覧）
/board/:boardId/:threadId      → ThreadView（スレ表示）
```

---

## [Story 15a] Domain 層 — Thread エンティティ・署名・定数・LamportClockMap

### 概要

Thread エンティティの型定義、署名・検証の CryptoService 拡張、GossipMessage への thread_created 追加、LamportClock のスレ単位化、板・スレの定数定義を行う。15b 以降の基盤となる型とインターフェースを整える。

### 受け入れ条件

- [ ] Thread 型 + ThreadSchema（zod）が定義されている。全フィールド readonly
- [ ] threadId が String(createdAt)（Unix ms の文字列、13桁）で生成される
- [ ] タイトルが 0 bytes または 151 bytes 以上の Thread は ThreadSchema で reject される
- [ ] GossipMessage に type: "thread_created" が追加され、Thread + Post をアトミックに運べる
- [ ] CryptoService で Thread の署名検証ができる
- [ ] ISigner / WebCryptoSigner で Thread に署名できる
- [ ] IThreadStore インターフェースが定義されている（save, getByBoard, has, subscribe）
- [ ] LamportClockMap がスレ単位で clock を管理する。未知の threadId には lamport 0 の clock を自動生成
- [ ] constants に BOARDS（mona, yaruo）、GENESIS_THREADS、MAX_THREADS_PER_BOARD、MAX_POSTS_PER_THREAD、MAX_THREAD_TITLE_BYTES が定義されている
- [ ] ThreadDigest が dcmessage.ts から独立ファイルに移動されている（型は変更なし）

### エッジケース

- 同一 ms に2ノードがスレ作成: threadId 衝突で先着が勝つ。100 スレ規模での衝突確率は無視できる
- GENESIS_THREADS の署名: ビルド時に固定鍵で署名するか、検証パイプラインで genesis threadId をスキップするか要判断

### 影響範囲

- `domain/model/` — Thread.ts(新規), ThreadDigest.ts(移動), GossipMessage.ts(拡張)
- `domain/port/` — IThreadStore.ts(新規), ISigner.ts(拡張)
- `domain/service/` — CryptoService.ts(拡張), LamportClockMap.ts(新規)
- `adapter/crypto/` — WebCryptoSigner.ts(拡張)
- `config/constants.ts`(拡張)

### 見積もり

M

---

## [Story 15b] Store 層 — ThreadStore 実装・sync メッセージ拡張

### 概要

Thread エンティティの永続化（InMemoryThreadStore + IndexedDBThreadStore のハイブリッド構成）と、sync メッセージへの Thread 同梱を実装する。これにより anti-entropy 経路でスレメタデータが伝播可能になる。

### 受け入れ条件

- [ ] InMemoryThreadStore + IndexedDBThreadStore がハイブリッド構成で動作する（PostStore と同じパターン）
- [ ] 起動時に IndexedDB から Thread がメモリに読み込まれる
- [ ] Thread の save がメモリと IndexedDB の両方に書き込まれる
- [ ] DataChannelMessage の sync に threads フィールドが追加されている
- [ ] WebRTCGateway の sendSync / handleIncoming が threads を扱える
- [ ] IPostStore に getThreadIds(boardId) が追加されている
- [ ] 旧バージョンのピアから threads なしの sync を受信しても正常動作する（後方互換）

### エッジケース

- IndexedDB に不正な Thread が入っていた場合: safeParse → warn ログ + スキップ
- IndexedDB QuotaExceededError: 最古スレの Thread + 対応 Post を FIFO 削除してリトライ

### 影響範囲

- `adapter/storage/` — InMemoryThreadStore.ts(新規), IndexedDBThreadStore.ts(新規), InMemoryPostStore.ts(getThreadIds 追加)
- `adapter/gossip/` — WebRTCGateway.ts(sendSync 拡張)
- `domain/port/` — IDataSyncGateway.ts(拡張), IPostStore.ts(拡張)
- `domain/model/DataChannelMessage.ts`(sync 拡張)

### 見積もり

M

---

## [Story 15c] UseCase 層 — スレ作成・受信分岐・digest 拡張

### 概要

スレ作成（CreateThreadUseCase）、gossip 受信時の thread_created 分岐、ExchangeDigestUseCase の複数スレ対応、PostMessageUseCase の threadId 動的化を実装する。core 側でスレ機能が完結する。

### 受け入れ条件

- [ ] スレ作成を実行すると Thread（署名付き）+ >>1 Post（署名付き）が生成され、gossip で伝播される
- [ ] 100 スレ上限到達時にスレ作成すると、最古スレが FIFO で evict される
- [ ] thread_created を gossip で受信したとき、Thread 検証パイプライン（署名→threadId一致→Post検証→紐づけチェック）を通過したもののみ保存される
- [ ] thread_created 受信時も 100 スレ上限チェックが走り、超過時は FIFO evict
- [ ] ExchangeDigestUseCase が全スレの ThreadDigest を動的に構築して送信する（threadId 固定の廃止）
- [ ] sync push 時に、相手が持っていない Thread エンティティが sync に同梱される
- [ ] sync 受信時に Thread エンティティが署名検証を経て保存される
- [ ] PostMessageUseCase が execute の引数で threadId を受け取る（config 固定の廃止）
- [ ] 1000 レス上限到達時に投稿が拒否される
- [ ] LamportClock がスレ単位で管理される
- [ ] bootstrap 時にジェネシススレが IThreadStore に初期ロードされる

### エッジケース

- thread_created の Post が gossip で先に届き Thread が後から届く: Post は保存される。Thread 到着後にスレ一覧に現れる
- 同時スレ作成で threadId 衝突（同一 ms）: 先着が勝ち、後着は重複排除される
- sync の Thread 署名検証失敗: Thread を無視、Post のみ保存
- FIFO evict 対象のスレに自分の投稿がある場合でも容赦なく evict（P2P ノード間不整合は許容）
- ブラウザストレージ上限: IndexedDB の QuotaExceededError → 最古スレの Thread + 対応 Post を FIFO 削除

### 影響範囲

- `usecase/` — CreateThreadUseCase.ts(新規), ReceiveMessageUseCase.ts(分岐追加), ExchangeDigestUseCase.ts(大幅改修), PostMessageUseCase.ts(threadId 動的化)
- `domain/service/` — PostIngester.ts(LamportClockMap 対応)
- `ui/bootstrap.ts` — CreateThreadUseCase の DI、LamportClockMap 注入、ジェネシススレ初期ロード

### 見積もり

L

---

## [Story 15d] UI 層 — React Router・板一覧・スレ一覧・スレ作成

### 概要

React Router を導入し、板一覧・スレ一覧・スレ表示の 3 画面を実装する。UI は pull モデルで store を読み取り、ページ遷移時と pull-to-refresh でスナップショットを更新する。

シグナリングサーバーを板別マッチング対応に拡張する。join に boardId を追加し、同じ板のピアのみを紹介する。板切り替え時は WebRTC 接続を切断して新しい板のピアに接続し直す。

### 受け入れ条件

#### シグナリングサーバー

- [ ] join メッセージに boardId フィールドが追加されている（required）
- [ ] シグナリングサーバーが `Map<boardId, Set<peerId>>` + `Map<peerId, boardId>` でピアを管理し、同じ板のピアのみを peers レスポンスで返す
- [ ] signal リレー時に from と to が同じ板にいるか検証し、板をまたぐ signal は drop する
- [ ] WebSocket close 時に両 Map からエントリを O(1) で削除する
- [ ] IPeerDiscovery.discover に boardId 引数が追加されている
- [ ] WebSocketSignalingTransport.discover が boardId を join に含めて送信する
- [ ] 再接続時の join 再送にも boardId を含める
- [ ] 板切り替え時に既存の WebRTC 接続を全切断し、新しい板で discover → connectTo する
- [ ] WebSocket 接続自体は板切り替えで切断しない（使い回す）

#### UI

- [ ] `/` で板一覧が表示される（mona, yaruo）
- [ ] `/board/:boardId` でスレ一覧が勢い順で表示される
- [ ] `/board/:boardId/:threadId` でレス一覧が lamport 順で表示される
- [ ] スレ一覧にスレ作成フォームがある（タイトル + 本文 + 名前）
- [ ] スレ作成後、自分のスレが即座にスレ一覧に表示される
- [ ] 100 スレ到達時はスレ作成フォームが無効化され、メッセージが表示される
- [ ] 1000 レス到達時は投稿フォームが無効化され、メッセージが表示される
- [ ] スレ一覧は pull-to-refresh で更新される。自動更新しない
- [ ] レス一覧はスレ遷移時に自動で最新を読み込む。以降は pull-to-refresh
- [ ] レス一覧で前回の refresh 時に存在しなかったレスに新着マーカーが付く
- [ ] 板切り替え時に ExchangeDigestUseCase が dispose → 再生成される
- [ ] 存在しない boardId / threadId で「見つかりません」が表示される
- [ ] ブラウザバックで板一覧・スレ一覧に戻れる

### エッジケース

- Thread エンティティ未着のスレ（digest のみ既知）: スレ一覧に表示しない。sync で Thread が届けば次回 refresh で表示
- 勢い順の 0 除算: createdAt が未来の場合 max(1, ...) でガード
- スレ作成直後: CreateThreadUseCase 完了後に refresh を呼んで即表示
- 板切り替え中にシグナリング応答がない: SignalingTimeoutError でエラー表示
- 板切り替え直後に旧板のピアから gossip が届く: boardId フィルタで無視される（既存動作）
- 板をまたぐ signal リレー: サーバーが from/to の板一致を検証して drop（板の mesh 独立性を保証）
- 高速な板切り替え（join 連打）: WebSocket メッセージの到着順は保証されるので、サーバーは順序通り処理する
- TCP half-open（クライアントのクラッシュ）: OS の TCP keepalive タイムアウトまでエントリが残りうる。1 エントリ ≈ 50 bytes なのでMVP では実害なし。将来的に WebSocket ping/pong で刈り取る

### 影響範囲

- `signaling/` — signaling-server.ts(板別ピア管理), WebSocketSignalingTransport.ts(join に boardId 追加)
- `domain/port/` — IPeerDiscovery.ts(discover に boardId 追加)
- `domain/model/` — SignalingMessage.ts(ClientMessage の join に boardId 追加)
- `ui/hooks/` — useThreadList.ts(新規), usePostList.ts(新規), usePosts.ts(置換)
- `ui/components/` — App.tsx(Router 導入), BoardListView.tsx(新規), ThreadListView.tsx(新規), CreateThreadForm.tsx(新規), ThreadView.tsx(改修)
- `ui/bootstrap.ts` — 板切り替え時の UseCase lifecycle + 再接続
- `package.json` — react-router-dom 追加

### 見積もり

L

---

## 申し渡し事項

### プロトコル変更

- GossipMessage に thread_created variant を追加（既存の type: "post" との union）
- sync メッセージに threads フィールドを追加（後方互換: オプショナル）
- ThreadDigest は変更なし
- シグナリングの join に boardId を追加。同じ板のピアのみを紹介する

### ExchangeDigestUseCase

- threadId 固定を廃止し、IThreadStore.getByBoard で動的取得に変更
- sync push 時に未知スレの Thread エンティティを同梱
- canPost() は板単位のまま変更なし

### LamportClock

- LamportClockMap（Map<threadId, LamportClock>）に移行
- MAX_LAMPORT = 1000 はスレ単位で据え置き

### UI アーキテクチャ

- push（useSyncExternalStore）→ pull（useState + refresh）に移行
- 3 層モデル: Network → Store（常時最新）→ UI（オンデマンド読み取り）
- 将来的に core がライブラリ化され UI が差し替え可能になる構造を意識

### 関連チケット

| ID | 内容 |
|---|---|
| Story 12 | シードノード（スキップ中。全ピア退出後のデータ永続化はシードノード前提） |
| Story 14 | ロード表示（スレ一覧・レス一覧のローディング状態） |
| Story 16 | gossip ピア発見 + CYCLON シャッフル |
| 将来 | dat 落ち実装（FIFO の改善）、投稿クォータ / PoW |
