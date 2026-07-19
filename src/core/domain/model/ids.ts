/**
 * ピアID: ノード（ブラウザタブ）の一時名。タブ起動ごとに crypto.randomUUID() で生成。
 * 用途: シグナリングのランデブー（join / envelope の from・to）、
 * GossipMessage.path の経路記録（ループ防止）、glare 解決のタイブレーク。
 * トランスポート（IP）には載らない。同一ブラウザの2タブは別 PeerId。
 */
export type PeerId = string;

/**
 * ODID（鍵ダイジェスト）: 署名鍵の保持者の名前。公開鍵 SHA-256 の先頭8桁hex。
 * 投稿（Post.odId）にのみ載り、公開鍵+署名とセットで騙りを検証できる。
 * 寿命は鍵の寿命に従う（現実装は IndexedDB 永続化のため事実上のコテハン。
 * 鍵を使い捨てれば書き込み単位の匿名になる）。同一ブラウザの全タブで同一。
 */
export type OdId = string;
