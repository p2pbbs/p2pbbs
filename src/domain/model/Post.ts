/** レス: 1つの書き込み。 */
export type Post = {
	/** コンテンツハッシュ。改竄検知用であり事実上の投稿ID。 */
	readonly id: string;
	/** 所属する板の ID。 */
	readonly boardId: string;
	/** 所属するスレの ID。 */
	readonly threadId: string;
	/** 投稿者名。デフォルト "名無しさん"。 */
	readonly name: string;
	/** 本文。 */
	readonly body: string;
	/** セッション公開鍵ハッシュ先頭8文字。同一セッション = 同一ID。 */
	readonly odId: string;
	/** Unix ms。表示用。順序保証には lamport を使う。 */
	readonly timestamp: number;
	/**
	 * Lamport clock の値。スレ単位の論理時計。
	 * - 投稿時: LamportClock.tick() で取得（max(自カウンタ, 受信済み最大値) + 1）
	 * - 受信時: LamportClock.merge(received.lamport) でカウンタ更新（+1 しない）
	 * - 表示順ソート: lamport 昇順 → 同値なら post.id（hash）昇順で安定ソート
	 */
	readonly lamport: number;
	/** Ed25519 署名。 */
	readonly signature: string;
	/** 署名に使った公開鍵。 */
	readonly publicKey: string;
};
