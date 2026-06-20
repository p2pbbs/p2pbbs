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
	/** 投稿を保存する。保存先は post.threadId で決定する。 */
	save(post: Post): Promise<void>;
	/** 指定板に投稿が存在するスレッド ID の一覧を返す。 */
	getThreadIds(boardId: string): string[];
	/** 板単位の変更通知。board 内のどのスレへの新規 save でも発火する。 */
	subscribeBoard(boardId: string, callback: () => void): () => void;
	/** 板の単調増加リビジョン。board 内へ新規 save するたびに +1。比較用スナップショット。 */
	getBoardRevision(boardId: string): number;
}
