# [story 18] スレ一覧画面での未読数表示

## スレ一覧にスレごとの未読数を表示する（既読履歴を永続化）

### 受け入れ条件

- [ ] スレ一覧(ThreadListView)の各行にそのスレの未読レス数を表示する(0 は非表示)
- [ ] 未読 = 既読履歴(ReadHistory)に無い post.id。自分(selfPublicKey 一致)の投稿は数えない
- [ ] ReadHistory を IndexedDB に永続化し、起動時にメモリへ復元する(リロードしても既読が残る)
- [ ] usePostList のモジュールスコープ sessionReadHistory を廃止し、Session 経由の単一インスタンスに統一する
- [ ] スレを開いて表示したレスが既読になり、一覧に戻ると当該スレの未読数が減る
- [ ] 既存ストア同様 port + IndexedDB adapter + InMemory(テスト用) で実装する
- [ ] ListedPost.isNew を isUnread にリネームし、コメント「新着」→「未読」に統一する
- [ ] ユビキタス言語に「未読/Unread」を追記。ノード視点の保有差分を "new/新着" と呼ばない但し書きを添える

### エッジケース

- 初回起動(履歴なし)・未訪問スレは全レス未読(自分の投稿を除く)
- 自分の投稿だけのスレは未読 0
- IndexedDB 不可環境はメモリのみにフォールバック(鍵保存と同方針)、破損レコードは warn + スキップ
- digest だけ既知のスレは getByBoard に出ないため対象外
- スレ一覧の「更新」では本文非表示のため既読は進めない(既読化はスレ閲覧時のみ)

### 影響範囲

- domain: port/IReadHistoryStore(新規)
- adapter: storage/IndexedDBReadHistoryStore, InMemoryReadHistoryStore(新規)
- UI: session.ts(readHistory 追加), App.tsx(load), usePostList(共有参照へ + isNew→isUnread), useThreadList(unreadCount 追加), ThreadListView(バッジ)

### 見積もり

- M
