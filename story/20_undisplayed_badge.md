# [story 20] 未反映レス到着で更新ボタンを点灯させる

## ユーザーストーリー

掲示板を見ているユーザーとして、いま見ている画面に出ていないレスが P2P ネットワーク経由でストアに届いたら、更新ボタンの色が変わって「届いてる」とわかる。更新を押すと反映され、ボタンは元に戻る。

## 概要

pull モデル（Network → Store〔常時最新〕→ UI〔オンデマンド読み取り〕）では「ストアには届いているのに UI で気づけない」という弱点がある。本ストーリーはこれを補い、**リスト本体は一切再描画せず、更新ボタンの見た目だけを変える**ことでリアルタイム感を可視化する。リストを並び替えない・クリック先をズラさないという pull モデルの思想は維持する。

スコープを 2 つに分割する。

- **20a**: ThreadView（スレ表示）— 自分が能動的に読んでいる画面。「届いてる感」のコア。
- **20b**: ThreadListView（スレ一覧 = 板）— 板の中で動きがあったことを示す。

## 設計判断

### ユビキタス言語「未反映 / Undisplayed」

本機能が指すのは、**ストアには保存済みだが現在表示中のビューにまだ取り込まれていないレス**。これは次のいずれとも異なる第三の概念であり、新語を立てる。

- 未読（Unread）… 既読履歴（ReadHistory）に無いレス。基準は ReadHistory。
- ピア保有差分 … digest 比較で他ピアが持ち自分が持たない分。基準は digest。`new/新着` と呼ばない（story18 の但し書き）。
- **未反映（Undisplayed）… ストアとビューの差分**。pull（更新）で反映される。

識別子は `hasUndisplayed`。`pending` は非同期文脈で「処理待ち」と読まれて意味がブレるため避けた。UI 上の文言表現は「新着」風で構わないが、コード上の命名は `Undisplayed` に統一する。

### 検知方法（件数 / リビジョン比較）

push でリストを再描画するのではなく、**入場・更新時点のスナップショット値を baseline として ref に固定**し、ストアの現在値が baseline を上回ったら点灯する。

- 20a: `IPostStore.getSnapshot(threadId).length` を baseline と比較。store snapshot は dedup 済みのため、同一 post の再配信や低 lamport の中間挿入でも誤検知しにくい。
- 20b: 後述の `getBoardRevision(boardId)` を baseline と比較。

baseline は usePostList と同じ作法で threadId / boardId 単位に ref 固定し、StrictMode の effect 二重実行・再レンダーで消えないようにする。`refresh()` 実行時に baseline を現在値へ更新して消灯する。

### 見せ方

色変更 ＋ **数字なしのドットバッジ**。件数は出さない。色のみだと色覚多様性で判別不能になるため、「ドットの有無」という非色の手がかりを兼ねる。20a / 20b とも実質 boolean 1 個で表現する。

### 20b の board 単位ポート

新スレは `thread_created` で必ず >>1 の Post を board へ save する。したがって **board への Post save を 1 か所で拾えば、新レスも新スレも同時に拾える**。`IThreadStore` 側の購読は不要。

```ts
// IPostStore に追加（既存の threadId 単位 subscribe / getSnapshot はそのまま）
interface IPostStore {
  /** 板単位の変更通知。board 内のどのスレへの save でも発火する。 */
  subscribeBoard(boardId: string, cb: () => void): () => void;
  /** 板の単調増加リビジョン。board 内へ新規 save するたびに +1。比較用スナップショット。 */
  getBoardRevision(boardId: string): number;
}
```

InMemoryPostStore に `Map<boardId, number>`（revision）と `Map<boardId, Set<cb>>`（listeners）を 1 個ずつ持たせ、`save()` の **既存 dedup early-return の後** で revision を ++ して listeners を発火する。これにより再配信では revision が増えず、誤点灯しないことが自然に担保される。IndexedDBPostStore は既存 subscribe と同様、両メソッドを memory に委譲するだけ。

---

## [story 20a] 未反映レス到着で更新ボタンを点灯（ThreadView）

### 受け入れ条件

- [ ] ThreadView 表示中に P2P 経由で未反映レスがストアに届くと、更新ボタンの色が変わり数字なしドットが付く
- [ ] 更新ボタン押下で neutral に戻り、未反映レスが反映表示される
- [ ] スレ遷移（threadId 変化）で必ず neutral に戻る
- [ ] 自分の投稿では点灯したままにならない（投稿 → refresh で消灯する）
- [ ] リスト本体（ThreadView の posts）は購読・自動再描画しない（pull モデル維持）
- [ ] 色のみに依存せず、ドットの有無でも点灯状態を判別できる
- [ ] 検知は dedup 済み snapshot 件数の比較で行い、同一 post 再配信では点灯しない

