import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InMemoryPostStore } from "@/core/adapter/storage/InMemoryPostStore";
import { sortPosts, usePosts } from "@/ui/hooks/usePosts";
import { makePost } from "../helpers/fixtures";

const THREAD = "thread-1";

describe("sortPosts", () => {
	it("test_sortPosts_ByLamport_AscendingOrder", () => {
		const posts = [
			makePost({ id: "b", lamport: 3 }),
			makePost({ id: "a", lamport: 1 }),
			makePost({ id: "c", lamport: 2 }),
		];
		const result = sortPosts(posts);
		expect(result.map((p) => p.lamport)).toEqual([1, 2, 3]);
	});

	it("test_sortPosts_AssignsDisplayNumberFromSortedIndex", () => {
		const posts = [
			makePost({ id: "b", lamport: 3 }),
			makePost({ id: "a", lamport: 1 }),
		];
		const result = sortPosts(posts);
		expect(result.map((p) => p.displayNumber)).toEqual([1, 2]);
	});

	it("test_sortPosts_DuplicateLamport_StableSortById", () => {
		const posts = [
			makePost({ id: "z", lamport: 1 }),
			makePost({ id: "a", lamport: 1 }),
			makePost({ id: "m", lamport: 1 }),
		];
		const result = sortPosts(posts);
		expect(result.map((p) => p.id)).toEqual(["a", "m", "z"]);
	});

	it("test_sortPosts_EmptyArray_ReturnsEmpty", () => {
		expect(sortPosts([])).toHaveLength(0);
	});

	it("test_sortPosts_DoesNotMutateOriginal", () => {
		const posts = [
			makePost({ id: "b", lamport: 2 }),
			makePost({ id: "a", lamport: 1 }),
		];
		const firstId = posts[0]?.id;
		sortPosts(posts);
		expect(posts[0]?.id).toBe(firstId);
	});
});

describe("usePosts", () => {
	it("test_usePosts_InitialRender_ReturnsInitialPost", () => {
		const initial = makePost({ lamport: 1 });
		const store = new InMemoryPostStore(new Map([[THREAD, [initial]]]));
		const { result } = renderHook(() => usePosts(store, THREAD));
		expect(result.current).toHaveLength(1);
		expect(result.current[0]?.displayNumber).toBe(1);
	});

	it("test_usePosts_AfterSave_ReturnsUpdatedPosts", async () => {
		const store = new InMemoryPostStore();
		const { result } = renderHook(() => usePosts(store, THREAD));
		await act(async () => {
			await store.save(makePost({ id: "p2", lamport: 2 }));
		});
		expect(result.current).toHaveLength(1);
	});

	it("test_usePosts_SaveOutOfLamportOrder_ReturnsSortedByLamport", async () => {
		const initial = makePost({ id: "p1", lamport: 1 });
		const store = new InMemoryPostStore(new Map([[THREAD, [initial]]]));
		const { result } = renderHook(() => usePosts(store, THREAD));
		await act(async () => {
			await store.save(makePost({ id: "p3", lamport: 3 }));
			await store.save(makePost({ id: "p2", lamport: 2 }));
		});
		expect(result.current.map((p) => p.lamport)).toEqual([1, 2, 3]);
		expect(result.current.map((p) => p.displayNumber)).toEqual([1, 2, 3]);
	});
});
