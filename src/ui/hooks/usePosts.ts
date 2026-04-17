import { useSyncExternalStore } from "react";
import type { Post } from "@/core/domain/model/Post";
import type { IPostStore } from "@/core/domain/port/IPostStore";

/** 表示用の連番を付与した Post。lamport ソート後のインデックスから派生する。 */
export type DisplayPost = Post & { readonly displayNumber: number };

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

export function usePosts(store: IPostStore, threadId: string): DisplayPost[] {
	const posts = useSyncExternalStore(
		(callback) => store.subscribe(threadId, callback),
		() => store.getSnapshot(threadId),
	);
	return sortPosts(posts);
}
