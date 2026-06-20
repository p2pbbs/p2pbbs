import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { InMemoryPostStore } from "@/core/adapter/storage/InMemoryPostStore";
import { useBoardUndisplayed, useUndisplayed } from "@/ui/hooks/useUndisplayed";
import { TEST_BOARD_ID, TEST_THREAD_ID } from "../helpers/constants";
import { makePost } from "../helpers/fixtures";

const THREAD = TEST_THREAD_ID;
const BOARD = TEST_BOARD_ID;

describe("useUndisplayed", () => {
	it("test_useUndisplayed_Initial_NotLit", () => {
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p1", lamport: 1 })]]]),
		);
		const { result } = renderHook(() => useUndisplayed(store, THREAD));
		expect(result.current.hasUndisplayed).toBe(false);
	});

	it("test_useUndisplayed_PostArrivesAfterEntry_Lights", async () => {
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p1", lamport: 1 })]]]),
		);
		const { result } = renderHook(() => useUndisplayed(store, THREAD));
		expect(result.current.hasUndisplayed).toBe(false);

		// 入場後に未反映レスがストアへ届く → 点灯
		await act(async () => {
			await store.save(makePost({ id: "p2", lamport: 2 }));
		});
		expect(result.current.hasUndisplayed).toBe(true);
	});

	it("test_useUndisplayed_Clear_TurnsNeutralAndRebaselines", async () => {
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p1", lamport: 1 })]]]),
		);
		const { result } = renderHook(() => useUndisplayed(store, THREAD));

		await act(async () => {
			await store.save(makePost({ id: "p2", lamport: 2 }));
		});
		expect(result.current.hasUndisplayed).toBe(true);

		// 更新（clear）で消灯し、baseline は現在件数へ更新される
		act(() => result.current.clear());
		expect(result.current.hasUndisplayed).toBe(false);

		// clear 後に届いた分だけが次の点灯対象になる
		await act(async () => {
			await store.save(makePost({ id: "p3", lamport: 3 }));
		});
		expect(result.current.hasUndisplayed).toBe(true);
	});

	it("test_useUndisplayed_DuplicateRedelivery_DoesNotLight", async () => {
		// 同一 post.id が再配信されても dedup 済み件数が増えないため点灯しない
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p1", lamport: 1 })]]]),
		);
		const { result } = renderHook(() => useUndisplayed(store, THREAD));

		await act(async () => {
			await store.save(makePost({ id: "p1", lamport: 1 }));
		});
		expect(result.current.hasUndisplayed).toBe(false);
	});

	it("test_useUndisplayed_LowLamportMiddleInsert_Lights", async () => {
		// 低 lamport のレスが後から中間挿入されても件数増で検知する
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p2", lamport: 5 })]]]),
		);
		const { result } = renderHook(() => useUndisplayed(store, THREAD));

		await act(async () => {
			await store.save(makePost({ id: "p1", lamport: 1 }));
		});
		expect(result.current.hasUndisplayed).toBe(true);
	});

	it("test_useUndisplayed_ThreadNavigation_ResetsToNeutral", async () => {
		const store = new InMemoryPostStore(
			new Map([
				[THREAD, [makePost({ id: "a", threadId: THREAD, lamport: 1 })]],
				["thread-2", [makePost({ id: "b", threadId: "thread-2", lamport: 1 })]],
			]),
		);
		const { result, rerender } = renderHook(
			({ threadId }) => useUndisplayed(store, threadId),
			{ initialProps: { threadId: THREAD } },
		);

		// thread-1 で点灯させる
		await act(async () => {
			await store.save(makePost({ id: "a2", threadId: THREAD, lamport: 2 }));
		});
		expect(result.current.hasUndisplayed).toBe(true);

		// 別スレへ遷移 → neutral に戻る
		rerender({ threadId: "thread-2" });
		expect(result.current.hasUndisplayed).toBe(false);
	});

	it("test_useUndisplayed_OtherThreadSave_DoesNotLight", async () => {
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p1", lamport: 1 })]]]),
		);
		const { result } = renderHook(() => useUndisplayed(store, THREAD));

		// 別スレへの save では発火しない（threadId 単位で購読を分離）
		await act(async () => {
			await store.save(
				makePost({ id: "other", threadId: "thread-2", lamport: 1 }),
			);
		});
		expect(result.current.hasUndisplayed).toBe(false);
	});

	it("test_useUndisplayed_StrictModeDoubleMount_KeepsBaseline", async () => {
		// StrictMode の effect 二重実行でも baseline は threadId 単位 ref で固定され、
		// 入場後に届いた分は正しく点灯する
		const store = new InMemoryPostStore(
			new Map([[THREAD, [makePost({ id: "p1", lamport: 1 })]]]),
		);
		const { result } = renderHook(() => useUndisplayed(store, THREAD), {
			wrapper: StrictMode,
		});
		expect(result.current.hasUndisplayed).toBe(false);

		await act(async () => {
			await store.save(makePost({ id: "p2", lamport: 2 }));
		});
		expect(result.current.hasUndisplayed).toBe(true);
	});

	it("test_useUndisplayed_EmptyThread_DoesNotThrow", () => {
		const store = new InMemoryPostStore();
		const { result } = renderHook(() => useUndisplayed(store, THREAD));
		expect(result.current.hasUndisplayed).toBe(false);
	});
});

