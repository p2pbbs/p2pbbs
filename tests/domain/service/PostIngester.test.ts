import { describe, expect, it, vi } from "vitest";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { LamportClock } from "@/core/domain/service/LamportClock";
import { PostIngester } from "@/core/domain/service/PostIngester";
import { makePost } from "../../helpers/fixtures";

function makePostStore(): IPostStore {
	return {
		save: vi.fn().mockResolvedValue(undefined),
		getSnapshot: vi.fn().mockReturnValue([]),
		subscribe: vi.fn().mockReturnValue(() => {}),
	};
}

function makeLogger(): ILogger {
	return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeIngester(clockOverride?: LamportClock) {
	const postStore = makePostStore();
	const signer = { generateKeyPair: vi.fn(), sign: vi.fn() };
	const crypto = new CryptoService(signer);
	const sigSpy = vi.spyOn(crypto, "verifySignature").mockResolvedValue(true);
	const hashSpy = vi.spyOn(crypto, "verifyPostHash").mockResolvedValue(true);
	const clock = clockOverride ?? new LamportClock();
	const logger = makeLogger();
	const ingester = new PostIngester(postStore, crypto, clock, logger);
	return { ingester, postStore, crypto, clock, logger, sigSpy, hashSpy };
}

describe("PostIngester", () => {
	// --- 正常系 ---

	it("test_ingest_ValidPost_ReturnsTrueAndSaves", async () => {
		const { ingester, postStore } = makeIngester();
		const post = makePost();
		const result = await ingester.ingest(post);
		expect(result).toBe(true);
		expect(postStore.save).toHaveBeenCalledWith(post);
	});

	it("test_ingest_ValidPost_MergesLamportClock", async () => {
		const clock = new LamportClock();
		const { ingester } = makeIngester(clock);
		await ingester.ingest(makePost({ lamport: 7 }));
		expect(clock.current()).toBe(7);
	});

	// --- 署名検証失敗 ---

	it("test_ingest_InvalidSignature_ReturnsFalse", async () => {
		const { ingester, sigSpy } = makeIngester();
		sigSpy.mockResolvedValue(false);
		const result = await ingester.ingest(makePost());
		expect(result).toBe(false);
	});

	it("test_ingest_InvalidSignature_DoesNotSave", async () => {
		const { ingester, postStore, sigSpy } = makeIngester();
		sigSpy.mockResolvedValue(false);
		await ingester.ingest(makePost());
		expect(postStore.save).not.toHaveBeenCalled();
	});

	it("test_ingest_InvalidSignature_LogsWarning", async () => {
		const { ingester, logger, sigSpy } = makeIngester();
		sigSpy.mockResolvedValue(false);
		await ingester.ingest(makePost({ id: "post-xyz" }));
		expect(logger.warn).toHaveBeenCalledWith(
			"post_ingester.invalid_signature",
			expect.objectContaining({ postId: "post-xyz" }),
		);
	});

	// --- ハッシュ検証失敗 ---

	it("test_ingest_InvalidHash_ReturnsFalse", async () => {
		const { ingester, hashSpy } = makeIngester();
		hashSpy.mockResolvedValue(false);
		const result = await ingester.ingest(makePost());
		expect(result).toBe(false);
	});

	it("test_ingest_InvalidHash_DoesNotSave", async () => {
		const { ingester, postStore, hashSpy } = makeIngester();
		hashSpy.mockResolvedValue(false);
		await ingester.ingest(makePost());
		expect(postStore.save).not.toHaveBeenCalled();
	});

	it("test_ingest_InvalidHash_LogsWarning", async () => {
		const { ingester, logger, hashSpy } = makeIngester();
		hashSpy.mockResolvedValue(false);
		await ingester.ingest(makePost({ id: "post-abc" }));
		expect(logger.warn).toHaveBeenCalledWith(
			"post_ingester.invalid_hash",
			expect.objectContaining({ postId: "post-abc" }),
		);
	});

	// --- seen 重複排除 ---

	it("test_ingest_DuplicatePostId_SavesOnlyOnce", async () => {
		const { ingester, postStore } = makeIngester();
		const post = makePost();
		await ingester.ingest(post);
		await ingester.ingest(post);
		expect(postStore.save).toHaveBeenCalledOnce();
	});

	it("test_ingest_DuplicatePostId_SecondCallReturnsFalse", async () => {
		const { ingester } = makeIngester();
		const post = makePost();
		await ingester.ingest(post);
		const result = await ingester.ingest(post);
		expect(result).toBe(false);
	});

	it("test_ingest_InvalidSignatureThenValidSameId_ValidIsProcessed", async () => {
		// 先に不正署名が来ても seen を汚染しないため、後から届く正規メッセージは保存される
		const { ingester, postStore, sigSpy } = makeIngester();
		const post = makePost();
		sigSpy.mockResolvedValueOnce(false); // 1回目: 不正 → seen に追加しない
		await ingester.ingest(post);
		await ingester.ingest(post); // 2回目: 正規 → 保存される
		expect(postStore.save).toHaveBeenCalledOnce();
	});

	// --- 処理順序: clock.merge は保存後 ---

	it("test_ingest_LamportMerge_HappensAfterSave", async () => {
		const clock = new LamportClock();
		const { ingester, postStore } = makeIngester(clock);
		let clockAtSave = -1;
		vi.mocked(postStore.save).mockImplementation(() => {
			clockAtSave = clock.current();
			return Promise.resolve();
		});
		await ingester.ingest(makePost({ lamport: 5 }));
		// save 実行時点ではまだ clock は更新されていない
		expect(clockAtSave).toBe(0);
		// save 後に merge されて 5 になっている
		expect(clock.current()).toBe(5);
	});
});
