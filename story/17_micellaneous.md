# [story 17] 雑多な改善

## ジェネシススレを廃止し空状態を表示する

### 受け入れ条件

- [x] App.tsx initStores の genesis ループを削除する
- [x] GENESIS_THREADS 定数と関連 genesis センチネル/スキップ記述を削除する
- [x] スレ 0 件の板で「まだスレがありません...」を表示する(既存の空状態を流用)
- [x] genesis の特別扱いが ThreadIngester 等の検証経路から消えている

### エッジケース

- 既存 IndexedDB に残る旧ジェネシススレの扱い(D2: リリース前のため許容)
- 空板でも FAB からスレ作成可・canPost 判定・初回自動リロードが正常

### 影響範囲

- config: constants.ts(GENESIS_THREADS) / UI: App.tsx(initStores) / domain: ThreadIngester 他の genesis 参照(あれば)

### 見積もり

- S

## 板を「プログラム技術」「雑談」の2板に変更する

### 受け入れ条件

- [x] BOARDS を差し替え: { boardId: "tech", name: "プログラム技術" } / { boardId: "chat", name: "雑談" }
- [x] 板一覧・スレ一覧見出しに新板名が表示される
- [x] peer discovery(signaling join) が新 boardId で行われる

### エッジケース

- 旧 boardId(mona/yaruo)の投稿/スレは新板一覧に出ない(IndexedDB に残るが参照されない・リリース前のため許容)
- 旧 boardId の URL は NotFound
- 異なる boardId のピア同士は接続しない(全員が新 ID 使用前提)
- #2 完了後に着手 ※旧 GENESIS_THREADS が board キー依存のため

### 影響範囲

- config: constants.ts(BOARDS)

### 見積もり

- S

## トップページに免責を小さく表示する

### 受け入れ条件

- [x] 板一覧(BoardListView)下部に免責を小さめ(text-xs〜sm・抑えめの色)で表示する
- [x] 文言は最低限:「違法な投稿は禁止です。投稿の責任は各投稿者にあります。本サイトは P2P 型で、ブラウザを開くと他の利用者の投稿の中継が始まります。」

### エッジケース

- ダークモードでも可読なコントラスト
- モバイル幅での折返し

### 影響範囲

- UI: BoardListView

### 見積もり

- S
