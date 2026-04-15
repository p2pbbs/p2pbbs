# skill-creator への入力

Claude Code 上で skill-creator にこのファイルを渡してスキルを作成する。
事前に CLAUDE.md と src/domain/model/*.ts も読み込ませること。

---

## スキル 1: nch-p2p-core

### 何をさせたいか

P2P 層（domain / usecase / adapter）の実装ガイド。
以下の領域をカバーする:

- ゴシッププロトコル: メッセージ受信→署名検証→ハッシュ検証→重複判定→保存→ファンアウト先選択→転送のパイプライン
- WebRTC DataChannel: ピア接続管理、DataChannel の状態遷移、接続/切断ハンドリング
- 暗号: Ed25519 署名の生成・検証、SHA-256 コンテンツハッシュ、Web Crypto API の使い方
- シグナリング: WebSocket 経由のピア発見、SDP/ICE candidate の交換
- メッセージ重複排除: ハッシュの Set 管理、O(1) ルックアップ
- ファンアウト制御: 接続中ピアからランダム k 個選択、path によるループ防止、TTL デクリメント

リファレンス実装として receiveMessage のパイプラインを few-shot で含める。
対応するユニットテストもセットで載せる。

### アーキテクチャの具体（skill-creator が知るべきコンテキスト）

依存方向は UI → UseCase → Domain ← Adapter。

**UseCase 層の責務（厚い）:**
- postMessage: 投稿を署名→ローカル保存→GossipMessage 生成→ファンアウト
- receiveMessage: GossipMessage 受信→署名検証→ハッシュ検証→重複判定（Set）→保存→TTL デクリメント→path に自分追加→再ファンアウト
- joinNetwork: シグナリングサーバーに接続→ピアリスト取得→WebRTC 接続確立
- syncHistory: 新規ノードが既存ノードに過去ログを要求→受信→保存

**Adapter 層の責務（厚い）:**
- PeerAdapter: RTCPeerConnection / RTCDataChannel のライフサイクル管理。接続、切断検知、再接続
- GossipAdapter: ファンアウト先選択ロジック、メッセージのシリアライズ/デシリアライズ、DataChannel 経由の送受信
- WebSocketSignalingAdapter: シグナリングサーバーとの WebSocket 接続、SDP offer/answer、ICE candidate 交換
- IndexedDBPostRepository: 投稿の永続化、スレ単位での取得
- WebCryptoAdapter: Ed25519 鍵ペア生成、署名、検証、SHA-256 ハッシュ

**Domain 層の責務:**
- 型定義: Board, Thread, Post, Peer, GossipMessage（src/domain/model/*.ts 参照）
- Repository インターフェース: IPostRepository, IPeerRepository, ISignalingRepository
- 純粋ロジック: hashService（コンテンツハッシュ生成・検証）、signatureService（署名生成・検証）

### いつトリガーするか

- domain/, usecase/, adapter/ 配下のファイルを新規作成・編集するとき
- WebRTC、ゴシップ、署名、ハッシュ、ピア管理に言及したとき
- P2P の設計判断を相談されたとき

### 期待する出力形式

TypeScript コード。CLAUDE.md のルール（DIP、命名規則、テスト命名、readonly 型）に準拠。

### テストケース

作る。以下で 2-3 個:
- receiveMessage に正常な GossipMessage を渡して保存+ファンアウトされるか
- 不正署名の GossipMessage を渡して拒否されるか
- 重複ハッシュの GossipMessage を渡してスキップされるか

---

## スキル 2: nch-testing

### 何をさせたいか

P2P 特有のテスト戦略ガイド。
以下の領域をカバーする:

- 複数ノードのシミュレーション: 1プロセス内で複数ピアインスタンスを生成し、ゴシップ伝播をテストするパターン
- WebRTC DataChannel のモック: RTCPeerConnection / RTCDataChannel のスタブ実装
- シグナリングサーバーのモック: WebSocket 接続のスタブ、SDP/ICE のダミーデータ
- 非同期イベントのテスト: ゴシップ受信→処理→再転送の非同期パイプラインの待ち合わせパターン
- エッジケース一覧: 不正署名、重複メッセージ、TTL=0、path に自分含む、ピア未接続、ピア途中離脱、同時投稿

### いつトリガーするか

- テストファイル（*.test.ts）の新規作成・編集時
- テスト設計の相談時
- 「どうテストする？」「エッジケースは？」という問いかけ

### 期待する出力形式

Vitest のテストコード。モック構成例を含む。CLAUDE.md のテスト命名規則（test_Action_Condition_Result）に準拠。

### テストケース

作る。以下で 2-3 個:
- WebRTC DataChannel モックを使った receiveMessage のテスト
- 3ノード構成でのゴシップ伝播テスト（A→B→C に届くか）
- ピア途中離脱時にファンアウトが残りのピアで継続するか