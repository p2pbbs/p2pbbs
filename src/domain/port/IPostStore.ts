import type { Post } from "../model/Post";

/**
 * 投稿ストアのポート。
 * useSyncExternalStore 互換のインターフェース + 永続化。
 */
export interface IPostStore {
	/** スナップショット（スレッド内の投稿一覧）を返す。 */
	getSnapshot(threadId: string): Post[];
	/** 投稿一覧の変更を購読する。戻り値はアンサブスクライブ関数。 */
	subscribe(threadId: string, callback: () => void): () => void;
	/** 投稿を保存する。 */
	save(post: Post, threadId: string, boardId: string): Promise<void>;
}
