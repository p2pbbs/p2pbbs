# Story 2: レスを投稿でき、投稿者IDが表示される

## 受け入れ条件

- [ ] 投稿フォームに名前（任意）と本文（必須）を入力して送信できる
- [ ] 送信したレスがスレに表示される（ローカルのみ）
- [ ] 各レスに OD ID（セッション公開鍵ハッシュ先頭8文字）が表示される
- [ ] 名前欄が空欄の場合、「名無しさん」として投稿される
- [ ] 本文が空欄または MAX_POST_BYTES（4096 bytes）超の場合、送信できない
- [ ] レスは lamport 昇順 → 同値なら post.id 昇順で表示される
- [ ] セッション内で OD ID は一定（鍵ペアはセッション開始時に1回のみ生成）

## 設計メモ

### Post モデルの変更

`lamport`, `boardId`, `threadId` を Post に追加。GossipMessage から `boardId`/`threadId` を削除（Post が持つ）。`IPostStore.save(post)` のシグネチャを post のみに簡素化。`lamport` と `boardId`/`threadId` は署名ペイロードおよびコンテンツハッシュに含める。

### LamportClock

スレ単位のカウンタを管理する domain service。PostMessageUseCase と ReceiveMessageUseCase（Story 3）が共有する。

- `tick()`: 投稿時。カウンタをインクリメントして返す
- `merge(received)`: 受信時。`max(self, received)` でカウンタ更新
- `current()`: 現在値参照

## エッジケース

- `generateKeyPair()` 失敗（非対応ブラウザ）→ fatal: UI に操作不能を表示
- バイト数チェックは `new TextEncoder().encode(body).length` で判定
- GENESIS_POST は `lamport: 0` とし、最初のユーザー投稿は `lamport: 1`

## 影響範囲

Domain（Post / GossipMessage / IPostStore / LamportClock / CryptoService）, Adapter（WebCryptoSigner）, UseCase（PostMessageUseCase）, UI（PostForm / BoardPage）

## 見積もり

M
