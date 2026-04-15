import { useSyncExternalStore } from "react";
import type { Post } from "@/domain/model/Post";
import type { IPostStore } from "@/domain/port/IPostStore";

export function sortPosts(posts: Post[]): Post[] {
	return [...posts].sort((a, b) => {
		if (a.number !== b.number) return a.number - b.number;
		if (a.id < b.id) return -1;
		if (a.id > b.id) return 1;
		return 0;
	});
}

export function usePosts(store: IPostStore, threadId: string): Post[] {
	const posts = useSyncExternalStore(
		(callback) => store.subscribe(threadId, callback),
		() => store.getSnapshot(threadId),
	);
	return sortPosts(posts);
}
