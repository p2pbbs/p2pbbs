import { describe, expect, it, vi } from "vitest";
import { MAX_THREADS_PER_BOARD } from "@/core/config/constants";
import type { Thread } from "@/core/domain/model/Thread";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IThreadStore } from "@/core/domain/port/IThreadStore";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { ThreadIngester } from "@/core/domain/service/ThreadIngester";
import { makeThread, makeThreadStore } from "../../helpers/fixtures";

const BOARD_ID = "mona";

function makeLogger(): ILogger {
	return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeIngester(threadStore?: IThreadStore) {
	const store = threadStore ?? makeThreadStore();
	const signer = {
		generateKeyPair: vi.fn(),
		sign: vi.fn(),
		signThread: vi.fn(),
	};
	const crypto = new CryptoService(signer);
	const sigSpy = vi
		.spyOn(crypto, "verifyThreadSignature")
		.mockResolvedValue(true);
	const logger = makeLogger();
	const ingester = new ThreadIngester(store, crypto, logger);
	return { ingester, store, crypto, logger, sigSpy };
}

/** threadId === String(createdAt) を満たす Thread を作る。 */
function makeValidThread(createdAt: number, boardId = BOARD_ID): Thread {
	return makeThread({ threadId: String(createdAt), createdAt, boardId });
}

describe("ThreadIngester", () => {
	// --- 正常系 ---

	it("test_ingest_ValidThread_ReturnsTrueAndSaves", async () => {
		const { ingester, store } = makeIngester();
		const thread = makeValidThread(1700000000000);
		const result = await ingester.ingest(thread);
		expect(result).toBe(true);
		expect(store.save).toHaveBeenCalledWith(thread);
	});

	// --- 署名検証失敗 ---

	it("test_ingest_InvalidSignature_ReturnsFalseAndDoesNotSave", async () => {
		const { ingester, store, sigSpy } = makeIngester();
		sigSpy.mockResolvedValue(false);
		const result = await ingester.ingest(makeValidThread(1700000000000));
		expect(result).toBe(false);
		expect(store.save).not.toHaveBeenCalled();
	});

	it("test_ingest_InvalidSignature_LogsWarning", async () => {
		const { ingester, logger, sigSpy } = makeIngester();
		sigSpy.mockResolvedValue(false);
		await ingester.ingest(makeValidThread(1700000000000));
		expect(logger.warn).toHaveBeenCalledWith(
			"thread_ingester.invalid_signature",
			expect.anything(),
		);
	});

	it("test_ingest_SignatureVerifyThrows_TreatedAsInvalid", async () => {
		// genesis センチネル等で importKey が例外を投げても false に倒す
		const { ingester, store, sigSpy } = makeIngester();
		sigSpy.mockRejectedValue(new Error("invalid key"));
		const result = await ingester.ingest(makeValidThread(1700000000000));
		expect(result).toBe(false);
		expect(store.save).not.toHaveBeenCalled();
	});

	// --- threadId === String(createdAt) ---

	it("test_ingest_ThreadIdMismatchCreatedAt_ReturnsFalse", async () => {
		const { ingester, store, logger } = makeIngester();
		const thread = makeThread({
			threadId: "9999999999999",
			createdAt: 1700000000000,
			boardId: BOARD_ID,
		});
		const result = await ingester.ingest(thread);
		expect(result).toBe(false);
		expect(store.save).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledWith(
			"thread_ingester.id_mismatch",
			expect.anything(),
		);
	});

	// --- 重複排除 ---

	it("test_ingest_DuplicateThreadId_ReturnsFalse", async () => {
		const existing = makeValidThread(1700000000000);
		const { ingester } = makeIngester(makeThreadStore([existing]));
		const result = await ingester.ingest(existing);
		expect(result).toBe(false);
	});

	// --- FIFO evict ---

	it("test_ingest_BoardAtMaxThreads_EvictsOldest", async () => {
		// 100 スレ（createdAt 昇順）を用意し、101 個目を追加
		const initial = Array.from({ length: MAX_THREADS_PER_BOARD }, (_, i) =>
			makeValidThread(1700000000000 + i),
		);
		const store = makeThreadStore(initial);
		const { ingester } = makeIngester(store);

		const oldestId = initial[0]?.threadId;
		const newThread = makeValidThread(1700000099999);
		const result = await ingester.ingest(newThread);

		expect(result).toBe(true);
		expect(store.delete).toHaveBeenCalledWith(oldestId);
		expect(store.save).toHaveBeenCalledWith(newThread);
	});

	it("test_ingest_BoardBelowMax_DoesNotEvict", async () => {
		const initial = Array.from({ length: MAX_THREADS_PER_BOARD - 1 }, (_, i) =>
			makeValidThread(1700000000000 + i),
		);
		const store = makeThreadStore(initial);
		const { ingester } = makeIngester(store);

		await ingester.ingest(makeValidThread(1700000099999));
		expect(store.delete).not.toHaveBeenCalled();
	});
});
