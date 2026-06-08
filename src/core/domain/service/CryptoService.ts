import type { Post } from "../model/Post";
import type { Thread } from "../model/Thread";
import type { ISigner } from "../port/ISigner";

/**
 * 署名ペイロードを length-prefix 方式でエンコードする。
 * `|` 区切りではフィールド値に `|` が含まれると境界が曖昧になるため、
 * 各フィールドを `<byteLength>:<value>` 形式に変換して結合する。
 * WebCryptoSigner の sign / signThread と一致させること。
 */
export function buildSignaturePayload(
	fields: (string | number)[],
): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder();
	const parts = fields.map((f) => {
		const s = String(f);
		return `${encoder.encode(s).byteLength}:${s}`;
	});
	// TextEncoder.encode() は実行時に常に ArrayBuffer バックの Uint8Array を返すが、
	// TypeScript の lib 型は Uint8Array<ArrayBufferLike> と過剰に広く宣言している。
	// as は ArrayBuffer への narrowing であり、型検査の無効化ではない。
	return encoder.encode(parts.join("")) as Uint8Array<ArrayBuffer>;
}

/**
 * 暗号操作の統合ファサード。
 * UseCase はこのクラスのみに依存する。
 * ステートレスな操作（ハッシュ計算・検証）は自前で実装し、
 * ステートフルな操作（鍵生成・署名）は ISigner に委譲する。
 */
export class CryptoService {
	private readonly signer: ISigner;

	constructor(signer: ISigner) {
		this.signer = signer;
	}

	// --- ステートレス（Post の中身だけで完結）---

	/** コンテンツハッシュ（Post.id）を計算する。署名を含まない */
	async computePostHash(post: Omit<Post, "id" | "signature">): Promise<string> {
		const content = [
			post.name,
			post.body,
			post.timestamp,
			post.publicKey,
			post.boardId,
			post.threadId,
			post.lamport,
		].join("|");
		const buf = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(content),
		);
		return Array.from(new Uint8Array(buf))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}

	/** Post.id が本文から再計算したハッシュと一致するか検証する */
	async verifyPostHash(post: Post): Promise<boolean> {
		return (await this.computePostHash(post)) === post.id;
	}

	/** Post の Ed25519 署名を検証する */
	async verifySignature(post: Post): Promise<boolean> {
		const rawKey = Uint8Array.from(atob(post.publicKey), (c) =>
			c.charCodeAt(0),
		);
		const key = await crypto.subtle.importKey(
			"raw",
			rawKey,
			{ name: "Ed25519" },
			false,
			["verify"],
		);
		const sig = Uint8Array.from(atob(post.signature), (c) => c.charCodeAt(0));
		const payload = buildSignaturePayload([
			post.name,
			post.body,
			post.timestamp,
			post.boardId,
			post.threadId,
			post.lamport,
		]);
		return crypto.subtle.verify("Ed25519", key, sig, payload);
	}

	/** Thread の Ed25519 署名を検証する */
	async verifyThreadSignature(thread: Thread): Promise<boolean> {
		const rawKey = Uint8Array.from(atob(thread.publicKey), (c) =>
			c.charCodeAt(0),
		);
		const key = await crypto.subtle.importKey(
			"raw",
			rawKey,
			{ name: "Ed25519" },
			false,
			["verify"],
		);
		const sig = Uint8Array.from(atob(thread.signature), (c) => c.charCodeAt(0));
		const payload = buildSignaturePayload([
			thread.threadId,
			thread.boardId,
			thread.title,
			thread.createdAt,
			thread.publicKey,
		]);
		return crypto.subtle.verify("Ed25519", key, sig, payload);
	}

	/** publicKey（base64）から OD ID（SHA-256 先頭8文字）を導出する。ステートレス。 */
	async deriveOdId(publicKey: string): Promise<string> {
		const raw = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
		const buf = await crypto.subtle.digest("SHA-256", raw);
		return Array.from(new Uint8Array(buf))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("")
			.slice(0, 8);
	}

	// --- ステートフル（ISigner に委譲）---

	generateKeyPair(): Promise<{ publicKey: string }> {
		return this.signer.generateKeyPair();
	}

	sign(draft: Omit<Post, "id" | "signature">): Promise<Post> {
		return this.signer.sign(draft);
	}

	signThread(draft: Omit<Thread, "signature">): Promise<Thread> {
		return this.signer.signThread(draft);
	}
}
