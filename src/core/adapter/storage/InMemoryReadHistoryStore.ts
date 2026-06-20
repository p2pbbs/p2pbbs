import type { IReadHistoryStore } from "@/core/domain/port/IReadHistoryStore";

/**
 * 既読履歴のインメモリ実装。テスト用、および IndexedDB 実装の裏側として使う。
 * getSnapshot は同期で既読集合を返す。markRead は同期でメモリを更新する。
 */
export class InMemoryReadHistoryStore implements IReadHistoryStore {
	private static readonly EMPTY: ReadonlySet<string> = new Set();

	/** threadId → 既読 post.id 集合 */
	private readonly histories = new Map<string, Set<string>>();

	constructor(initial: Map<string, Iterable<string>> = new Map()) {
		for (const [threadId, ids] of initial) {
			this.histories.set(threadId, new Set(ids));
		}
	}

	getSnapshot(threadId: string): ReadonlySet<string> {
		return this.histories.get(threadId) ?? InMemoryReadHistoryStore.EMPTY;
	}

	async markRead(threadId: string, postIds: Iterable<string>): Promise<void> {
		let set = this.histories.get(threadId);
		if (set === undefined) {
			set = new Set();
			this.histories.set(threadId, set);
		}
		for (const id of postIds) set.add(id);
	}
}
