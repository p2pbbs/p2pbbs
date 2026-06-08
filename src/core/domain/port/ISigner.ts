import type { Post } from "../model/Post";
import type { Thread } from "../model/Thread";

/**
 * 秘密鍵を保持するステートフルな署名器の抽象。
 * 実装は Adapter 層（WebCryptoSigner 等）に置く。
 */
export interface ISigner {
	/** Ed25519 鍵ペアを生成し、公開鍵（base64）を返す。 */
	generateKeyPair(): Promise<{ publicKey: string }>;
	/** 下書きに署名し、id と signature が付与された Post を返す。 */
	sign(draft: Omit<Post, "id" | "signature">): Promise<Post>;
	/** Thread に署名し、signature が付与された Thread を返す。 */
	signThread(draft: Omit<Thread, "signature">): Promise<Thread>;
}
