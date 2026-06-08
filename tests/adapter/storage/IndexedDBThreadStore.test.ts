import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { IndexedDBThreadStore } from "@/core/adapter/storage/IndexedDBThreadStore";
import type { ILogger } from "@/core/domain/port/ILogger";
import { makeThread } from "../../helpers/fixtures";

function makeLogger(): ILogger {
	return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeStore(logger: ILogger = makeLogger()): IndexedDBThreadStore {
	return new IndexedDBThreadStore(logger, new IDBFactory());
}

describe("IndexedDBThreadStore", () => {
	// --- load ---

	it("test_load_EmptyDB_GetByBoardReturnsEmpty", async () => {
		const store = makeStore();
		await store.load();
		expect(store.getByBoard("mona")).toHaveLength(0);
	});

	it("test_load_WithSavedThreads_RestoresThreadsToMemory", async () => {
		const idb = new IDBFactory();
		const store1 = new IndexedDBThreadStore(makeLogger(), idb);
		await store1.load();
		const thread = makeThread({ threadId: "t-restore", boardId: "mona" });
		await store1.save(thread);

		const store2 = new IndexedDBThreadStore(makeLogger(), idb);
		await store2.load();
		const threads = store2.getByBoard("mona");
		expect(threads).toHaveLength(1);
		expect(threads[0]?.threadId).toBe("t-restore");
	});

	it("test_load_CorruptThread_LogsWarnAndSkips", async () => {
		const logger = makeLogger();
		const idb = new IDBFactory();

		await new Promise<void>((resolve, reject) => {
			const req = idb.open("nch-threads", 1);
			req.onupgradeneeded = () => {
				req.result.createObjectStore("threads", { keyPath: "threadId" });
			};
			req.onsuccess = () => {
				const db = req.result;
				const tx = db.transaction("threads", "readwrite");
				// createdAt が文字列 → z.number() 失敗 → safeParse 不合格
				tx.objectStore("threads").put({
					threadId: "bad",
					createdAt: "not-a-number",
				});
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			};
			req.onerror = () => reject(req.error);
		});

		const store = new IndexedDBThreadStore(logger, idb);
		await store.load();

		expect(store.getByBoard("mona")).toHaveLength(0);
		expect(logger.warn).toHaveBeenCalledWith(
			"thread_store.load_corrupt",
			expect.objectContaining({ error: expect.any(String) }),
		);
	});

	// --- save ---

	it("test_save_BeforeLoad_WritesOnlyToMemory", async () => {
		const idb = new IDBFactory();
		const store = new IndexedDBThreadStore(makeLogger(), idb);
		await store.save(makeThread({ threadId: "pre-load" }));
		expect(store.getByBoard("mona")).toHaveLength(1);

		const store2 = new IndexedDBThreadStore(makeLogger(), idb);
		await store2.load();
		expect(store2.getByBoard("mona")).toHaveLength(0);
	});

	it("test_save_AfterLoad_PersistsToIndexedDB", async () => {
		const idb = new IDBFactory();
		const store1 = new IndexedDBThreadStore(makeLogger(), idb);
		await store1.load();
		await store1.save(makeThread({ threadId: "t1", boardId: "mona" }));

		const store2 = new IndexedDBThreadStore(makeLogger(), idb);
		await store2.load();
		expect(store2.getByBoard("mona")).toHaveLength(1);
	});

	it("test_save_DuplicateThreadId_FirstWins", async () => {
		const idb = new IDBFactory();
		const store = new IndexedDBThreadStore(makeLogger(), idb);
		await store.load();
		const first = makeThread({ threadId: "t1", title: "最初のタイトル" });
		const second = makeThread({ threadId: "t1", title: "後からのタイトル" });
		await store.save(first);
		await store.save(second);
		expect(store.getByBoard("mona")).toHaveLength(1);
		expect(store.getByBoard("mona")[0]?.title).toBe("最初のタイトル");
	});

	it("test_save_DuplicateThreadId_AfterReload_FirstWinsInDB", async () => {
		// DB の put() は上書きなので、重複保存を早期 return しないと
		// リロード後に後着のデータが復元されてしまう（先着不変条件の崩壊）
		const idb = new IDBFactory();
		const store1 = new IndexedDBThreadStore(makeLogger(), idb);
		await store1.load();
		await store1.save(makeThread({ threadId: "t1", title: "最初のタイトル" }));
		await store1.save(
			makeThread({ threadId: "t1", title: "後からのタイトル" }),
		);

		const store2 = new IndexedDBThreadStore(makeLogger(), idb);
		await store2.load();
		expect(store2.getByBoard("mona")[0]?.title).toBe("最初のタイトル");
	});

	// --- has ---

	it("test_has_AfterSave_ReturnsTrue", async () => {
		const store = makeStore();
		await store.load();
		await store.save(makeThread({ threadId: "t1" }));
		expect(store.has("t1")).toBe(true);
	});

	it("test_has_UnknownThread_ReturnsFalse", async () => {
		const store = makeStore();
		await store.load();
		expect(store.has("unknown")).toBe(false);
	});

	// --- delete ---

	it("test_delete_ExistingThread_RemovesFromMemoryAndDB", async () => {
		const idb = new IDBFactory();
		const store1 = new IndexedDBThreadStore(makeLogger(), idb);
		await store1.load();
		await store1.save(makeThread({ threadId: "t1", boardId: "mona" }));
		await store1.delete("t1");
		expect(store1.has("t1")).toBe(false);

		const store2 = new IndexedDBThreadStore(makeLogger(), idb);
		await store2.load();
		expect(store2.getByBoard("mona")).toHaveLength(0);
	});

	it("test_delete_UnknownThread_DoesNotThrow", async () => {
		const store = makeStore();
		await store.load();
		await expect(store.delete("unknown")).resolves.not.toThrow();
	});

	// --- subscribe ---

	it("test_subscribe_AfterSave_CallsCallback", async () => {
		const store = makeStore();
		await store.load();
		const cb = vi.fn();
		store.subscribe("mona", cb);
		await store.save(makeThread({ boardId: "mona" }));
		expect(cb).toHaveBeenCalledOnce();
	});

	it("test_subscribe_AfterUnsubscribe_DoesNotCallCallback", async () => {
		const store = makeStore();
		await store.load();
		const cb = vi.fn();
		const unsub = store.subscribe("mona", cb);
		unsub();
		await store.save(makeThread({ boardId: "mona" }));
		expect(cb).not.toHaveBeenCalled();
	});

	// --- getSnapshot is synchronous ---

	it("test_getByBoard_IsSynchronous", async () => {
		const store = makeStore();
		await store.load();
		await store.save(makeThread({ threadId: "t1" }));
		const result = store.getByBoard("mona");
		expect(result).toHaveLength(1);
	});
});
