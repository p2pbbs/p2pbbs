/** レス: 1つの書き込み。 */
export type Post = {
	/** コンテンツハッシュ。改竄検知用であり事実上の投稿ID。 */
	readonly id: string;
	/** スレ内連番。1始まり、表示用。 */
	readonly number: number;
	/** 投稿者名。デフォルト "名無しさん"。 */
	readonly name: string;
	/** 本文。 */
	readonly body: string;
	/** セッション公開鍵ハッシュ先頭8文字。同一セッション = 同一ID。 */
	readonly odId: string;
	/** Unix ms。 */
	readonly timestamp: number;
	/** Ed25519 署名。 */
	readonly signature: string;
	/** 署名に使った公開鍵。 */
	readonly publicKey: string;
};
