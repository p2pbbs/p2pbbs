import type { Post } from "@/core/domain/model/Post";
import type { ISigner } from "@/core/domain/port/ISigner";

function bytesToBase64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

/**
 * Ed25519 鍵ペアを保持するアダプタ。
 * 秘密鍵は extractable: false でメモリ内にのみ存在する。
 * セッション開始時に generateKeyPair() を1回だけ呼ぶこと。
 */
export class WebCryptoSigner implements ISigner {
	private keyPair: CryptoKeyPair | null = null;

	async generateKeyPair(): Promise<{ publicKey: string }> {
		this.keyPair = await crypto.subtle.generateKey("Ed25519", false, [
			"sign",
			"verify",
		]);
		const raw = await crypto.subtle.exportKey("raw", this.keyPair.publicKey);
		return { publicKey: bytesToBase64(new Uint8Array(raw)) };
	}

	async sign(draft: Omit<Post, "id" | "signature">): Promise<Post> {
		if (!this.keyPair) {
			throw new Error("generateKeyPair() を先に呼んでください");
		}

		// 署名ペイロード: CryptoService.verifySignature と一致させること
		const payload = new TextEncoder().encode(
			[
				draft.name,
				draft.body,
				draft.timestamp,
				draft.boardId,
				draft.threadId,
				draft.lamport,
			].join("|"),
		);
		const sigBuf = await crypto.subtle.sign(
			"Ed25519",
			this.keyPair.privateKey,
			payload,
		);
		const signature = bytesToBase64(new Uint8Array(sigBuf));

		// コンテンツハッシュ: CryptoService.computePostHash と一致させること
		const content = [
			draft.name,
			draft.body,
			draft.timestamp,
			draft.publicKey,
			draft.boardId,
			draft.threadId,
			draft.lamport,
		].join("|");
		const hashBuf = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(content),
		);
		const id = Array.from(new Uint8Array(hashBuf))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

		return { ...draft, id, signature };
	}
}
