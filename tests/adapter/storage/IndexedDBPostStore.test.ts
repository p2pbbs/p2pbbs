import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { IndexedDBPostStore } from "@/core/adapter/storage/IndexedDBPostStore";
import type { ILogger } from "@/core/domain/port/ILogger";
import { makePost } from "../../helpers/fixtures";

function makeLogger(): ILogger {
	return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** テストごとに独立した IndexedDB インスタンスを持つストアを生成する */
function makeStore(logger: ILogger = makeLogger()): IndexedDBPostStore {
	return new IndexedDBPostStore(logger, new IDBFactory());
}

describe("IndexedDBPostStore", () => {
	it("test_load_EmptyDB_ReturnsZeroMaxLamport", async () => {
		const store = makeStore();
		const { maxLamport } = await store.load();
		expect(maxLamport).toBe(0);
	});

	it("test_load_EmptyDB_GetSnapshotReturnsEmpty", async () => {
		const store = makeStore();
		await store.load();
		expect(store.getSnapshot("thread-1")).toHaveLength(0);
	});

	it("test_load_WithSavedPosts_RestoresPostsToMemory", async () => {
		const idb = new IDBFactory();
		const store1 = new IndexedDBPostStore(makeLogger(), idb);
		await store1.load();
		const post = makePost({ id: "p-restore", lamport: 3 });
		await store1.save(post);

		// 同じ IDBFactory を使う第2インスタンスで再ロード
		const store2 = new IndexedDBPostStore(makeLogger(), idb);
		await store2.load();
		const snapshot = store2.getSnapshot(post.threadId);
		expect(snapshot).toHaveLength(1);
		expect(snapshot[0]?.id).toBe("p-restore");
	});

	it("test_load_WithSavedPosts_ReturnsMaxLamport", async () => {
		const idb = new IDBFactory();
		const store1 = new IndexedDBPostStore(makeLogger(), idb);
		await store1.load();
		await store1.save(makePost({ id: "p1", lamport: 3 }));
		await store1.save(makePost({ id: "p2", lamport: 7 }));
		await store1.save(makePost({ id: "p3", lamport: 2 }));

		const store2 = new IndexedDBPostStore(makeLogger(), idb);
		const { maxLamport } = await store2.load();
		expect(maxLamport).toBe(7);
	});

	it("test_getSnapshot_IsSynchronous", async () => {
		const store = makeStore();
		await store.load();
		await store.save(makePost({ id: "sync-test" }));
		// getSnapshot は同期で返ること（Promise でなく Post[] を直接返す）
		const result = store.getSnapshot("thread-1");
		expect(result).toHaveLength(1);
	});

	it("test_save_BeforeLoad_WritesOnlyToMemory", async () => {
		const idb = new IDBFactory();
		const store = new IndexedDBPostStore(makeLogger(), idb);
		// load() を呼ばずに save() — メモリには書くが IndexedDB には書かない
		await store.save(makePost({ id: "pre-load" }));
		expect(store.getSnapshot("thread-1")).toHaveLength(1);

		// 別インスタンスで load しても pre-load 投稿は存在しない
		const store2 = new IndexedDBPostStore(makeLogger(), idb);
		await store2.load();
		expect(store2.getSnapshot("thread-1")).toHaveLength(0);
	});

	it("test_save_DuplicatePost_DoesNotDuplicate", async () => {
		const store = makeStore();
		await store.load();
		const post = makePost({ id: "dup" });
		await store.save(post);
		await store.save(post);
		expect(store.getSnapshot(post.threadId)).toHaveLength(1);
	});

	it("test_subscribe_AfterSave_CallsCallback", async () => {
		const store = makeStore();
		await store.load();
		const cb = vi.fn();
		store.subscribe("thread-1", cb);
		await store.save(makePost());
		expect(cb).toHaveBeenCalledOnce();
	});

	it("test_subscribe_AfterUnsubscribe_DoesNotCallCallback", async () => {
		const store = makeStore();
		await store.load();
		const cb = vi.fn();
		const unsub = store.subscribe("thread-1", cb);
		unsub();
		await store.save(makePost());
		expect(cb).not.toHaveBeenCalled();
	});

	it("test_load_CorruptPost_LogsWarnAndSkips", async () => {
		const logger = makeLogger();
		const idb = new IDBFactory();

		// 直接 IndexedDB に zod スキーマを通過しない不正なオブジェクトを書き込む
		await new Promise<void>((resolve, reject) => {
			const req = idb.open("nch", 1);
			req.onupgradeneeded = () => {
				req.result.createObjectStore("posts", { keyPath: "id" });
			};
			req.onsuccess = () => {
				const db = req.result;
				const tx = db.transaction("posts", "readwrite");
				// lamport が文字列 → z.number() 失敗 → safeParse 不合格
				tx.objectStore("posts").put({ id: "bad", lamport: "not-a-number" });
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			};
			req.onerror = () => reject(req.error);
		});

		const store = new IndexedDBPostStore(logger, idb);
		const { maxLamport } = await store.load();

		// 破損投稿は safeParse 失敗 → スキップされて maxLamport は 0 のまま
		expect(maxLamport).toBe(0);
		// storage.load_corrupt で warn が記録されること
		expect(logger.warn).toHaveBeenCalledWith(
			"storage.load_corrupt",
			expect.objectContaining({ error: expect.any(String) }),
		);
	});
});
