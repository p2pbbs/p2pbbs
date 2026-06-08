import { describe, expect, it, vi } from "vitest";
import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import type { IThreadStore } from "@/core/domain/port/IThreadStore";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { LamportClockMap } from "@/core/domain/service/LamportClockMap";
import { PostIngester } from "@/core/domain/service/PostIngester";
import { ThreadIngester } from "@/core/domain/service/ThreadIngester";
import { ReceiveMessageUseCase } from "@/core/usecase/ReceiveMessageUseCase";
import {
	makeGossipMessage,
	makePost,
	makeThreadCreatedMessage,
	makeThreadStore,
} from "../helpers/fixtures";

const SELF_ID = "self-node";
const POST_THREAD_ID = "thread-1";

function makeUsecase(options?: {
	clockMap?: LamportClockMap;
	threadStore?: IThreadStore;
}) {
	const postStore = {
		save: vi.fn().mockResolvedValue(undefined),
		getSnapshot: vi.fn().mockReturnValue([]),
		subscribe: vi.fn(),
		getThreadIds: vi.fn().mockReturnValue([]),
	};
	const signer = {
		generateKeyPair: vi.fn(),
		sign: vi.fn(),
		signThread: vi.fn(),
	};
	const crypto = new CryptoService(signer);
	const sigSpy = vi.spyOn(crypto, "verifySignature").mockResolvedValue(true);
	const hashSpy = vi.spyOn(crypto, "verifyPostHash").mockResolvedValue(true);
	const threadSigSpy = vi
		.spyOn(crypto, "verifyThreadSignature")
		.mockResolvedValue(true);
	const clockMap = options?.clockMap ?? new LamportClockMap();
	const logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
	const threadStore = options?.threadStore ?? makeThreadStore();
	const ingester = new PostIngester(postStore, crypto, clockMap, logger);
	const threadIngester = new ThreadIngester(threadStore, crypto, logger);
	const gateway = {
		send: vi.fn(),
		onReceive: vi.fn().mockReturnValue(vi.fn()),
	};
	const usecase = new ReceiveMessageUseCase(
		ingester,
		threadIngester,
		SELF_ID,
		gateway,
		logger,
	);
	return {
		usecase,
		postStore,
		threadStore,
		crypto,
		clockMap,
		gateway,
		logger,
		sigSpy,
		hashSpy,
		threadSigSpy,
	};
}

