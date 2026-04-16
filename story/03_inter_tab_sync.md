
## [Story 3] 別のタブで投稿したレスが表示される

### ユーザーストーリー

掲示板を2つのタブで開いたユーザーとして、片方で投稿したレスがもう片方に表示される。

### 受け入れ条件

- [ ] タブAで投稿したレスがタブBに表示される
- [ ] タブA, B, C の3タブで、Aの投稿がB, C両方に表示される
- [ ] 両タブで投稿の表示順が同じ（lamport 昇順 → post.id 昇順）
- [ ] 並行投稿（タブA, Bがほぼ同時に投稿）した場合、両タブで同じ順序に収束する
- [ ] 同じ投稿が重複表示されない（seen Set による重複排除）
- [ ] 署名が不正なメッセージは無視される（ログのみ）
- [ ] ハッシュが不正なメッセージは無視される（ログのみ）
- [ ] 不正な JSON の受信でクラッシュしない
- [ ] ReceiveMessageUseCase の処理順序: 署名検証 → ハッシュ検証 → 重複排除 → 保存 → clock.merge → 再ファンアウト
- [ ] ILogger + ConsoleLogger が実装されている

### 設計判断

#### IGossipMessageGateway（domain/port）

メッセージの送受信窓口。ゴシップのロジック（TTL、path、ファンアウト）は持たない。

```
interface IGossipMessageGateway {
  send(message: GossipMessage): void;
  onReceive(handler: (message: GossipMessage) => void): () => void;
}
```

Phase 1: BroadcastChannelGateway が実装。Phase 2: WebRTCGateway に差し替え。

#### GossipController（controller/）

UseCase と Gateway の配線役。App.tsx が起動・停止する。

- Gateway の onReceive を購読して ReceiveMessageUseCase.execute() を呼ぶ
- Adapter は UseCase を知らない。UseCase は Adapter の具象を知らない
- UI の責務ではない。core 側のモジュール

#### BroadcastChannel の特性

- 全タブにブロードキャスト。送信先の選択はできない
- ファンアウト制御は Phase 1 では実質不要だが、path + ttl ロジックは実装する（Phase 2 準備）
- 自分の投稿が戻ってきても path に自ノード ID が含まれるので重複排除で弾かれる

#### 読み書き経路（CQRS 的）

- 読み取り: UI → IPostStore（subscribe/getSnapshot）直接購読
- 書き込み（ローカル）: UI → PostMessageUseCase → IPostStore + IGossipMessageGateway
- 書き込み（受信）: GossipController → ReceiveMessageUseCase → IPostStore + IGossipMessageGateway（再ファンアウト）

### エッジケース

- BroadcastChannel 非対応ブラウザ → fatal エラー表示（主要ブラウザは全対応だが）
- PostMessageUseCase の send 失敗 → ローカルには保存済み。ログに記録
- 受信メッセージの ttl が 0 → 保存はするが再ファンアウトしない

### 影響範囲

- domain/port/IGossipMessageGateway.ts（新規）
- domain/port/ILogger.ts → adapter/logging/ConsoleLogger.ts（新規）
- adapter/gossip/BroadcastChannelGateway.ts（新規）
- usecase/ReceiveMessageUseCase.ts（新規）
- usecase/PostMessageUseCase.ts（IGossipMessageGateway 経由の送信を追加）
- controller/GossipController.ts（新規）
- App.tsx（GossipController の起動）

### 見積もり

- M

---

## [Story 3a] 過去の投稿がタブ再起動後も残る

### ユーザーストーリー

タブを閉じて再度開いたユーザーとして、以前の投稿が表示される。

### 受け入れ条件

- [ ] 投稿が IndexedDB に永続化される
- [ ] タブ起動時に IndexedDB からメモリに読み込まれる
- [ ] LamportClock の初期値がストアの最大 lamport から復元される
- [ ] getSnapshot は常にメモリから返す（同期、useSyncExternalStore 互換）

### 設計判断

- InMemoryPostStore の裏に IndexedDB の永続化層を足すハイブリッド構成
- 起動時: IndexedDB → メモリ読み込み
- save 時: メモリ + IndexedDB 両方に書く
- MVP は1スレ固定なのでメモリに持つのは開いてるスレのみ

### エッジケース

- IndexedDB の容量不足 → fatal エラー
- IndexedDB に保存済みの投稿が破損していた場合 → 無視してメモリには載せない
- 大量の投稿（数千件）での起動時間 → Phase 1 では許容

### 影響範囲

- adapter/storage/IndexedDBPostStore.ts（新規、InMemoryPostStore をラップ）
- App.tsx（起動時の IndexedDB 読み込み）

### 見積もり

- S

---

## [Story 3b] 同一ブラウザで OD ID が同一

### ユーザーストーリー

同じブラウザの複数タブを使うユーザーとして、全タブで同じ OD ID が表示される。

### 受け入れ条件

- [ ] セッション鍵（CryptoKey）が IndexedDB に保存される
- [ ] 新規タブ起動時に IndexedDB から既存の鍵を読み込む
- [ ] 鍵が存在しない場合のみ新規生成する
- [ ] extractable: false のまま structured clone で保存
- [ ] 全タブで OD ID が同一

### エッジケース

- 2タブが同時に起動して両方とも「鍵がない」と判定した場合 → 片方が生成、もう片方が読み込む。レースコンディション対策が必要
- IndexedDB から鍵の読み込みに失敗した場合 → 新規生成にフォールバック（OD ID は変わるが動作は継続）

### 影響範囲

- adapter/crypto/WebCryptoSigner.ts（IndexedDB からの鍵読み込み/保存を追加）
- App.tsx（初期化フローの変更）

### 見積もり

- S
