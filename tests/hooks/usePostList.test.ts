import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { InMemoryPostStore } from "@/core/adapter/storage/InMemoryPostStore";
import { InMemoryReadHistoryStore } from "@/core/adapter/storage/InMemoryReadHistoryStore";
import { sortPosts, usePostList } from "@/ui/hooks/usePostList";
import { TEST_THREAD_ID } from "../helpers/constants";
import { makePost } from "../helpers/fixtures";

const THREAD = TEST_THREAD_ID;
// makePost のデフォルト publicKey ("pubkey-base64") とは別の値。
// これにより既存テストの投稿は「自分の投稿ではない」扱いになる。
const SELF_PK = "self-pubkey";

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

describe("usePostList", () => {
	// readHistory の identity が毎レンダーで変わると effect ループになるため、
	// 各テストでフックの外に固定したストアを渡す。

	it("test_usePostList_FirstVisit_AllUnreadPostsBadged", () => {
		// 初めて開いたスレは他人のレスが全て未読 → 全件に未読バッジ
		const store = new InMemoryPostStore(
			new Map([
				[
					THREAD,
					[
						makePost({ id: "p1", lamport: 1 }),
						makePost({ id: "p2", lamport: 2 }),
					],
				],
			]),
		);
		const readHistory = new InMemoryReadHistoryStore();
		const { result } = renderHook(() =>
			usePostList(store, THREAD, SELF_PK, readHistory),
		);
		expect(result.current.posts.map((p) => p.displayNumber)).toEqual([1, 2]);
		expect(result.current.posts.every((p) => p.isUnread)).toBe(true);
	});

	it("test_usePostList_WithoutRefresh_DoesNotAutoUpdateOnSave", async () => {
		const initial = makePost({ id: "p1", lamport: 1 });
		const store = new InMemoryPostStore(new Map([[THREAD, [initial]]]));
		const readHistory = new InMemoryReadHistoryStore();
		const { result } = renderHook(() =>
			usePostList(store, THREAD, SELF_PK, readHistory),
		);
		await act(async () => {
			await store.save(makePost({ id: "p2", lamport: 2 }));
		});
		// pull モデル: refresh を呼ぶまで反映されない
		expect(result.current.posts).toHaveLength(1);
	});

	it("test_usePostList_ReVisitNoArrivals_NoBadges", () => {
		// 一度見たスレを変化なしで開き直す → 既読なので未読なし
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p1", lamport: 1 })]]]),
		);
		const readHistory = new InMemoryReadHistoryStore();

		const first = renderHook(() =>
			usePostList(store, THREAD, SELF_PK, readHistory),
		);
		expect(first.result.current.posts[0]?.isUnread).toBe(true);
		first.unmount();

		const second = renderHook(() =>
			usePostList(store, THREAD, SELF_PK, readHistory),
		);
		expect(second.result.current.posts[0]?.isUnread).toBe(false);
	});

	it("test_usePostList_ReVisitWithArrivals_OnlyArrivedUnread", async () => {
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p1", lamport: 1 })]]]),
		);
		const readHistory = new InMemoryReadHistoryStore();

		// 初回入場: p1 を既読化
		const first = renderHook(() =>
			usePostList(store, THREAD, SELF_PK, readHistory),
		);
		expect(first.result.current.posts[0]?.isUnread).toBe(true);
		first.unmount();

		// 留守中に p2 が届く
		await act(async () => {
			await store.save(makePost({ id: "p2", lamport: 2 }));
		});

		// 再入場: 留守中に増えた p2 だけ未読
		const second = renderHook(() =>
			usePostList(store, THREAD, SELF_PK, readHistory),
		);
		expect(second.result.current.posts.map((p) => p.id)).toEqual(["p1", "p2"]);
		expect(
			second.result.current.posts.find((p) => p.id === "p1")?.isUnread,
		).toBe(false);
		expect(
			second.result.current.posts.find((p) => p.id === "p2")?.isUnread,
		).toBe(true);
	});

	it("test_usePostList_RefreshAfterSeeing_ClearsBadges", async () => {
		// 入場で未読が付いたあと、変化なしで更新を押すと未読は消える
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p1", lamport: 1 })]]]),
		);
		const readHistory = new InMemoryReadHistoryStore();
		const { result } = renderHook(() =>
			usePostList(store, THREAD, SELF_PK, readHistory),
		);
		expect(result.current.posts[0]?.isUnread).toBe(true);

		act(() => result.current.refresh());
		expect(result.current.posts[0]?.isUnread).toBe(false);
	});

	it("test_usePostList_RefreshDuringVisit_BadgesPostsArrivedSinceEntry", async () => {
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p1", lamport: 1 })]]]),
		);
		const readHistory = new InMemoryReadHistoryStore();

		// 初回入場で p1 を既読化し、離脱
		renderHook(() =>
			usePostList(store, THREAD, SELF_PK, readHistory),
		).unmount();

		// 再入場（p1 は既読なのでバッジなし）
		const { result } = renderHook(() =>
			usePostList(store, THREAD, SELF_PK, readHistory),
		);
		expect(result.current.posts.find((p) => p.id === "p1")?.isUnread).toBe(
			false,
		);

		// 訪問中に p2 が届き、refresh で取り込む → p2 だけ未読
		await act(async () => {
			await store.save(makePost({ id: "p2", lamport: 2 }));
		});
		act(() => result.current.refresh());
		expect(result.current.posts.find((p) => p.id === "p1")?.isUnread).toBe(
			false,
		);
		expect(result.current.posts.find((p) => p.id === "p2")?.isUnread).toBe(
			true,
		);
	});

	it("test_usePostList_ThreadNavigation_RefreezesBaselinePerThread", () => {
		const store = new InMemoryPostStore(
			new Map([
				[
					TEST_THREAD_ID,
					[makePost({ id: "a", threadId: TEST_THREAD_ID, lamport: 1 })],
				],
				["thread-2", [makePost({ id: "b", threadId: "thread-2", lamport: 1 })]],
			]),
		);
		const readHistory = new InMemoryReadHistoryStore();
		const { result, rerender } = renderHook(
			({ threadId }) => usePostList(store, threadId, SELF_PK, readHistory),
			{ initialProps: { threadId: TEST_THREAD_ID } },
		);
		// 初訪問の thread-1: a が未読
		expect(result.current.posts[0]?.isUnread).toBe(true);

		// 別スレ thread-2 へ: 初訪問なので b が未読
		rerender({ threadId: "thread-2" });
		expect(result.current.posts.map((p) => p.id)).toEqual(["b"]);
		expect(result.current.posts[0]?.isUnread).toBe(true);

		// thread-1 へ戻る: 既読なので a は未読でない（スレ単位で基準を取り直す）
		rerender({ threadId: TEST_THREAD_ID });
		expect(result.current.posts.map((p) => p.id)).toEqual(["a"]);
		expect(result.current.posts[0]?.isUnread).toBe(false);
	});

	it("test_usePostList_OwnPosts_AreNotMarkedNew", () => {
		// 自分（SELF_PK）の投稿は初訪問でも未読にしない
		const store = new InMemoryPostStore(
			new Map([
				[
					THREAD,
					[
						makePost({ id: "mine", lamport: 1, publicKey: SELF_PK }),
						makePost({ id: "theirs", lamport: 2, publicKey: "other-pk" }),
					],
				],
			]),
		);
		const readHistory = new InMemoryReadHistoryStore();
		const { result } = renderHook(() =>
			usePostList(store, THREAD, SELF_PK, readHistory),
		);
		expect(result.current.posts.find((p) => p.id === "mine")?.isUnread).toBe(
			false,
		);
		expect(result.current.posts.find((p) => p.id === "theirs")?.isUnread).toBe(
			true,
		);
	});

	it("test_usePostList_StrictModeDoubleMount_KeepsUnreadBadge", () => {
		// StrictMode は入場 effect を二度実行する。基準を threadId 単位で固定して
		// いないと、二度目の実行で既読が進み未読が消える。その回帰を固定する。
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p1", lamport: 1 })]]]),
		);
		const readHistory = new InMemoryReadHistoryStore();
		const { result } = renderHook(
			() => usePostList(store, THREAD, SELF_PK, readHistory),
			{
				wrapper: StrictMode,
			},
		);
		// 初訪問 + StrictMode 二重実行でも p1 は未読のまま
		expect(result.current.posts[0]?.isUnread).toBe(true);
	});
});
