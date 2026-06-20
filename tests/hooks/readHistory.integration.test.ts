import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InMemoryPostStore } from "@/core/adapter/storage/InMemoryPostStore";
import { InMemoryReadHistoryStore } from "@/core/adapter/storage/InMemoryReadHistoryStore";
import { usePostList } from "@/ui/hooks/usePostList";
import { useThreadList } from "@/ui/hooks/useThreadList";
import { TEST_BOARD_ID } from "../helpers/constants";
import { makePost, makeThread, makeThreadStore } from "../helpers/fixtures";

const SELF_PK = "self-pubkey";

/**
 * usePostList（既読化）と useThreadList（未読集計）は同一の ReadHistory ストアを
 * 共有する。スレを開いて閲覧すると既読が進み、一覧に戻ると当該スレの未読が減る、
 * という 2 フック間の連携を通しで固定する。
 */
describe("ReadHistory — usePostList と useThreadList の共有挙動", () => {
	it("test_readHistory_OpenThreadThenReturnToList_UnreadBecomesZero", () => {
		const threadStore = makeThreadStore([
			makeThread({ threadId: "t1", boardId: TEST_BOARD_ID }),
		]);
		const postStore = new InMemoryPostStore(
			new Map([
				[
					"t1",
					[
						makePost({ id: "p1", threadId: "t1", lamport: 1 }),
						makePost({ id: "p2", threadId: "t1", lamport: 2 }),
					],
				],
			]),
		);
		// 2 フックで共有する単一インスタンス（Session が配るものに相当）
		const readHistory = new InMemoryReadHistoryStore();

		// 一覧（未訪問）: 他人のレス 2 件が未読
		const list1 = renderHook(() =>
			useThreadList(
				threadStore,
				postStore,
				readHistory,
				TEST_BOARD_ID,
				SELF_PK,
			),
		);
		expect(list1.result.current.items[0]?.unreadCount).toBe(2);
		list1.unmount();

		// スレを開いて表示 → p1 / p2 が既読化される
		renderHook(() =>
			usePostList(postStore, "t1", SELF_PK, readHistory),
		).unmount();

		// 一覧に戻る（再マウント）→ 同じ readHistory を参照するので未読 0
		const list2 = renderHook(() =>
			useThreadList(
				threadStore,
				postStore,
				readHistory,
				TEST_BOARD_ID,
				SELF_PK,
			),
		);
		expect(list2.result.current.items[0]?.unreadCount).toBe(0);
	});
});
