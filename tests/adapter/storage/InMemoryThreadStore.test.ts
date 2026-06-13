import { describe, expect, it, vi } from "vitest";
import { InMemoryThreadStore } from "@/core/adapter/storage/InMemoryThreadStore";
import { TEST_BOARD_ID, TEST_BOARD_ID_ALT } from "../../helpers/constants";
import { makeThread } from "../../helpers/fixtures";

describe("InMemoryThreadStore", () => {
	// --- save / has ---

	it("test_save_NewThread_StoresThread", async () => {
		const store = new InMemoryThreadStore();
		const thread = makeThread({ threadId: "t1", boardId: TEST_BOARD_ID });
		await store.save(thread);
		expect(store.has("t1")).toBe(true);
	});

	it("test_has_UnknownThread_ReturnsFalse", () => {
		const store = new InMemoryThreadStore();
		expect(store.has("unknown")).toBe(false);
	});

	it("test_save_DuplicateThreadId_FirstWins", async () => {
		const store = new InMemoryThreadStore();
		const first = makeThread({ threadId: "t1", title: "最初のタイトル" });
		const second = makeThread({ threadId: "t1", title: "後からのタイトル" });
		await store.save(first);
		await store.save(second);
		const threads = store.getByBoard(TEST_BOARD_ID);
		expect(threads).toHaveLength(1);
		expect(threads[0]?.title).toBe("最初のタイトル");
	});

	// --- get ---

	it("test_get_ExistingThread_ReturnsThread", async () => {
		const store = new InMemoryThreadStore();
		const thread = makeThread({ threadId: "t1", boardId: TEST_BOARD_ID });
		await store.save(thread);
		expect(store.get("t1")).toEqual(thread);
	});

	it("test_get_UnknownThread_ReturnsUndefined", () => {
		const store = new InMemoryThreadStore();
		expect(store.get("unknown")).toBeUndefined();
	});

	// --- getByBoard ---

	it("test_getByBoard_NoThreads_ReturnsEmpty", () => {
		const store = new InMemoryThreadStore();
		expect(store.getByBoard(TEST_BOARD_ID)).toHaveLength(0);
	});

	it("test_getByBoard_AfterSave_ReturnsThread", async () => {
		const store = new InMemoryThreadStore();
		const thread = makeThread({ boardId: TEST_BOARD_ID });
		await store.save(thread);
		expect(store.getByBoard(TEST_BOARD_ID)).toHaveLength(1);
	});

	it("test_getByBoard_BoardIsolation_DoesNotReturnOtherBoard", async () => {
		const store = new InMemoryThreadStore();
		await store.save(makeThread({ threadId: "t1", boardId: TEST_BOARD_ID }));
		await store.save(
			makeThread({ threadId: "t2", boardId: TEST_BOARD_ID_ALT }),
		);
		expect(store.getByBoard(TEST_BOARD_ID)).toHaveLength(1);
		expect(store.getByBoard(TEST_BOARD_ID_ALT)).toHaveLength(1);
	});

	it("test_getByBoard_SortedByCreatedAtAsc", async () => {
		const store = new InMemoryThreadStore();
		await store.save(makeThread({ threadId: "t3", createdAt: 3000 }));
		await store.save(makeThread({ threadId: "t1", createdAt: 1000 }));
		await store.save(makeThread({ threadId: "t2", createdAt: 2000 }));
		const threads = store.getByBoard(TEST_BOARD_ID);
		expect(threads.map((t) => t.threadId)).toEqual(["t1", "t2", "t3"]);
	});

	// --- delete ---

	it("test_delete_ExistingThread_RemovesThread", async () => {
		const store = new InMemoryThreadStore();
		await store.save(makeThread({ threadId: "t1" }));
		await store.delete("t1");
		expect(store.has("t1")).toBe(false);
		expect(store.getByBoard(TEST_BOARD_ID)).toHaveLength(0);
	});

	it("test_delete_UnknownThread_DoesNotThrow", async () => {
		const store = new InMemoryThreadStore();
		await expect(store.delete("unknown")).resolves.not.toThrow();
	});

	it("test_delete_OnlyDeletesTargetThread", async () => {
		const store = new InMemoryThreadStore();
		await store.save(makeThread({ threadId: "t1" }));
		await store.save(makeThread({ threadId: "t2" }));
		await store.delete("t1");
		expect(store.has("t1")).toBe(false);
		expect(store.has("t2")).toBe(true);
		expect(store.getByBoard(TEST_BOARD_ID)).toHaveLength(1);
	});

	// --- subscribe ---

	it("test_subscribe_AfterSave_CallsCallback", async () => {
		const store = new InMemoryThreadStore();
		const cb = vi.fn();
		store.subscribe(TEST_BOARD_ID, cb);
		await store.save(makeThread({ boardId: TEST_BOARD_ID }));
		expect(cb).toHaveBeenCalledOnce();
	});

	it("test_subscribe_AfterUnsubscribe_DoesNotCallCallback", async () => {
		const store = new InMemoryThreadStore();
		const cb = vi.fn();
		const unsub = store.subscribe(TEST_BOARD_ID, cb);
		unsub();
		await store.save(makeThread({ boardId: TEST_BOARD_ID }));
		expect(cb).not.toHaveBeenCalled();
	});

	it("test_subscribe_DifferentBoard_DoesNotCallCallback", async () => {
		const store = new InMemoryThreadStore();
		const cb = vi.fn();
		store.subscribe(TEST_BOARD_ID_ALT, cb);
		await store.save(makeThread({ boardId: TEST_BOARD_ID }));
		expect(cb).not.toHaveBeenCalled();
	});

	it("test_subscribe_DuplicateSave_DoesNotNotify", async () => {
		const store = new InMemoryThreadStore();
		const cb = vi.fn();
		store.subscribe(TEST_BOARD_ID, cb);
		const thread = makeThread({ threadId: "t1", boardId: TEST_BOARD_ID });
		await store.save(thread);
		await store.save(thread);
		expect(cb).toHaveBeenCalledOnce();
	});

	it("test_subscribe_AfterDelete_CallsCallback", async () => {
		const store = new InMemoryThreadStore();
		await store.save(makeThread({ threadId: "t1", boardId: TEST_BOARD_ID }));
		const cb = vi.fn();
		store.subscribe(TEST_BOARD_ID, cb);
		await store.delete("t1");
		expect(cb).toHaveBeenCalledOnce();
	});
});
