import { describe, expect, it, vi } from "vitest";
import { InMemoryPostStore } from "@/core/adapter/storage/InMemoryPostStore";
import { makePost } from "../../helpers/fixtures";

const THREAD = "thread-1";

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
});
