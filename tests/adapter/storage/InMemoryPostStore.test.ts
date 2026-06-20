import { describe, expect, it, vi } from "vitest";
import { InMemoryPostStore } from "@/core/adapter/storage/InMemoryPostStore";
import { TEST_BOARD_ID, TEST_THREAD_ID } from "../../helpers/constants";
import { makePost } from "../../helpers/fixtures";

const THREAD = TEST_THREAD_ID;

describe("InMemoryPostStore", () => {
	it("test_getSnapshot_WithInitialPosts_ReturnsThosePosts", () => {
		const initial = makePost({ lamport: 1 });
		const store = new InMemoryPostStore(new Map([[THREAD, [initial]]]));
		const posts = store.getSnapshot(THREAD);
		expect(posts).toHaveLength(1);
		expect(posts[0]?.id).toBe(initial.id);
	});

	it("test_getSnapshot_UnknownThread_ReturnsEmpty", () => {
		const store = new InMemoryPostStore();
		expect(store.getSnapshot("unknown")).toHaveLength(0);
	});

	it("test_save_NewPost_AppendsToThread", async () => {
		const store = new InMemoryPostStore();
		const post = makePost({ id: "p2", lamport: 2 });
		await store.save(post);
		const posts = store.getSnapshot(THREAD);
		expect(posts).toHaveLength(1);
		expect(posts[0]?.id).toBe("p2");
	});

	it("test_save_UsesPostThreadId_AsKey", async () => {
		const store = new InMemoryPostStore();
		await store.save(makePost({ threadId: "thread-a" }));
		expect(store.getSnapshot("thread-a")).toHaveLength(1);
		expect(store.getSnapshot("thread-b")).toHaveLength(0);
	});

	it("test_subscribe_AfterSave_CallsCallback", async () => {
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		store.subscribe(THREAD, cb);
		await store.save(makePost());
		expect(cb).toHaveBeenCalledOnce();
	});

	it("test_subscribe_AfterUnsubscribe_DoesNotCallCallback", async () => {
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		const unsub = store.subscribe(THREAD, cb);
		unsub();
		await store.save(makePost());
		expect(cb).not.toHaveBeenCalled();
	});

	it("test_save_DifferentThread_DoesNotNotifyOtherThread", async () => {
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		store.subscribe("other-thread", cb);
		await store.save(makePost({ threadId: THREAD }));
		expect(cb).not.toHaveBeenCalled();
	});

	it("test_save_DuplicatePostId_DoesNotAddDuplicate", async () => {
		const store = new InMemoryPostStore();
		const post = makePost({ id: "dup-id" });
		await store.save(post);
		await store.save(post);
		expect(store.getSnapshot(THREAD)).toHaveLength(1);
	});

	it("test_save_DuplicatePostId_DoesNotNotifySubscribers", async () => {
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		store.subscribe(THREAD, cb);
		const post = makePost({ id: "dup-id" });
		await store.save(post);
		await store.save(post);
		// 最初の save で 1 回だけ通知される
		expect(cb).toHaveBeenCalledOnce();
	});

	// --- getThreadIds ---

	it("test_getThreadIds_NoPostsSaved_ReturnsEmpty", () => {
		const store = new InMemoryPostStore();
		expect(store.getThreadIds(TEST_BOARD_ID)).toHaveLength(0);
	});

	it("test_getThreadIds_AfterSave_ReturnsThreadId", async () => {
		const store = new InMemoryPostStore();
		await store.save(
			makePost({ boardId: TEST_BOARD_ID, threadId: TEST_THREAD_ID }),
		);
		expect(store.getThreadIds(TEST_BOARD_ID)).toEqual([TEST_THREAD_ID]);
	});

	it("test_getThreadIds_MultipleThreadsSameBoard_ReturnsAll", async () => {
		const store = new InMemoryPostStore();
		await store.save(
			makePost({ id: "p1", boardId: TEST_BOARD_ID, threadId: "thread-a" }),
		);
		await store.save(
			makePost({ id: "p2", boardId: TEST_BOARD_ID, threadId: "thread-b" }),
		);
		const ids = store.getThreadIds(TEST_BOARD_ID);
		expect(ids).toContain("thread-a");
		expect(ids).toContain("thread-b");
		expect(ids).toHaveLength(2);
	});

	it("test_getThreadIds_BoardIsolation_DoesNotReturnOtherBoard", async () => {
		const store = new InMemoryPostStore();
		await store.save(
			makePost({ boardId: TEST_BOARD_ID, threadId: TEST_THREAD_ID }),
		);
		await store.save(
			makePost({ id: "p2", boardId: "board-2", threadId: "thread-x" }),
		);
		expect(store.getThreadIds(TEST_BOARD_ID)).toEqual([TEST_THREAD_ID]);
		expect(store.getThreadIds("board-2")).toEqual(["thread-x"]);
	});

	it("test_getThreadIds_DuplicatePostsSameThread_NoDuplicate", async () => {
		const store = new InMemoryPostStore();
		await store.save(
			makePost({ id: "p1", boardId: TEST_BOARD_ID, threadId: TEST_THREAD_ID }),
		);
		await store.save(
			makePost({ id: "p2", boardId: TEST_BOARD_ID, threadId: TEST_THREAD_ID }),
		);
		expect(store.getThreadIds(TEST_BOARD_ID)).toHaveLength(1);
	});

	it("test_getThreadIds_InitialMap_TracksThreadIds", () => {
		const post = makePost({ boardId: TEST_BOARD_ID, threadId: "thread-x" });
		const store = new InMemoryPostStore(new Map([["thread-x", [post]]]));
		expect(store.getThreadIds(TEST_BOARD_ID)).toEqual(["thread-x"]);
	});

	// --- 板単位リビジョン / 購読（未反映バッジ用） ---

	it("test_getBoardRevision_NoSave_ReturnsZero", () => {
		const store = new InMemoryPostStore();
		expect(store.getBoardRevision(TEST_BOARD_ID)).toBe(0);
	});

	it("test_save_NewPost_IncrementsBoardRevision", async () => {
		const store = new InMemoryPostStore();
		await store.save(
			makePost({ id: "p1", boardId: TEST_BOARD_ID, threadId: "thread-a" }),
		);
		expect(store.getBoardRevision(TEST_BOARD_ID)).toBe(1);
		await store.save(
			makePost({ id: "p2", boardId: TEST_BOARD_ID, threadId: "thread-b" }),
		);
		expect(store.getBoardRevision(TEST_BOARD_ID)).toBe(2);
	});

	it("test_save_DuplicatePostId_DoesNotIncrementBoardRevision", async () => {
		const store = new InMemoryPostStore();
		const post = makePost({ id: "dup", boardId: TEST_BOARD_ID });
		await store.save(post);
		await store.save(post);
		// dedup early-return の後で ++ するため再配信では増えない
		expect(store.getBoardRevision(TEST_BOARD_ID)).toBe(1);
	});

	it("test_subscribeBoard_AfterSave_CallsCallback", async () => {
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		store.subscribeBoard(TEST_BOARD_ID, cb);
		await store.save(makePost({ boardId: TEST_BOARD_ID }));
		expect(cb).toHaveBeenCalledOnce();
	});

	it("test_subscribeBoard_NewThreadInBoard_CallsCallback", async () => {
		// 新スレの >>1 も board への save なので拾える
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		store.subscribeBoard(TEST_BOARD_ID, cb);
		await store.save(
			makePost({ id: "p1", boardId: TEST_BOARD_ID, threadId: "thread-a" }),
		);
		await store.save(
			makePost({ id: "p2", boardId: TEST_BOARD_ID, threadId: "thread-b" }),
		);
		expect(cb).toHaveBeenCalledTimes(2);
	});

	it("test_subscribeBoard_DuplicatePostId_DoesNotCallCallback", async () => {
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		store.subscribeBoard(TEST_BOARD_ID, cb);
		const post = makePost({ id: "dup", boardId: TEST_BOARD_ID });
		await store.save(post);
		await store.save(post);
		expect(cb).toHaveBeenCalledOnce();
	});

	it("test_subscribeBoard_OtherBoardSave_DoesNotCallCallback", async () => {
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		store.subscribeBoard(TEST_BOARD_ID, cb);
		await store.save(makePost({ boardId: "board-2", threadId: "thread-x" }));
		expect(cb).not.toHaveBeenCalled();
	});

	it("test_subscribeBoard_AfterUnsubscribe_DoesNotCallCallback", async () => {
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		const unsub = store.subscribeBoard(TEST_BOARD_ID, cb);
		unsub();
		await store.save(makePost({ boardId: TEST_BOARD_ID }));
		expect(cb).not.toHaveBeenCalled();
	});
});
