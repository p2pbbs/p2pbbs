import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebCryptoSigner } from "@/core/adapter/crypto/WebCryptoSigner";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { makePost } from "../../helpers/fixtures";

describe("CryptoService", () => {
	describe("computePostHash", () => {
		let service: CryptoService;

		beforeEach(() => {
			service = new CryptoService({
				generateKeyPair: vi.fn(),
				sign: vi.fn(),
			});
		});

		it("test_computePostHash_SameInput_ReturnsSameHash", async () => {
			const draft = makePost();
			const h1 = await service.computePostHash(draft);
			const h2 = await service.computePostHash(draft);
			expect(h1).toBe(h2);
		});

		it("test_computePostHash_DifferentBody_ReturnsDifferentHash", async () => {
			const h1 = await service.computePostHash(makePost({ body: "aaa" }));
			const h2 = await service.computePostHash(makePost({ body: "bbb" }));
			expect(h1).not.toBe(h2);
		});

		it("test_computePostHash_DifferentLamport_ReturnsDifferentHash", async () => {
			const h1 = await service.computePostHash(makePost({ lamport: 1 }));
			const h2 = await service.computePostHash(makePost({ lamport: 2 }));
			expect(h1).not.toBe(h2);
		});

		it("test_computePostHash_DifferentBoardId_ReturnsDifferentHash", async () => {
			const h1 = await service.computePostHash(
				makePost({ boardId: "board-1" }),
			);
			const h2 = await service.computePostHash(
				makePost({ boardId: "board-2" }),
			);
			expect(h1).not.toBe(h2);
		});

		it("test_computePostHash_Returns64CharHex", async () => {
			const hash = await service.computePostHash(makePost());
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});
	});

	describe("verifyPostHash", () => {
		it("test_verifyPostHash_ValidPost_ReturnsTrue", async () => {
			const signer = new WebCryptoSigner();
			await signer.generateKeyPair();
			const service = new CryptoService(signer);
			const signed = await signer.sign(makePost({ id: "", signature: "" }));
			expect(await service.verifyPostHash(signed)).toBe(true);
		});

		it("test_verifyPostHash_TamperedBody_ReturnsFalse", async () => {
			const signer = new WebCryptoSigner();
			await signer.generateKeyPair();
			const service = new CryptoService(signer);
			const signed = await signer.sign(makePost({ id: "", signature: "" }));
			const tampered = { ...signed, body: "改竄" };
			expect(await service.verifyPostHash(tampered)).toBe(false);
		});
	});

	describe("verifySignature", () => {
		it("test_verifySignature_ValidSignature_ReturnsTrue", async () => {
			const signer = new WebCryptoSigner();
			const { publicKey } = await signer.generateKeyPair();
			const service = new CryptoService(signer);
			const signed = await signer.sign(
				makePost({ id: "", signature: "", publicKey }),
			);
			expect(await service.verifySignature(signed)).toBe(true);
		});

		it("test_verifySignature_TamperedBody_ReturnsFalse", async () => {
			const signer = new WebCryptoSigner();
			const { publicKey } = await signer.generateKeyPair();
			const service = new CryptoService(signer);
			const signed = await signer.sign(
				makePost({ id: "", signature: "", publicKey }),
			);
			const tampered = { ...signed, body: "改竄" };
			expect(await service.verifySignature(tampered)).toBe(false);
		});

		it("test_verifySignature_TamperedLamport_ReturnsFalse", async () => {
			const signer = new WebCryptoSigner();
			const { publicKey } = await signer.generateKeyPair();
			const service = new CryptoService(signer);
			const signed = await signer.sign(
				makePost({ id: "", signature: "", publicKey, lamport: 1 }),
			);
			const tampered = { ...signed, lamport: 99 };
			expect(await service.verifySignature(tampered)).toBe(false);
		});
	});

	describe("deriveOdId", () => {
		let service: CryptoService;

		beforeEach(() => {
			service = new CryptoService({ generateKeyPair: vi.fn(), sign: vi.fn() });
		});

		it("test_deriveOdId_Returns8HexChars", async () => {
			const signer = new WebCryptoSigner();
			const { publicKey } = await signer.generateKeyPair();
			const odId = await service.deriveOdId(publicKey);
			expect(odId).toMatch(/^[0-9a-f]{8}$/);
		});

		it("test_deriveOdId_SameKeyReturnsSameId", async () => {
			const signer = new WebCryptoSigner();
			const { publicKey } = await signer.generateKeyPair();
			const id1 = await service.deriveOdId(publicKey);
			const id2 = await service.deriveOdId(publicKey);
			expect(id1).toBe(id2);
		});

		it("test_deriveOdId_DifferentKeys_ReturnDifferentIds", async () => {
			const signerA = new WebCryptoSigner();
			const signerB = new WebCryptoSigner();
			const { publicKey: pkA } = await signerA.generateKeyPair();
			const { publicKey: pkB } = await signerB.generateKeyPair();
			expect(await service.deriveOdId(pkA)).not.toBe(
				await service.deriveOdId(pkB),
			);
		});
	});

	describe("hash consistency", () => {
		it("test_sign_id_MatchesComputePostHash", async () => {
			const signer = new WebCryptoSigner();
			const { publicKey } = await signer.generateKeyPair();
			const service = new CryptoService(signer);
			const draft = makePost({ id: "", signature: "", publicKey });
			const signed = await signer.sign(draft);
			const expected = await service.computePostHash(draft);
			expect(signed.id).toBe(expected);
		});
	});
});
