import { ThreadView } from "@/components/thread/ThreadView";
import { DEFAULT_THREAD_ID, DEFAULT_THREAD_TITLE } from "@/config/constants";
import type { IPostStore } from "@/domain/port/IPostStore";
import { usePosts } from "@/hooks/usePosts";

type Props = {
	store: IPostStore;
};

export function BoardPage({ store }: Props) {
	const posts = usePosts(store, DEFAULT_THREAD_ID);
	return <ThreadView title={DEFAULT_THREAD_TITLE} posts={posts} />;
}
