import { useCallback, useEffect, useRef, useState } from "react";
import type { Post } from "@/core/domain/model/Post";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import type { IReadHistoryStore } from "@/core/domain/port/IReadHistoryStore";

/** 表示用の連番を付与した Post。lamport ソート後のインデックスから派生する。 */
export type DisplayPost = Post & { readonly displayNumber: number };

/** 表示用 Post に「まだ読んでいない未読か」を付与したもの。 */
export type ListedPost = DisplayPost & { readonly isUnread: boolean };

export function sortPosts(posts: Post[]): DisplayPost[] {
	return [...posts]
		.sort((a, b) => {
			if (a.lamport !== b.lamport) return a.lamport - b.lamport;
			if (a.id < b.id) return -1;
			if (a.id > b.id) return 1;
			return 0;
		})
		.map((post, i) => ({ ...post, displayNumber: i + 1 }));
}

/**
 * 今回の訪問を始めた時点の既読集合を固定して返す。
 * 同一スレ内の再レンダー（StrictMode の二重実行・refresh）では取り直さず、
 * スレ遷移（threadId 変化）でのみ取り直す。これにより入場時に付いた未読マーカーが
 * 二重実行や再レンダーで消えない。
 */
function useAlreadyRead(
	threadId: string,
	readHistory: IReadHistoryStore,
): Set<string> {
	const ref = useRef<{ threadId: string; base: Set<string> } | null>(null);
	if (ref.current === null || ref.current.threadId !== threadId) {
		ref.current = {
			threadId,
			base: new Set(readHistory.getSnapshot(threadId)),
		};
	}
	return ref.current.base;
}

/**
 * レス一覧を pull モデルで読み取る hook。
 * スレ遷移時（threadId 変更時）に自動でスナップショットを読み込み、
 * 以降は refresh() で明示的に再読込する。store の push 通知は購読しない。
 *
 * 未読マーカー = まだ読んでいない（既読履歴に無い）レス。スレを初めて開いた時は
 * 全レスが未読なので全てに付き、再訪問時は留守中に増えたレスにだけ付く。
 * 更新（refresh）すると、そこまでに表示したレスは既読になり未読マーカーが消える。
 *
 * 自分（selfPublicKey 一致）の投稿は未読にしない。自分で書いたものは未読では
 * ないため。
 *
 * @param selfPublicKey このノードの公開鍵。自分の投稿を未読判定から除外する。
 * @param readHistory 既読履歴ストア。Session 経由でセッション全体で共有する単一
 *                    インスタンスを渡す。テストでは独自インスタンスを渡して分離する。
 */
export function usePostList(
	store: IPostStore,
	threadId: string,
	selfPublicKey: string,
	readHistory: IReadHistoryStore,
): { posts: ListedPost[]; refresh: () => void } {
	const [posts, setPosts] = useState<ListedPost[]>([]);
	// 訪問開始時点の既読集合。入場時の未読判定に使う。
	const entryAlreadyRead = useAlreadyRead(threadId, readHistory);

	const render = useCallback(
		(isRefresh: boolean) => {
			const sorted = sortPosts(store.getSnapshot(threadId));

			// 未読判定の基準となる既読集合。
			// 入場時: 訪問開始時点の既読履歴（前回入場以降の未読をマークする。
			//         固定済みなので StrictMode の effect 二重実行でも消えない）。
			// 更新時: 現時点の既読履歴すべて（一度見たレスの未読を消し、未読のみ残す）。
			const alreadyRead = isRefresh
				? readHistory.getSnapshot(threadId)
				: entryAlreadyRead;

			const listed = sorted.map((post) => ({
				...post,
				// 自分の投稿は未読にしない
				isUnread: !alreadyRead.has(post.id) && post.publicKey !== selfPublicKey,
			}));

			// 表示した投稿を既読履歴に記録する（次回入場時・更新時の未読判定に使われる）。
			// メモリは markRead 内で同期更新されるため、直後の getSnapshot に即反映される。
			// 永続化（IndexedDB）の失敗は未読表示には影響しないので握りつぶす。これを
			// 付けないと書き込み reject が unhandled rejection になる。
			readHistory
				.markRead(
					threadId,
					sorted.map((post) => post.id),
				)
				.catch(() => {});

			setPosts(listed);
		},
		[store, threadId, selfPublicKey, readHistory, entryAlreadyRead],
	);

	// スレ遷移時に最新を読み込む（基準は据え置く）
	useEffect(() => {
		render(false);
	}, [render]);

	// 更新: ここまで表示済みのレスを既読にして再読込する（見たレスの未読は消える）
	const refresh = useCallback(() => render(true), [render]);

	return { posts, refresh };
}
