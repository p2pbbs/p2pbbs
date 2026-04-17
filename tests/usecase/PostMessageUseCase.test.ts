import { describe, expect, it, vi } from "vitest";
import { DEFAULT_NAME } from "@/core/config/constants";
import type { Post } from "@/core/domain/model/Post";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { LamportClock } from "@/core/domain/service/LamportClock";
import { PostMessageUseCase } from "@/core/usecase/PostMessageUseCase";

const THREAD = "thread-1";
const BOARD = "board-1";
const PUBLIC_KEY = "pubkey-base64";
const OD_ID = "abcd1234";

function makeUsecase(clockOverride?: LamportClock) {
	const postStore = {
		save: vi.fn().mockResolvedValue(undefined),
		getSnapshot: vi.fn().mockReturnValue([]),
		subscribe: vi.fn(),
	};
	const signer = {
		generateKeyPair: vi.fn(),
		sign: vi
			.fn()
			.mockImplementation((draft: Omit<Post, "id" | "signature">) =>
				Promise.resolve({ ...draft, id: "hash-abc", signature: "sig" }),
			),
	};
	const crypto = new CryptoService(signer);
	const clock = clockOverride ?? new LamportClock();
	const gateway = { send: vi.fn(), onReceive: vi.fn() };
	return {
		usecase: new PostMessageUseCase(
			postStore,
			crypto,
			clock,
			PUBLIC_KEY,
			OD_ID,
			THREAD,
			BOARD,
			gateway,
		),
		postStore,
		clock,
		gateway,
	};
}

describe("PostMessageUseCase", () => {
	it("test_execute_ValidInput_SavesPost", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "テスト", body: "本文" });
		expect(postStore.save).toHaveBeenCalledOnce();
	});

	it("test_execute_EmptyName_UsesDefaultName", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "", body: "本文" });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.name).toBe(DEFAULT_NAME);
	});

	it("test_execute_WhitespaceName_UsesDefaultName", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "   ", body: "本文" });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.name).toBe(DEFAULT_NAME);
	});

	it("test_execute_SetsCorrectOdId", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "name", body: "body" });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.odId).toBe(OD_ID);
	});

	it("test_execute_SetsCorrectPublicKey", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "name", body: "body" });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.publicKey).toBe(PUBLIC_KEY);
	});

	it("test_execute_IncreasesLamportPerPost", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "a", body: "body1" });
		await usecase.execute({ name: "b", body: "body2" });
		const first = postStore.save.mock.calls[0]?.[0] as Post;
		const second = postStore.save.mock.calls[1]?.[0] as Post;
		expect(second.lamport).toBeGreaterThan(first.lamport);
	});

	it("test_execute_SetsCorrectBoardAndThread", async () => {
		const { usecase, postStore } = makeUsecase();
		await usecase.execute({ name: "name", body: "body" });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.boardId).toBe(BOARD);
		expect(saved.threadId).toBe(THREAD);
	});

	it("test_execute_AfterMerge_LamportExceedsMergedValue", async () => {
		const clock = new LamportClock();
		clock.merge(10); // 他ピアから lamport=10 を受け取った想定
		const { usecase, postStore } = makeUsecase(clock);
		await usecase.execute({ name: "name", body: "body" });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		expect(saved.lamport).toBe(11);
	});

	it("test_execute_ValidInput_CallsGatewaySend", async () => {
		const { usecase, gateway } = makeUsecase();
		await usecase.execute({ name: "name", body: "body" });
		expect(gateway.send).toHaveBeenCalledOnce();
	});

	it("test_execute_GatewayMessage_HasCorrectTypeAndPost", async () => {
		const { usecase, postStore, gateway } = makeUsecase();
		await usecase.execute({ name: "name", body: "body" });
		const saved = postStore.save.mock.calls[0]?.[0] as Post;
		const sent = gateway.send.mock.calls[0]?.[0];
		expect(sent).toMatchObject({
			type: "post",
			post: saved,
		});
	});

	it("test_execute_GatewayMessage_PathContainsOdId", async () => {
		const { usecase, gateway } = makeUsecase();
		await usecase.execute({ name: "name", body: "body" });
		const sent = gateway.send.mock.calls[0]?.[0];
		expect(sent).toMatchObject({ path: [OD_ID] });
	});

	it("test_execute_GatewayMessage_TtlIsPositive", async () => {
		const { usecase, gateway } = makeUsecase();
		await usecase.execute({ name: "name", body: "body" });
		const sent = gateway.send.mock.calls[0]?.[0] as { ttl: number };
		expect(sent.ttl).toBeGreaterThan(0);
	});
});
