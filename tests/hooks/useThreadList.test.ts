import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InMemoryPostStore } from "@/core/adapter/storage/InMemoryPostStore";
import { useThreadList } from "@/ui/hooks/useThreadList";
import { TEST_BOARD_ID, TEST_BOARD_ID_ALT } from "../helpers/constants";
import { makePost, makeThread, makeThreadStore } from "../helpers/fixtures";

const DAY = 86_400_000;

describe("useThreadList", () => {
	it("test_useThreadList_SortsByMomentumDescending", () => {
		const now = Date.now();
		const slow = makeThread({
			threadId: "slow",
			boardId: TEST_BOARD_ID,
			createdAt: now - 10 * DAY,
		});
		const hot = makeThread({
			threadId: "hot",
			boardId: TEST_BOARD_ID,
			createdAt: now - 1 * DAY,
		});
		const threadStore = makeThreadStore([slow, hot]);
		const postStore = new InMemoryPostStore(
			new Map([
				["slow", [makePost({ id: "s1", threadId: "slow", lamport: 1 })]],
				[
					"hot",
					[
						makePost({ id: "h1", threadId: "hot", lamport: 1 }),
						makePost({ id: "h2", threadId: "hot", lamport: 2 }),
						makePost({ id: "h3", threadId: "hot", lamport: 3 }),
					],
				],
			]),
		);

		const { result } = renderHook(() =>
			useThreadList(threadStore, postStore, TEST_BOARD_ID),
		);

		expect(result.current.items.map((i) => i.thread.threadId)).toEqual([
			"hot",
			"slow",
		]);
		expect(result.current.items[0]?.postCount).toBe(3);
	});

	it("test_useThreadList_OnlyReturnsThreadsForGivenBoard", () => {
		const threadStore = makeThreadStore([
			makeThread({ threadId: "m1", boardId: TEST_BOARD_ID }),
			makeThread({ threadId: "y1", boardId: TEST_BOARD_ID_ALT }),
		]);
		const postStore = new InMemoryPostStore();
		const { result } = renderHook(() =>
			useThreadList(threadStore, postStore, TEST_BOARD_ID),
		);
		expect(result.current.items.map((i) => i.thread.threadId)).toEqual(["m1"]);
	});

	it("test_useThreadList_FutureCreatedAt_DoesNotDivideByZero", () => {
		const threadStore = makeThreadStore([
			makeThread({
				threadId: "future",
				boardId: TEST_BOARD_ID,
				createdAt: Date.now() + DAY,
			}),
		]);
		const postStore = new InMemoryPostStore(
			new Map([
				["future", [makePost({ id: "f1", threadId: "future", lamport: 1 })]],
			]),
		);
		const { result } = renderHook(() =>
			useThreadList(threadStore, postStore, TEST_BOARD_ID),
		);
		expect(result.current.items[0]?.momentum).toBeTypeOf("number");
		expect(Number.isFinite(result.current.items[0]?.momentum)).toBe(true);
	});

	it("test_useThreadList_WithoutRefresh_DoesNotAutoUpdate", async () => {
		const threadStore = makeThreadStore([
			makeThread({ threadId: "t1", boardId: TEST_BOARD_ID }),
		]);
		const postStore = new InMemoryPostStore();
		const { result } = renderHook(() =>
			useThreadList(threadStore, postStore, TEST_BOARD_ID),
		);
		expect(result.current.items[0]?.postCount).toBe(0);

		await act(async () => {
			await postStore.save(
				makePost({ id: "t1p1", threadId: "t1", lamport: 1 }),
			);
		});
		// pull モデル: refresh まで反映されない
		expect(result.current.items[0]?.postCount).toBe(0);

		act(() => result.current.refresh());
		expect(result.current.items[0]?.postCount).toBe(1);
	});
});
