import { describe, expect, it, vi } from "vitest";
import { DEFAULT_NAME, MAX_POSTS_PER_THREAD } from "@/core/config/constants";
import { NchError } from "@/core/domain/error/NchError";
import type { Post } from "@/core/domain/model/Post";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { LamportClockMap } from "@/core/domain/service/LamportClockMap";
import { PostMessageUseCase } from "@/core/usecase/PostMessageUseCase";
import { TEST_BOARD_ID, TEST_THREAD_ID } from "../helpers/constants";
import { makePost } from "../helpers/fixtures";

const THREAD = TEST_THREAD_ID;
const BOARD = TEST_BOARD_ID;
const PUBLIC_KEY = "pubkey-base64";
const OD_ID = "abcd1234";
const PEER_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeUsecase(options?: {
	clockMap?: LamportClockMap;
	snapshot?: Post[];
}) {
	const postStore = {
		save: vi.fn().mockResolvedValue(undefined),
		getSnapshot: vi.fn().mockReturnValue(options?.snapshot ?? []),
		subscribe: vi.fn(),
		getThreadIds: vi.fn().mockReturnValue([]),
		subscribeBoard: vi.fn().mockReturnValue(() => {}),
		getBoardRevision: vi.fn().mockReturnValue(0),
	};
	const signer = {
		generateKeyPair: vi.fn(),
		sign: vi
			.fn()
			.mockImplementation((draft: Omit<Post, "id" | "signature">) =>
				Promise.resolve({ ...draft, id: "hash-abc", signature: "sig" }),
			),
		signThread: vi.fn(),
	};
	const crypto = new CryptoService(signer);
	const clockMap = options?.clockMap ?? new LamportClockMap();
	const gateway = { send: vi.fn(), onReceive: vi.fn() };
	return {
		usecase: new PostMessageUseCase(
			postStore,
			crypto,
			clockMap,
			{
				publicKey: PUBLIC_KEY,
				odId: OD_ID,
				peerId: PEER_ID,
				boardId: BOARD,
			},
			gateway,
		),
		postStore,
		clockMap,
		gateway,
	};
}

describe("PostMessageUseCase", () => {
	it("test_execute_ValidInput_SavesPost", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "テスト", body: "本文", threadId: THREAD });
		expect(postStore.save).toHaveBeenCalledOnce();
	});

	it("test_execute_EmptyName_UsesDefaultName", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "", body: "本文", threadId: THREAD });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.name).toBe(DEFAULT_NAME);
	});

	it("test_execute_WhitespaceName_UsesDefaultName", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "   ", body: "本文", threadId: THREAD });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.name).toBe(DEFAULT_NAME);
	});

	it("test_execute_SetsCorrectOdId", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "name", body: "body", threadId: THREAD });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.odId).toBe(OD_ID);
	});

	it("test_execute_SetsCorrectPublicKey", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "name", body: "body", threadId: THREAD });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.publicKey).toBe(PUBLIC_KEY);
	});

	it("test_execute_IncreasesLamportPerPost", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "a", body: "body1", threadId: THREAD });
		await usecase.execute({ name: "b", body: "body2", threadId: THREAD });
		const first = postStore.save.mock.calls[0]?.[0] as Post;
		const second = postStore.save.mock.calls[1]?.[0] as Post;
		expect(second.lamport).toBeGreaterThan(first.lamport);
	});

	it("test_execute_SetsCorrectBoardAndThread", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "name", body: "body", threadId: THREAD });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.boardId).toBe(BOARD);
		expect(saved.threadId).toBe(THREAD);
	});

	it("test_execute_UsesThreadIdFromInput", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({
			name: "name",
			body: "body",
			threadId: "other-thread",
		});
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.threadId).toBe("other-thread");
	});

	it("test_execute_PerThreadLamport_IndependentCounters", async () => {
		// スレ単位で Lamport を管理する。別スレへの投稿はカウンタを共有しない
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "a", body: "1", threadId: "t-a" });
		await usecase.execute({ name: "b", body: "2", threadId: "t-b" });
		const a = postStore.save.mock.calls[0]?.[0] as Post;
		const b = postStore.save.mock.calls[1]?.[0] as Post;
		expect(a.lamport).toBe(1);
		expect(b.lamport).toBe(1);
	});

	it("test_execute_AfterMerge_LamportExceedsMergedValue", async () => {
		const clockMap = new LamportClockMap();
		clockMap.get(THREAD).merge(10); // 他ピアから lamport=10 を受け取った想定
		const { usecase, postStore } = makeUsecase({ clockMap });
		await usecase.execute({ name: "name", body: "body", threadId: THREAD });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.lamport).toBe(11);
	});

	it("test_execute_ValidInput_CallsGatewaySend", async () => {
		const { usecase, gateway } = makeUsecase();
		await usecase.execute({ name: "name", body: "body", threadId: THREAD });
		expect(gateway.send).toHaveBeenCalledOnce();
	});

	it("test_execute_GatewayMessage_HasCorrectTypeAndPost", async () => {
		const { usecase, postStore, gateway } = makeUsecase();
		await usecase.execute({ name: "name", body: "body", threadId: THREAD });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		const sent = gateway.send.mock.calls[0]?.[0];
		expect(sent).toMatchObject({
			type: "post",
			post: saved,
		});
	});

	it("test_execute_GatewayMessage_PathContainsPeerId", async () => {
		const { usecase, gateway } = makeUsecase();
		await usecase.execute({ name: "name", body: "body", threadId: THREAD });
		const sent = gateway.send.mock.calls[0]?.[0];
		expect(sent).toMatchObject({ path: [PEER_ID] });
	});

	it("test_execute_GatewayMessage_TtlIsPositive", async () => {
		const { usecase, gateway } = makeUsecase();
		await usecase.execute({ name: "name", body: "body", threadId: THREAD });
		const sent = gateway.send.mock.calls[0]?.[0] as { ttl: number };
		expect(sent.ttl).toBeGreaterThan(0);
	});

	// --- 1000 レス上限 ---

	it("test_execute_ThreadAtMaxPosts_ThrowsAndDoesNotSave", async () => {
		const full = Array.from({ length: MAX_POSTS_PER_THREAD }, (_, i) =>
			makePost({ id: `p${i}`, lamport: i + 1 }),
		);
		const { usecase, postStore, gateway } = makeUsecase({ snapshot: full });
		await expect(
			usecase.execute({ name: "name", body: "body", threadId: THREAD }),
		).rejects.toBeInstanceOf(NchError);
		expect(postStore.save).not.toHaveBeenCalled();
		expect(gateway.send).not.toHaveBeenCalled();
	});

	it("test_execute_ThreadBelowMaxPosts_Succeeds", async () => {
		const almost = Array.from({ length: MAX_POSTS_PER_THREAD - 1 }, (_, i) =>
			makePost({ id: `p${i}`, lamport: i + 1 }),
		);
		const { usecase, postStore } = makeUsecase({ snapshot: almost });
		await usecase.execute({ name: "name", body: "body", threadId: THREAD });
		expect(postStore.save).toHaveBeenCalledOnce();
	});
});
