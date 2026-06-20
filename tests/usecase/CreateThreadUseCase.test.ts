import { describe, expect, it, vi } from "vitest";
import { DEFAULT_NAME, MAX_THREADS_PER_BOARD } from "@/core/config/constants";
import { NchError } from "@/core/domain/error/NchError";
import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import type { Post } from "@/core/domain/model/Post";
import type { Thread } from "@/core/domain/model/Thread";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IThreadStore } from "@/core/domain/port/IThreadStore";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { LamportClockMap } from "@/core/domain/service/LamportClockMap";
import { ThreadIngester } from "@/core/domain/service/ThreadIngester";
import { CreateThreadUseCase } from "@/core/usecase/CreateThreadUseCase";
import { TEST_BOARD_ID } from "../helpers/constants";
import { makeThread, makeThreadStore } from "../helpers/fixtures";

const BOARD = TEST_BOARD_ID;
const PUBLIC_KEY = "pubkey-base64";
const OD_ID = "abcd1234";
const PEER_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeLogger(): ILogger {
	return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeUsecase(options?: { threadStore?: IThreadStore }) {
	const postStore = {
		save: vi.fn().mockResolvedValue(undefined),
		getSnapshot: vi.fn().mockReturnValue([]),
		subscribe: vi.fn(),
		getThreadIds: vi.fn().mockReturnValue([]),
		subscribeBoard: vi.fn().mockReturnValue(() => {}),
		getBoardRevision: vi.fn().mockReturnValue(0),
	};
	const threadStore = options?.threadStore ?? makeThreadStore();
	const signer = {
		generateKeyPair: vi.fn(),
		sign: vi
			.fn()
			.mockImplementation((draft: Omit<Post, "id" | "signature">) =>
				Promise.resolve({ ...draft, id: "hash-abc", signature: "sig" }),
			),
		signThread: vi
			.fn()
			.mockImplementation((draft: Omit<Thread, "signature">) =>
				Promise.resolve({ ...draft, signature: "thread-sig" }),
			),
	};
	const crypto = new CryptoService(signer);
	vi.spyOn(crypto, "verifyThreadSignature").mockResolvedValue(true);
	const clockMap = new LamportClockMap();
	const logger = makeLogger();
	const threadIngester = new ThreadIngester(threadStore, crypto, logger);
	const gateway = { send: vi.fn(), onReceive: vi.fn() };

	const usecase = new CreateThreadUseCase(
		postStore,
		crypto,
		clockMap,
		threadIngester,
		{ publicKey: PUBLIC_KEY, odId: OD_ID, peerId: PEER_ID, boardId: BOARD },
		gateway,
	);
	return { usecase, postStore, threadStore, signer, gateway, clockMap };
}

describe("CreateThreadUseCase", () => {
	it("test_execute_ValidInput_SavesThreadAndPost", async () => {
		const { usecase, postStore, threadStore } = makeUsecase();
		await usecase.execute({ title: "新スレ", name: "名無し", body: "本文" });
		expect(threadStore.save).toHaveBeenCalledOnce();
		expect(postStore.save).toHaveBeenCalledOnce();
	});

	it("test_execute_ThreadIdIsStringOfCreatedAt", async () => {
		const { usecase, signer } = makeUsecase();
		await usecase.execute({ title: "新スレ", name: "n", body: "b" });
		const draft = signer.signThread.mock.calls[0]?.[0] as Omit<
			Thread,
			"signature"
		>;
		expect(draft.threadId).toBe(String(draft.createdAt));
	});

	it("test_execute_FirstPostHasLamportOne", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ title: "新スレ", name: "n", body: "b" });
		const post = postStore.save.mock.calls[0]?.[0] as Post;
		expect(post.lamport).toBe(1);
	});

	it("test_execute_PostBelongsToCreatedThread", async () => {
		const { usecase, postStore, signer } = makeUsecase();
		await usecase.execute({ title: "新スレ", name: "n", body: "b" });
		const draft = signer.signThread.mock.calls[0]?.[0] as Omit<
			Thread,
			"signature"
		>;
		const post = postStore.save.mock.calls[0]?.[0] as Post;
		expect(post.threadId).toBe(draft.threadId);
		expect(post.boardId).toBe(BOARD);
	});

	it("test_execute_EmptyName_UsesDefaultName", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ title: "新スレ", name: "  ", body: "b" });
		const post = postStore.save.mock.calls[0]?.[0] as Post;
		expect(post.name).toBe(DEFAULT_NAME);
	});

	it("test_execute_GossipMessage_IsThreadCreatedWithBoth", async () => {
		const { usecase, gateway, postStore, signer } = makeUsecase();
		await usecase.execute({ title: "新スレ", name: "n", body: "b" });
		const sent = gateway.send.mock.calls[0]?.[0] as GossipMessage;
		const post = postStore.save.mock.calls[0]?.[0] as Post;
		const draft = signer.signThread.mock.calls[0]?.[0] as Omit<
			Thread,
			"signature"
		>;
		expect(sent.type).toBe("thread_created");
		if (sent.type !== "thread_created") return;
		expect(sent.post).toEqual(post);
		expect(sent.thread.threadId).toBe(draft.threadId);
		expect(sent.path).toEqual([PEER_ID]);
		expect(sent.ttl).toBeGreaterThan(0);
	});

	// --- タイトル検証 ---

	it("test_execute_EmptyTitle_ThrowsAndDoesNotSave", async () => {
		const { usecase, threadStore, gateway } = makeUsecase();
		await expect(
			usecase.execute({ title: "   ", name: "n", body: "b" }),
		).rejects.toBeInstanceOf(NchError);
		expect(threadStore.save).not.toHaveBeenCalled();
		expect(gateway.send).not.toHaveBeenCalled();
	});

	it("test_execute_TitleTooLong_Throws", async () => {
		const { usecase } = makeUsecase();
		// 151 バイト（ASCII）
		const longTitle = "a".repeat(151);
		await expect(
			usecase.execute({ title: longTitle, name: "n", body: "b" }),
		).rejects.toBeInstanceOf(NchError);
	});

	// --- FIFO evict ---

	it("test_execute_BoardAtMaxThreads_EvictsOldest", async () => {
		const initial = Array.from({ length: MAX_THREADS_PER_BOARD }, (_, i) =>
			makeThread({
				threadId: String(1700000000000 + i),
				createdAt: 1700000000000 + i,
				boardId: BOARD,
			}),
		);
		const oldestId = initial[0]?.threadId;
		const threadStore = makeThreadStore(initial);
		const { usecase } = makeUsecase({ threadStore });

		await usecase.execute({ title: "新スレ", name: "n", body: "b" });
		expect(threadStore.delete).toHaveBeenCalledWith(oldestId);
	});
});
