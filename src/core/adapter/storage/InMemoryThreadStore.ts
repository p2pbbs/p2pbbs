import type { Thread } from "@/core/domain/model/Thread";
import type { IThreadStore } from "@/core/domain/port/IThreadStore";

export class InMemoryThreadStore implements IThreadStore {
	/** threadId → Thread */
	private readonly threads = new Map<string, Thread>();
	/** boardId → threadId[] (createdAt 昇順を保証するため挿入順を管理) */
	private readonly boardThreadIds = new Map<string, string[]>();
	/** boardId → Set<callback> */
	private readonly listeners = new Map<string, Set<() => void>>();

	async save(thread: Thread): Promise<void> {
		// 先着が勝ち。重複 threadId は無視する
		if (this.threads.has(thread.threadId)) return;
		this.threads.set(thread.threadId, thread);

		const ids = this.boardThreadIds.get(thread.boardId) ?? [];
		this.boardThreadIds.set(thread.boardId, [...ids, thread.threadId]);

		for (const cb of this.listeners.get(thread.boardId) ?? []) {
			cb();
		}
	}

	getByBoard(boardId: string): Thread[] {
		const ids = this.boardThreadIds.get(boardId) ?? [];
		const result: Thread[] = [];
		for (const id of ids) {
			const t = this.threads.get(id);
			if (t) result.push(t);
		}
		return result.sort((a, b) => a.createdAt - b.createdAt);
	}

	get(threadId: string): Thread | undefined {
		return this.threads.get(threadId);
	}

	has(threadId: string): boolean {
		return this.threads.has(threadId);
	}

	async delete(threadId: string): Promise<void> {
		const thread = this.threads.get(threadId);
		if (!thread) return;
		this.threads.delete(threadId);

		const ids = this.boardThreadIds.get(thread.boardId) ?? [];
		this.boardThreadIds.set(
			thread.boardId,
			ids.filter((id) => id !== threadId),
		);

		for (const cb of this.listeners.get(thread.boardId) ?? []) {
			cb();
		}
	}

	subscribe(boardId: string, callback: () => void): () => void {
		let set = this.listeners.get(boardId);
		if (!set) {
			set = new Set();
			this.listeners.set(boardId, set);
		}
		set.add(callback);
		return () => {
			this.listeners.get(boardId)?.delete(callback);
		};
	}
}
