import { describe, expect, it } from "vitest";
import { InMemoryReadHistoryStore } from "@/core/adapter/storage/InMemoryReadHistoryStore";

const THREAD = "thread-1";

describe("InMemoryReadHistoryStore", () => {
	it("test_getSnapshot_UnknownThread_ReturnsEmpty", () => {
		const store = new InMemoryReadHistoryStore();
		expect(store.getSnapshot(THREAD).size).toBe(0);
	});

	it("test_getSnapshot_WithInitial_ReturnsSeededIds", () => {
		const store = new InMemoryReadHistoryStore(new Map([[THREAD, ["a", "b"]]]));
		const snap = store.getSnapshot(THREAD);
		expect(snap.has("a")).toBe(true);
		expect(snap.has("b")).toBe(true);
		expect(snap.size).toBe(2);
	});

	it("test_markRead_AddsIds_ReflectedInSnapshotSynchronously", async () => {
		const store = new InMemoryReadHistoryStore();
		const promise = store.markRead(THREAD, ["a", "b"]);
		// markRead はメモリを同期更新するため await 前に反映される
		expect(store.getSnapshot(THREAD).has("a")).toBe(true);
		await promise;
		expect(store.getSnapshot(THREAD).size).toBe(2);
	});

	it("test_markRead_Accumulates_AcrossCalls", async () => {
		const store = new InMemoryReadHistoryStore();
		await store.markRead(THREAD, ["a"]);
		await store.markRead(THREAD, ["b", "c"]);
		expect([...store.getSnapshot(THREAD)].sort()).toEqual(["a", "b", "c"]);
	});

	it("test_markRead_DuplicateIds_NoDuplicateInSet", async () => {
		const store = new InMemoryReadHistoryStore();
		await store.markRead(THREAD, ["a"]);
		await store.markRead(THREAD, ["a"]);
		expect(store.getSnapshot(THREAD).size).toBe(1);
	});

	it("test_markRead_ThreadIsolation_DoesNotLeakAcrossThreads", async () => {
		const store = new InMemoryReadHistoryStore();
		await store.markRead("t1", ["a"]);
		await store.markRead("t2", ["b"]);
		expect(store.getSnapshot("t1").has("b")).toBe(false);
		expect(store.getSnapshot("t2").has("a")).toBe(false);
	});

	it("test_constructor_DoesNotShareSetWithInitialMap", async () => {
		const initialIds = new Set(["a"]);
		const store = new InMemoryReadHistoryStore(new Map([[THREAD, initialIds]]));
		await store.markRead(THREAD, ["b"]);
		// 元の Set には影響しない（コピーされている）
		expect(initialIds.has("b")).toBe(false);
	});
});
