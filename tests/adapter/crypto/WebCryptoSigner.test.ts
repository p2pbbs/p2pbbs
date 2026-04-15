import { beforeEach, describe, expect, it } from "vitest";
import { WebCryptoSigner } from "@/adapter/crypto/WebCryptoSigner";
import { makePost } from "../../helpers/fixtures";

describe("WebCryptoSigner", () => {
	let signer: WebCryptoSigner;

	beforeEach(() => {
		signer = new WebCryptoSigner();
	});

	it("test_generateKeyPair_ReturnsBase64PublicKey", async () => {
		const { publicKey } = await signer.generateKeyPair();
		expect(publicKey).toBeTruthy();
		// base64 デコードして 32 バイト（Ed25519 公開鍵長）
		const raw = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
		expect(raw.byteLength).toBe(32);
	});

	it("test_sign_WithoutKeyPair_Throws", async () => {
		await expect(
			signer.sign(makePost({ id: "", signature: "" })),
		).rejects.toThrow();
	});

	it("test_sign_WithKeyPair_ReturnsPostWithIdAndSignature", async () => {
		const { publicKey } = await signer.generateKeyPair();
		const draft = makePost({ id: "", signature: "", publicKey });
		const post = await signer.sign(draft);
		expect(post.id).toMatch(/^[0-9a-f]{64}$/);
		expect(post.signature).toBeTruthy();
	});

	it("test_sign_SameDraft_ReturnsSameId", async () => {
		const { publicKey } = await signer.generateKeyPair();
		const draft = makePost({ id: "", signature: "", publicKey });
		const p1 = await signer.sign(draft);
		const p2 = await signer.sign(draft);
		expect(p1.id).toBe(p2.id);
	});
});