describe("ReceiveMessageUseCase", () => {
	// --- 正常系 ---

	it("test_execute_ValidMessage_SavesPost", async () => {
		const { usecase, postStore } = makeUsecase();
		const msg = makeGossipMessage();
		await usecase.execute(msg);
		expect(postStore.save).toHaveBeenCalledOnce();
		expect(postStore.save).toHaveBeenCalledWith(msg.post);
	});

	it("test_execute_ValidMessage_FansOutWithDecrementedTtl", async () => {
		const { usecase, gateway } = makeUsecase();
		await usecase.execute(makeGossipMessage({ ttl: 3, path: ["peer-a"] }));
		expect(gateway.send).toHaveBeenCalledOnce();
		const forwarded = gateway.send.mock.calls[0]?.[0] as GossipMessage;
		expect(forwarded.ttl).toBe(2);
	});

	it("test_execute_ValidMessage_AddsSelfIdToPath", async () => {
		const { usecase, gateway } = makeUsecase();
		await usecase.execute(makeGossipMessage({ path: ["peer-a"] }));
		const forwarded = gateway.send.mock.calls[0]?.[0] as GossipMessage;
		expect(forwarded.path).toContain(SELF_ID);
		expect(forwarded.path).toContain("peer-a");
	});

	it("test_execute_ValidMessage_MergesLamportClock", async () => {
		const clockMap = new LamportClockMap();
		const { usecase } = makeUsecase({ clockMap });
		await usecase.execute(
			makeGossipMessage({ post: makePost({ lamport: 5 }) }),
		);
		expect(clockMap.get(POST_THREAD_ID).current()).toBe(5);
	});

	it("test_execute_ConcurrentPosts_BothAreSaved", async () => {
		const { usecase, postStore } = makeUsecase();
		const msg1 = makeGossipMessage({ post: makePost({ id: "post-aaa" }) });
		const msg2 = makeGossipMessage({ post: makePost({ id: "post-bbb" }) });
		await Promise.all([usecase.execute(msg1), usecase.execute(msg2)]);
		expect(postStore.save).toHaveBeenCalledTimes(2);
	});

	// --- スキーマ検証 ---

	it("test_execute_InvalidSchema_DoesNotSave", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ type: "unknown", post: null });
		expect(postStore.save).not.toHaveBeenCalled();
	});

	it("test_execute_InvalidSchema_LogsWarning", async () => {
		const { usecase, logger } = makeUsecase();
		await usecase.execute(null);
		expect(logger.warn).toHaveBeenCalledWith(
			"receive.invalid_schema",
			expect.objectContaining({ error: expect.any(String) }),
		);
	});

	// --- 署名検証 ---

	it("test_execute_InvalidSignature_DoesNotSave", async () => {
		const { usecase, postStore, sigSpy } = makeUsecase();
		sigSpy.mockResolvedValue(false);
		await usecase.execute(makeGossipMessage());
		expect(postStore.save).not.toHaveBeenCalled();
	});

	it("test_execute_InvalidSignature_DoesNotFanOut", async () => {
		const { usecase, gateway, sigSpy } = makeUsecase();
		sigSpy.mockResolvedValue(false);
		await usecase.execute(makeGossipMessage());
		expect(gateway.send).not.toHaveBeenCalled();
	});

	it("test_execute_InvalidSignature_LogsWarning", async () => {
		const { usecase, logger, sigSpy } = makeUsecase();
		sigSpy.mockResolvedValue(false);
		await usecase.execute(makeGossipMessage());
		// ログは PostIngester が出力する
		expect(logger.warn).toHaveBeenCalledWith(
			"post_ingester.invalid_signature",
			expect.objectContaining({ postId: expect.any(String) }),
		);
	});

	it("test_execute_InvalidSignatureThenValidSameId_ValidIsProcessed", async () => {
		// 先に不正署名メッセージが来ても seen を汚染しないため、後から届く正規メッセージは保存される
		const { usecase, postStore, sigSpy } = makeUsecase();
		const msg = makeGossipMessage();
		sigSpy.mockResolvedValueOnce(false); // 1回目: 不正 → seen に追加しない
		await usecase.execute(msg);
		await usecase.execute(msg); // 2回目: 正規 → 保存される
		expect(postStore.save).toHaveBeenCalledOnce();
	});

	// --- ハッシュ検証 ---

	it("test_execute_InvalidHash_DoesNotSave", async () => {
		const { usecase, postStore, hashSpy } = makeUsecase();
		hashSpy.mockResolvedValue(false);
		await usecase.execute(makeGossipMessage());
		expect(postStore.save).not.toHaveBeenCalled();
	});

	it("test_execute_InvalidHash_DoesNotFanOut", async () => {
		const { usecase, gateway, hashSpy } = makeUsecase();
		hashSpy.mockResolvedValue(false);
		await usecase.execute(makeGossipMessage());
		expect(gateway.send).not.toHaveBeenCalled();
	});

	it("test_execute_InvalidHash_LogsWarning", async () => {
		const { usecase, logger, hashSpy } = makeUsecase();
		hashSpy.mockResolvedValue(false);
		await usecase.execute(makeGossipMessage());
		// ログは PostIngester が出力する
		expect(logger.warn).toHaveBeenCalledWith(
			"post_ingester.invalid_hash",
			expect.objectContaining({ postId: expect.any(String) }),
		);
	});

	// --- 重複排除 (seen Set) ---

	it("test_execute_DuplicatePostId_SavesOnlyOnce", async () => {
		const { usecase, postStore } = makeUsecase();
		const msg = makeGossipMessage();
		await usecase.execute(msg);
		await usecase.execute(msg);
		expect(postStore.save).toHaveBeenCalledOnce();
	});

	it("test_execute_DuplicatePostId_FansOutOnlyOnce", async () => {
		const { usecase, gateway } = makeUsecase();
		const msg = makeGossipMessage();
		await usecase.execute(msg);
		await usecase.execute(msg);
		expect(gateway.send).toHaveBeenCalledOnce();
	});

	// --- 重複排除 (path による自ノード除外) ---

	it("test_execute_SelfInPath_DoesNotSave", async () => {
		const { usecase, postStore } = makeUsecase();
		// path に selfId が含まれる = 自ノードが投稿または中継済み
		await usecase.execute(makeGossipMessage({ path: [SELF_ID, "peer-a"] }));
		expect(postStore.save).not.toHaveBeenCalled();
	});

	it("test_execute_SelfInPath_DoesNotFanOut", async () => {
		const { usecase, gateway } = makeUsecase();
		await usecase.execute(makeGossipMessage({ path: [SELF_ID] }));
		expect(gateway.send).not.toHaveBeenCalled();
	});

	// --- TTL 制御 ---

	it("test_execute_TtlZero_SavesButDoesNotFanOut", async () => {
		const { usecase, postStore, gateway } = makeUsecase();
		await usecase.execute(makeGossipMessage({ ttl: 0 }));
		expect(postStore.save).toHaveBeenCalledOnce();
		expect(gateway.send).not.toHaveBeenCalled();
	});

	it("test_execute_TtlOne_FansOutWithTtlZero", async () => {
		const { usecase, gateway } = makeUsecase();
		await usecase.execute(makeGossipMessage({ ttl: 1 }));
		expect(gateway.send).toHaveBeenCalledOnce();
		const forwarded = gateway.send.mock.calls[0]?.[0] as GossipMessage;
		expect(forwarded.ttl).toBe(0);
	});

	// --- 処理順序: clock.merge は保存後 ---

	it("test_execute_LamportMerge_HappensAfterSave", async () => {
		const clockMap = new LamportClockMap();
		const { usecase, postStore } = makeUsecase({ clockMap });
		let clockAtSave = -1;
		postStore.save.mockImplementation(() => {
			clockAtSave = clockMap.get(POST_THREAD_ID).current();
			return Promise.resolve();
		});
		await usecase.execute(
			makeGossipMessage({ post: makePost({ lamport: 8 }) }),
		);
		// save 実行時点ではまだ clock は更新されていない
		expect(clockAtSave).toBe(0);
		// save 後に merge されて 8 になっている
		expect(clockMap.get(POST_THREAD_ID).current()).toBe(8);
	});

	// =============================================
	// Story 15c: thread_created 受信
	// =============================================

	it("test_execute_ValidThreadCreated_SavesThreadAndPost", async () => {
		const { usecase, postStore, threadStore } = makeUsecase();
		const msg = makeThreadCreatedMessage();
		await usecase.execute(msg);
		expect(threadStore.save).toHaveBeenCalledOnce();
		expect(postStore.save).toHaveBeenCalledOnce();
	});

	it("test_execute_ValidThreadCreated_FansOut", async () => {
		const { usecase, gateway } = makeUsecase();
		await usecase.execute(
			makeThreadCreatedMessage({ ttl: 3, path: ["peer-a"] }),
		);
		expect(gateway.send).toHaveBeenCalledOnce();
		const forwarded = gateway.send.mock.calls[0]?.[0] as GossipMessage;
		expect(forwarded.type).toBe("thread_created");
		expect(forwarded.ttl).toBe(2);
		expect(forwarded.path).toContain(SELF_ID);
	});

	it("test_execute_ThreadInvalidSignature_DoesNotSaveThreadButSavesPost", async () => {
		const { usecase, postStore, threadStore, threadSigSpy } = makeUsecase();
		threadSigSpy.mockResolvedValue(false);
		await usecase.execute(makeThreadCreatedMessage());
		// Thread は無視。Post は独立して有効なので保存される
		expect(threadStore.save).not.toHaveBeenCalled();
		expect(postStore.save).toHaveBeenCalledOnce();
	});

	it("test_execute_ThreadIdMismatchCreatedAt_DoesNotSaveThread", async () => {
		const { usecase, threadStore } = makeUsecase();
		// threadId が String(createdAt) と一致しない
		const msg = makeThreadCreatedMessage({
			thread: {
				threadId: "9999999999999",
				boardId: "mona",
				title: "テストスレ",
				createdAt: 1700000000000,
				signature: "valid-sig",
				publicKey: "pubkey-base64",
			},
			post: makePost({
				threadId: "9999999999999",
				boardId: "mona",
				lamport: 1,
			}),
		});
		await usecase.execute(msg);
		expect(threadStore.save).not.toHaveBeenCalled();
	});

	it("test_execute_PostThreadIdMismatchThread_DoesNotSaveThread", async () => {
		const { usecase, threadStore, postStore, logger } = makeUsecase();
		// post.threadId が thread.threadId と紐づかない
		const msg = makeThreadCreatedMessage({
			post: makePost({
				threadId: "different-thread",
				boardId: "mona",
				lamport: 1,
			}),
		});
		await usecase.execute(msg);
		expect(threadStore.save).not.toHaveBeenCalled();
		// Post 自体は有効なので保存される
		expect(postStore.save).toHaveBeenCalledOnce();
		expect(logger.warn).toHaveBeenCalledWith(
			"receive.thread_post_mismatch",
			expect.anything(),
		);
	});

	it("test_execute_DuplicateThreadCreated_SavesOnlyOnceAndFansOutOnce", async () => {
		const { usecase, threadStore, gateway } = makeUsecase();
		const msg = makeThreadCreatedMessage();
		await usecase.execute(msg);
		await usecase.execute(msg);
		expect(threadStore.save).toHaveBeenCalledOnce();
		expect(gateway.send).toHaveBeenCalledOnce();
	});

	it("test_execute_ThreadKnownButPostNew_SavesPostAndFansOut", async () => {
		// Thread は既知（has=true）だが Post は新規 → Post 保存 + 伝播
		const existing = makeThreadCreatedMessage();
		const thread = (
			existing as Extract<GossipMessage, { type: "thread_created" }>
		).thread;
		const { usecase, postStore, gateway } = makeUsecase({
			threadStore: makeThreadStore([thread]),
		});
		await usecase.execute(existing);
		expect(postStore.save).toHaveBeenCalledOnce();
		expect(gateway.send).toHaveBeenCalledOnce();
	});

	it("test_execute_ThreadCreatedTtlZero_SavesButDoesNotFanOut", async () => {
		const { usecase, threadStore, postStore, gateway } = makeUsecase();
		await usecase.execute(makeThreadCreatedMessage({ ttl: 0 }));
		expect(threadStore.save).toHaveBeenCalledOnce();
		expect(postStore.save).toHaveBeenCalledOnce();
		expect(gateway.send).not.toHaveBeenCalled();
	});
});
