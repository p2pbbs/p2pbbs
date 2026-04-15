
## [chore] プロジェクト初期化

### 受け入れ条件

- [ ] `npm create vite@latest nch -- --template react-ts` でプロジェクト生成
- [ ] Tailwind CSS 導入・設定
- [ ] Biome 導入（`noExplicitAny: error`、推奨ルールセット有効化）
- [ ] husky + lint-staged 導入（コミット時に Biome チェック + 関連テスト実行）
- [ ] tsconfig: `strict: true`, `noUncheckedIndexedAccess: true`, path alias `@/`
- [ ] `.node-version` に Node 22 を指定
- [ ] domain/model/*.ts を配置（Board, Thread, Post, Peer, GossipMessage）
- [ ] domain/model/index.ts の barrel export
- [ ] domain/port/IPostStore.ts を配置（subscribe, getSnapshot, save）
- [ ] domain/port/ISigner.ts を配置
- [ ] domain/port/ILogger.ts を配置
- [ ] domain/error/NchError.ts を配置（code + recovery + message）
- [ ] config/constants.ts を作成（FANOUT, DEFAULT_NAME, MAX_POST_BYTES 等）
- [ ] CLAUDE.md をリポジトリルートに配置
- [ ] README.md をリポジトリルートに配置
- [ ] `npm run dev` で Vite 開発サーバーが起動する
- [ ] `npm run lint` で Biome チェックが通る
- [ ] `npm run test` で Vitest が実行可能（テストケース0件で pass）

### 影響範囲

- プロジェクトルート全体

### 見積もり

- S