describe("useBoardUndisplayed", () => {
	it("test_useBoardUndisplayed_Initial_NotLit", () => {
		const store = new InMemoryPostStore();
		const { result } = renderHook(() => useBoardUndisplayed(store, BOARD));
		expect(result.current.hasUndisplayed).toBe(false);
	});

	it("test_useBoardUndisplayed_NewPostInBoard_Lights", async () => {
		const store = new InMemoryPostStore();
		const { result } = renderHook(() => useBoardUndisplayed(store, BOARD));

		await act(async () => {
			await store.save(
				makePost({ id: "p1", boardId: BOARD, threadId: "thread-a" }),
			);
		});
		expect(result.current.hasUndisplayed).toBe(true);
	});

	it("test_useBoardUndisplayed_NewThreadInBoard_Lights", async () => {
		// 新スレの >>1 も board への save なので点灯する
		const store = new InMemoryPostStore(
			new Map([
				[
					"thread-a",
					[makePost({ id: "p1", boardId: BOARD, threadId: "thread-a" })],
				],
			]),
		);
		const { result } = renderHook(() => useBoardUndisplayed(store, BOARD));
		expect(result.current.hasUndisplayed).toBe(false);

		await act(async () => {
			await store.save(
				makePost({ id: "n1", boardId: BOARD, threadId: "new-thread" }),
			);
		});
		expect(result.current.hasUndisplayed).toBe(true);
	});

	it("test_useBoardUndisplayed_DuplicateRedelivery_DoesNotLight", async () => {
		const store = new InMemoryPostStore(
			new Map([
				[
					"thread-a",
					[makePost({ id: "p1", boardId: BOARD, threadId: "thread-a" })],
				],
			]),
		);
		const { result } = renderHook(() => useBoardUndisplayed(store, BOARD));

		await act(async () => {
			await store.save(
				makePost({ id: "p1", boardId: BOARD, threadId: "thread-a" }),
			);
		});
		expect(result.current.hasUndisplayed).toBe(false);
	});

	it("test_useBoardUndisplayed_Clear_TurnsNeutralAndRebaselines", async () => {
		const store = new InMemoryPostStore();
		const { result } = renderHook(() => useBoardUndisplayed(store, BOARD));

		await act(async () => {
			await store.save(makePost({ id: "p1", boardId: BOARD }));
		});
		expect(result.current.hasUndisplayed).toBe(true);

		act(() => result.current.clear());
		expect(result.current.hasUndisplayed).toBe(false);

		await act(async () => {
			await store.save(
				makePost({ id: "p2", boardId: BOARD, threadId: "thread-b" }),
			);
		});
		expect(result.current.hasUndisplayed).toBe(true);
	});

	it("test_useBoardUndisplayed_OtherBoardSave_DoesNotLight", async () => {
		const store = new InMemoryPostStore();
		const { result } = renderHook(() => useBoardUndisplayed(store, BOARD));

		await act(async () => {
			await store.save(
				makePost({ id: "x", boardId: "board-2", threadId: "t-x" }),
			);
		});
		expect(result.current.hasUndisplayed).toBe(false);
	});

	it("test_useBoardUndisplayed_BoardNavigation_ResetsToNeutral", async () => {
		const store = new InMemoryPostStore();
		const { result, rerender } = renderHook(
			({ boardId }) => useBoardUndisplayed(store, boardId),
			{ initialProps: { boardId: BOARD } },
		);

		await act(async () => {
			await store.save(makePost({ id: "p1", boardId: BOARD }));
		});
		expect(result.current.hasUndisplayed).toBe(true);

		// 別板へ遷移 → baseline を取り直して neutral へ戻る
		rerender({ boardId: "board-2" });
		expect(result.current.hasUndisplayed).toBe(false);
	});

	it("test_useBoardUndisplayed_StrictModeDoubleMount_KeepsBaseline", async () => {
		const store = new InMemoryPostStore();
		const { result } = renderHook(() => useBoardUndisplayed(store, BOARD), {
			wrapper: StrictMode,
		});
		expect(result.current.hasUndisplayed).toBe(false);

		await act(async () => {
			await store.save(makePost({ id: "p1", boardId: BOARD }));
		});
		expect(result.current.hasUndisplayed).toBe(true);
	});
});
