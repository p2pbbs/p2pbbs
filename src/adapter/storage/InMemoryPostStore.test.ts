import { describe, expect, it, vi } from "vitest";
import { makePost } from "../../../tests/helpers/fixtures";
import { InMemoryPostStore } from "./InMemoryPostStore";

const THREAD = "thread-1";
const BOARD = "board-1";

describe("InMemoryPostStore", () => {
	it("test_getSnapshot_WithInitialPosts_ReturnsThosePosts", () => {
		const initial = makePost({ number: 1 });
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
		const post = makePost({ id: "p2", number: 2 });
		await store.save(post, THREAD, BOARD);
		const posts = store.getSnapshot(THREAD);
		expect(posts).toHaveLength(1);
		expect(posts[0]?.id).toBe("p2");
	});

	it("test_subscribe_AfterSave_CallsCallback", async () => {
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		store.subscribe(THREAD, cb);
		await store.save(makePost(), THREAD, BOARD);
		expect(cb).toHaveBeenCalledOnce();
	});

	it("test_subscribe_AfterUnsubscribe_DoesNotCallCallback", async () => {
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		const unsub = store.subscribe(THREAD, cb);
		unsub();
		await store.save(makePost(), THREAD, BOARD);
		expect(cb).not.toHaveBeenCalled();
	});

	it("test_save_DifferentThread_DoesNotNotifyOtherThread", async () => {
		const store = new InMemoryPostStore();
		const cb = vi.fn();
		store.subscribe("other-thread", cb);
		await store.save(makePost(), THREAD, BOARD);
		expect(cb).not.toHaveBeenCalled();
	});
});
