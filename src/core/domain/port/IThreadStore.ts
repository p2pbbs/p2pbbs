import type { Thread } from "../model/Thread";

/**
 * スレストアのポート。
 * 板単位の Thread 一覧管理と変更通知を担う。
 */
export interface IThreadStore {
	/** スレを保存する。threadId が重複する場合は先着が勝ち、後着は無視される。 */
	save(thread: Thread): Promise<void>;
	/** 指定板のスレ一覧を返す。createdAt 昇順。 */
	getByBoard(boardId: string): Thread[];
	/** 指定 threadId のスレを返す。存在しない場合は undefined。 */
	get(threadId: string): Thread | undefined;
	/** 指定 threadId のスレが存在するか確認する。 */
	has(threadId: string): boolean;
	/** 指定 threadId のスレを削除する。FIFO evict で使用する。 */
	delete(threadId: string): Promise<void>;
	/** 指定板のスレ一覧変更を購読する。戻り値はアンサブスクライブ関数。 */
	subscribe(boardId: string, callback: () => void): () => void;
}
