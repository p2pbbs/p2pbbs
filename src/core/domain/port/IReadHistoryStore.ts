/**
 * 既読履歴ストアのポート。
 * スレ単位で「過去に表示したことのある post.id の集合」を保持・永続化する。
 * 未読判定（既読履歴に無い post.id）に使う。
 *
 * getSnapshot は常にメモリから同期で返す（useThreadList / usePostList が描画中に読む）。
 * markRead はメモリを同期更新してから永続化する（IPostStore.save と同方針）。
 */
export interface IReadHistoryStore {
	/** 指定スレの既読 post.id 集合を返す（同期・メモリから）。 */
	getSnapshot(threadId: string): ReadonlySet<string>;
	/** 指定スレで post.id 群を既読として記録する（メモリ + 永続化）。 */
	markRead(threadId: string, postIds: Iterable<string>): Promise<void>;
}
