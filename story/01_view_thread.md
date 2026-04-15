## [Story 1] 掲示板を開くとスレが表示される

### ユーザーストーリー

掲示板にアクセスしたユーザーとして、スレッドとそのレスが表示される。

### 受け入れ条件

- [ ] ブラウザでアクセスするとスレッドが表示される
- [ ] スレタイトルが表示される
- [ ] レスが number 昇順で表示される。number が重複した場合は post.id で安定ソート
- [ ] 各レスに number, name, body, timestamp, odId が表示される
- [ ] name が空のレスは定数 DEFAULT_NAME（「名無しさん」）で表示される
- [ ] Post.body 内の HTML はエスケープされる。`dangerouslySetInnerHTML` 使用禁止
- [ ] InMemoryPostStore が IPostStore を実装し、初期投稿（スレ立て1レス目）を持つ
- [ ] UI 層の hook（usePosts）が IPostStore を直接購読する（読み取りは UseCase を経由しない）
- [ ] ソート・フィルタは UI 層の責務とする
- [ ] Smart/Dumb 分離が守られている（IPostStore を知るのは Smart Component のみ）
- [ ] マジックナンバー・ハードコード文字列は config/constants.ts に切り出し
- [ ] レスポンシブ対応（Tailwind のブレークポイント使用、px ベタ書きしない）

### エッジケース

- body が空文字のレス
- body に `<script>` タグを含むレス
- body が MAX_POST_BYTES（2048 byte）を超えるレス（表示は許容。投稿時バリデーションは Story 2）
- name が空のレス（DEFAULT_NAME にフォールバック）
- number が重複した場合の安定ソート（Phase 1 では発生しないが設計を入れておく）

### セキュリティ考慮

- JSX のデフォルトエスケープに依存。`dangerouslySetInnerHTML` 使用禁止
- CSRF は Phase 1 では該当なし（サーバーリクエストなし）

### 設計判断

- ルーターは Phase 1 では不要。App.tsx で直接 BoardPage を表示
- 読み取り/書き込みで経路が分かれる（CQRS 的）
  - 読み取り: UI → IPostStore（subscribe/getSnapshot）。UseCase を経由しない
  - 書き込み: UI → UseCase → IPostStore（Story 2 以降）
- ソート順の決定は UI の責務（core は表示方法に関知しない）

### 影響範囲

- adapter/storage/InMemoryPostStore.ts
- hooks/usePosts.ts
- components/（Smart 1 + Dumb 2-3）
- config/constants.ts（DEFAULT_NAME, MAX_POST_BYTES 追加）
- App.tsx

### 見積もり

- M