### エッジケース

- 初回 sync（canPost false→true の auto-refresh）中は点灯しない。baseline は auto-refresh 後の件数に更新され、その後に届いた分のみ点灯する
- 同一 post が複数経路から再配信されても、件数が増えないため誤点灯しない
- ピア 0 / オフラインでは subscribe が発火せず点灯しない（save 起点のため自然に安全）
- StrictMode の effect 二重実行・再レンダーで baseline が取り直されない（threadId 単位 ref で固定）
- 低 lamport のレスが後から中間挿入されても、件数増で検知できる
- 空スレ・タイトル未取得スレでも落ちない

### 影響範囲

- ui: `hooks/useUndisplayed.ts`（新規。`useUndisplayed(store, threadId): { hasUndisplayed, clear }`）
- ui: `components/pages/ThreadPage.tsx`（更新ボタンの配線。`refresh` 実行時に `clear` も呼ぶ）
- domain / adapter: 変更なし（既存 `IPostStore.subscribe(threadId)` / `getSnapshot(threadId)` を利用）
- docs: CLAUDE.md ユビキタス言語に「未反映 / Undisplayed」を追記

### 見積もり

- S

---

## [story 20b] 板内の未反映で更新ボタンを点灯（ThreadListView）

### 受け入れ条件

- [ ] ThreadListView 表示中に、その板のいずれかのスレへ未反映レス（新レス・新スレの >>1 を含む）がストアに届くと、更新ボタンの色が変わり数字なしドットが付く
- [ ] 更新ボタン押下で neutral に戻り、未反映分が一覧へ反映される
- [ ] 板遷移（boardId 変化）で必ず neutral に戻る
- [ ] 自分のスレ作成では点灯したままにならない（作成 → refresh で消灯する）
- [ ] 一覧本体は購読・自動再描画しない（pull モデル維持）
- [ ] 色のみに依存せず、ドットの有無でも点灯状態を判別できる
- [ ] `IPostStore` に `subscribeBoard` / `getBoardRevision` を追加し、InMemory と IndexedDB の両実装で動く

### エッジケース

- board revision の ++ は `save()` の dedup early-return の後に行い、再配信では発火しない
- Post 先着 / Thread 未着のスレは点灯するが一覧に出ない場合がある（Thread 到着後の refresh で表示される）。許容
- 他板への save では発火しない（boardId でリスナーを分離）
- 初回 sync 中は点灯しない（板入場時に baseline を現在 revision へ固定）
- ThreadView 内で自分が投稿 → 板へ戻ると、板入場で baseline を取り直すため点灯したままにならない
- IndexedDB 不可環境でもメモリのみで動作する（既存ストアと同方針）

### 影響範囲

- domain: `port/IPostStore.ts`（`subscribeBoard` / `getBoardRevision` 追加）
- adapter: `storage/InMemoryPostStore.ts`（revision Map + board listeners Map、save 時の ++ と発火）、`storage/IndexedDBPostStore.ts`（両メソッドを memory へ委譲）
- ui: `hooks/useUndisplayed.ts`（`useBoardUndisplayed(store, boardId): { hasUndisplayed, clear }` を追加）
- ui: `components/pages/ThreadListView.tsx`（更新ボタンの配線。`refresh` 実行時に `clear` も呼ぶ）
- docs: なし（ユビキタス言語追記は 20a で実施済み）

### 見積もり

- M

---

## 申し渡し事項

- 20a を先行実装し、`useUndisplayed.ts` に board 版（`useBoardUndisplayed`）を追記する形で 20b を載せる。
- baseline 固定・StrictMode 二重実行対策は usePostList の `useAlreadyRead` と同じ作法を踏襲する。
- 更新ボタンの点灯解除は既存 `refresh` と同時に行う（ボタン onClick で `refresh()` と `clear()` を両方呼ぶか、refresh 内に clear を畳み込む）。
- a11y: ドットは色付き円のみでなく、`aria-label` 等で「未反映あり」を伝える。

### 関連チケット

| ID | 内容 |
|---|---|
| Story 18 | スレ一覧の未読数表示（既読履歴）。20b の板バッジと併存する |
| Story 19 | 部分欠損検知後の補完プロトコル（postIds 交換）※本ストーリーとは別概念 |
| Story 15 | pull モデル（Network → Store → UI）の確立。本ストーリーの前提 |
