import { useCallback, useEffect, useState } from "react";
import type { Thread } from "@/core/domain/model/Thread";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import type { IThreadStore } from "@/core/domain/port/IThreadStore";

/** スレ一覧の 1 行。Thread に投稿数と勢いを付与したもの。 */
export type ThreadListItem = {
	readonly thread: Thread;
	readonly postCount: number;
	/** 勢い（1 日あたりの投稿数）。降順に並べる。 */
	readonly momentum: number;
};

const MS_PER_DAY = 86_400_000;

function buildItems(
	threadStore: IThreadStore,
	postStore: IPostStore,
	boardId: string,
	now: number,
): ThreadListItem[] {
	// getByBoard は Thread エンティティを持つスレのみ返す。
	// digest だけ既知（エンティティ未着）のスレはここに現れず、一覧に出ない。
	return threadStore
		.getByBoard(boardId)
		.map((thread) => {
			const postCount = postStore.getSnapshot(thread.threadId).length;
			// createdAt が未来でも 0 除算しないよう経過時間を最低 1ms でガードする
			const ageMs = Math.max(1, now - thread.createdAt);
			const momentum = (postCount * MS_PER_DAY) / ageMs;
			return { thread, postCount, momentum };
		})
		.sort((a, b) => b.momentum - a.momentum);
}

/**
 * スレ一覧を pull モデルで読み取る hook。勢い順（降順）。
 * 板遷移時（boardId 変更時）に自動で読み込み、以降は refresh() で再読込する。
 * store の push 通知は購読しない（読んでいる途中で並び替わらないようにするため）。
 */
export function useThreadList(
	threadStore: IThreadStore,
	postStore: IPostStore,
	boardId: string,
): { items: ThreadListItem[]; refresh: () => void } {
	const [items, setItems] = useState<ThreadListItem[]>([]);

	const refresh = useCallback(() => {
		setItems(buildItems(threadStore, postStore, boardId, Date.now()));
	}, [threadStore, postStore, boardId]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return { items, refresh };
}
