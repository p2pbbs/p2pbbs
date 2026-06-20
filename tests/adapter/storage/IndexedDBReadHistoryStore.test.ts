import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { IndexedDBReadHistoryStore } from "@/core/adapter/storage/IndexedDBReadHistoryStore";
import type { ILogger } from "@/core/domain/port/ILogger";

const THREAD = "thread-1";

function makeLogger(): ILogger {
	return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeStore(logger: ILogger = makeLogger()): IndexedDBReadHistoryStore {
	return new IndexedDBReadHistoryStore(logger, new IDBFactory());
}

describe("IndexedDBReadHistoryStore", () => {
	it("test_load_EmptyDB_GetSnapshotReturnsEmpty", async () => {
		const store = makeStore();
		await store.load();
		expect(store.getSnapshot(THREAD).size).toBe(0);
	});

	it("test_markRead_ReflectedInSnapshotSynchronously", async () => {
		const store = makeStore();
		await store.load();
		const promise = store.markRead(THREAD, ["a", "b"]);
		// メモリは markRead 内で同期更新されるため、永続化を待たずに参照できる
		expect(store.getSnapshot(THREAD).has("a")).toBe(true);
		await promise;
	});

	it("test_load_WithSavedHistory_RestoresToMemory", async () => {
		const idb = new IDBFactory();
		const store1 = new IndexedDBReadHistoryStore(makeLogger(), idb);
		await store1.load();
		await store1.markRead(THREAD, ["a", "b"]);

		// 同じ IDBFactory を使う第2インスタンスで再ロード（リロード相当）
		const store2 = new IndexedDBReadHistoryStore(makeLogger(), idb);
		await store2.load();
		const snap = store2.getSnapshot(THREAD);
		expect(snap.has("a")).toBe(true);
		expect(snap.has("b")).toBe(true);
		expect(snap.size).toBe(2);
	});

	it("test_markRead_Accumulates_PersistedAcrossReload", async () => {
		const idb = new IDBFactory();
		const store1 = new IndexedDBReadHistoryStore(makeLogger(), idb);
		await store1.load();
		await store1.markRead(THREAD, ["a"]);
		await store1.markRead(THREAD, ["b"]);

		const store2 = new IndexedDBReadHistoryStore(makeLogger(), idb);
		await store2.load();
		expect([...store2.getSnapshot(THREAD)].sort()).toEqual(["a", "b"]);
	});

	it("test_markRead_BeforeLoad_WritesOnlyToMemory", async () => {
		const idb = new IDBFactory();
		const store = new IndexedDBReadHistoryStore(makeLogger(), idb);
		// load() を呼ばずに markRead — メモリには書くが IndexedDB には書かない
		await store.markRead(THREAD, ["a"]);
		expect(store.getSnapshot(THREAD).has("a")).toBe(true);

		const store2 = new IndexedDBReadHistoryStore(makeLogger(), idb);
		await store2.load();
		expect(store2.getSnapshot(THREAD).size).toBe(0);
	});

	it("test_load_CorruptRecord_LogsWarnAndSkips", async () => {
		const logger = makeLogger();
		const idb = new IDBFactory();

		// zod スキーマを通過しない不正レコードを直接書き込む
		await new Promise<void>((resolve, reject) => {
			const req = idb.open("nch-read-history", 1);
			req.onupgradeneeded = () => {
				req.result.createObjectStore("readHistory", { keyPath: "threadId" });
			};
			req.onsuccess = () => {
				const db = req.result;
				const tx = db.transaction("readHistory", "readwrite");
				// postIds が文字列 → z.array(z.string()) 失敗
				tx.objectStore("readHistory").put({
					threadId: "bad",
					postIds: "not-an-array",
				});
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			};
			req.onerror = () => reject(req.error);
		});

		const store = new IndexedDBReadHistoryStore(logger, idb);
		await store.load();

		expect(store.getSnapshot("bad").size).toBe(0);
		expect(logger.warn).toHaveBeenCalledWith(
			"read_history.load_corrupt",
			expect.objectContaining({ error: expect.any(String) }),
		);
	});
});
