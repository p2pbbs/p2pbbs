import { describe, expect, it, vi } from "vitest";
import { InMemoryThreadStore } from "@/core/adapter/storage/InMemoryThreadStore";
import { makeThread } from "../../helpers/fixtures";

describe("InMemoryThreadStore", () => {
	// --- save / has ---

	it("test_save_NewThread_StoresThread", async () => {
		const store = new InMemoryThreadStore();
		const thread = makeThread({ threadId: "t1", boardId: "mona" });
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
		const threads = store.getByBoard("mona");
		expect(threads).toHaveLength(1);
		expect(threads[0]?.title).toBe("最初のタイトル");
	});

	// --- get ---

	it("test_get_ExistingThread_ReturnsThread", async () => {
		const store = new InMemoryThreadStore();
		const thread = makeThread({ threadId: "t1", boardId: "mona" });
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
		expect(store.getByBoard("mona")).toHaveLength(0);
	});

	it("test_getByBoard_AfterSave_ReturnsThread", async () => {
		const store = new InMemoryThreadStore();
		const thread = makeThread({ boardId: "mona" });
		await store.save(thread);
		expect(store.getByBoard("mona")).toHaveLength(1);
	});

	it("test_getByBoard_BoardIsolation_DoesNotReturnOtherBoard", async () => {
		const store = new InMemoryThreadStore();
		await store.save(makeThread({ threadId: "t1", boardId: "mona" }));
		await store.save(makeThread({ threadId: "t2", boardId: "yaruo" }));
		expect(store.getByBoard("mona")).toHaveLength(1);
		expect(store.getByBoard("yaruo")).toHaveLength(1);
	});

	it("test_getByBoard_SortedByCreatedAtAsc", async () => {
		const store = new InMemoryThreadStore();
		await store.save(makeThread({ threadId: "t3", createdAt: 3000 }));
		await store.save(makeThread({ threadId: "t1", createdAt: 1000 }));
		await store.save(makeThread({ threadId: "t2", createdAt: 2000 }));
		const threads = store.getByBoard("mona");
		expect(threads.map((t) => t.threadId)).toEqual(["t1", "t2", "t3"]);
	});

	// --- delete ---

	it("test_delete_ExistingThread_RemovesThread", async () => {
		const store = new InMemoryThreadStore();
		await store.save(makeThread({ threadId: "t1" }));
		await store.delete("t1");
		expect(store.has("t1")).toBe(false);
		expect(store.getByBoard("mona")).toHaveLength(0);
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
		expect(store.getByBoard("mona")).toHaveLength(1);
	});

	// --- subscribe ---

	it("test_subscribe_AfterSave_CallsCallback", async () => {
		const store = new InMemoryThreadStore();
		const cb = vi.fn();
		store.subscribe("mona", cb);
		await store.save(makeThread({ boardId: "mona" }));
		expect(cb).toHaveBeenCalledOnce();
	});

	it("test_subscribe_AfterUnsubscribe_DoesNotCallCallback", async () => {
		const store = new InMemoryThreadStore();
		const cb = vi.fn();
		const unsub = store.subscribe("mona", cb);
		unsub();
		await store.save(makeThread({ boardId: "mona" }));
		expect(cb).not.toHaveBeenCalled();
	});

	it("test_subscribe_DifferentBoard_DoesNotCallCallback", async () => {
		const store = new InMemoryThreadStore();
		const cb = vi.fn();
		store.subscribe("yaruo", cb);
		await store.save(makeThread({ boardId: "mona" }));
		expect(cb).not.toHaveBeenCalled();
	});

	it("test_subscribe_DuplicateSave_DoesNotNotify", async () => {
		const store = new InMemoryThreadStore();
		const cb = vi.fn();
		store.subscribe("mona", cb);
		const thread = makeThread({ threadId: "t1", boardId: "mona" });
		await store.save(thread);
		await store.save(thread);
		expect(cb).toHaveBeenCalledOnce();
	});

	it("test_subscribe_AfterDelete_CallsCallback", async () => {
		const store = new InMemoryThreadStore();
		await store.save(makeThread({ threadId: "t1", boardId: "mona" }));
		const cb = vi.fn();
		store.subscribe("mona", cb);
		await store.delete("t1");
		expect(cb).toHaveBeenCalledOnce();
	});
});
