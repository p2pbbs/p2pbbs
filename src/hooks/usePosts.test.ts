import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InMemoryPostStore } from "@/adapter/storage/InMemoryPostStore";
import { makePost } from "../../tests/helpers/fixtures";
import { sortPosts, usePosts } from "./usePosts";

const THREAD = "thread-1";
const BOARD = "board-1";

describe("sortPosts", () => {
	it("test_sortPosts_ByNumber_AscendingOrder", () => {
		const posts = [
			makePost({ id: "b", number: 3 }),
			makePost({ id: "a", number: 1 }),
			makePost({ id: "c", number: 2 }),
		];
		const result = sortPosts(posts);
		expect(result.map((p) => p.number)).toEqual([1, 2, 3]);
	});

	it("test_sortPosts_DuplicateNumber_StableSortById", () => {
		const posts = [
			makePost({ id: "z", number: 1 }),
			makePost({ id: "a", number: 1 }),
			makePost({ id: "m", number: 1 }),
		];
		const result = sortPosts(posts);
		expect(result.map((p) => p.id)).toEqual(["a", "m", "z"]);
	});

	it("test_sortPosts_EmptyArray_ReturnsEmpty", () => {
		expect(sortPosts([])).toHaveLength(0);
	});

	it("test_sortPosts_DoesNotMutateOriginal", () => {
		const posts = [
			makePost({ id: "b", number: 2 }),
			makePost({ id: "a", number: 1 }),
		];
		const original = [...posts];
		sortPosts(posts);
		expect(posts[0]?.id).toBe(original[0]?.id);
	});
});

describe("usePosts", () => {
	it("test_usePosts_InitialRender_ReturnsInitialPost", () => {
		const initial = makePost({ number: 1 });
		const store = new InMemoryPostStore(new Map([[THREAD, [initial]]]));
		const { result } = renderHook(() => usePosts(store, THREAD));
		expect(result.current).toHaveLength(1);
		expect(result.current[0]?.number).toBe(1);
	});

	it("test_usePosts_AfterSave_ReturnsUpdatedPosts", async () => {
		const store = new InMemoryPostStore();
		const { result } = renderHook(() => usePosts(store, THREAD));
		await act(async () => {
			await store.save(makePost({ id: "p2", number: 2 }), THREAD, BOARD);
		});
		expect(result.current).toHaveLength(1);
	});

	it("test_usePosts_SaveOutOfOrder_ReturnsSortedByNumber", async () => {
		const initial = makePost({ id: "p1", number: 1 });
		const store = new InMemoryPostStore(new Map([[THREAD, [initial]]]));
		const { result } = renderHook(() => usePosts(store, THREAD));
		await act(async () => {
			await store.save(makePost({ id: "p3", number: 3 }), THREAD, BOARD);
			await store.save(makePost({ id: "p2", number: 2 }), THREAD, BOARD);
		});
		expect(result.current.map((p) => p.number)).toEqual([1, 2, 3]);
	});
});
