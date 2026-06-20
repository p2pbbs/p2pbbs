import type { Post } from "@/core/domain/model/Post";
import type { IPostStore } from "@/core/domain/port/IPostStore";

export class InMemoryPostStore implements IPostStore {
	private static readonly EMPTY: Post[] = [];

	private readonly posts: Map<string, Post[]>;
	private readonly boardThreadIds = new Map<string, Set<string>>();
	private readonly listeners = new Map<string, Set<() => void>>();
	// 板単位の変更検知（未反映バッジ用）。新規 save のたびに revision を ++ する。
	private readonly boardRevisions = new Map<string, number>();
	private readonly boardListeners = new Map<string, Set<() => void>>();

	constructor(initial: Map<string, Post[]> = new Map()) {
		this.posts = new Map(initial);
		for (const [threadId, threadPosts] of initial) {
			for (const post of threadPosts) {
				this.trackBoardThread(post.boardId, threadId);
			}
		}
	}

	getSnapshot(threadId: string): Post[] {
		return this.posts.get(threadId) ?? InMemoryPostStore.EMPTY;
	}

	getThreadIds(boardId: string): string[] {
		return [...(this.boardThreadIds.get(boardId) ?? [])];
	}

	subscribe(threadId: string, callback: () => void): () => void {
		let set = this.listeners.get(threadId);
		if (set === undefined) {
			set = new Set();
			this.listeners.set(threadId, set);
		}
		set.add(callback);
		return () => {
			this.listeners.get(threadId)?.delete(callback);
		};
	}

	subscribeBoard(boardId: string, callback: () => void): () => void {
		let set = this.boardListeners.get(boardId);
		if (set === undefined) {
			set = new Set();
			this.boardListeners.set(boardId, set);
		}
		set.add(callback);
		return () => {
			this.boardListeners.get(boardId)?.delete(callback);
		};
	}

	getBoardRevision(boardId: string): number {
		return this.boardRevisions.get(boardId) ?? 0;
	}

	async save(post: Post): Promise<void> {
		const { threadId } = post;
		const current = this.posts.get(threadId) ?? [];
		// 同一 post.id（コンテンツハッシュ）が既に存在する場合は保存しない（冪等性）
		if (current.some((p) => p.id === post.id)) return;
		this.posts.set(threadId, [...current, post]);
		this.trackBoardThread(post.boardId, threadId);
		for (const cb of this.listeners.get(threadId) ?? []) {
			cb();
		}
		// dedup early-return の後でのみ revision を ++ する。これにより再配信では
		// revision が増えず、板の未反映バッジが誤点灯しない。
		this.boardRevisions.set(
			post.boardId,
			this.getBoardRevision(post.boardId) + 1,
		);
		for (const cb of this.boardListeners.get(post.boardId) ?? []) {
			cb();
		}
	}

	private trackBoardThread(boardId: string, threadId: string): void {
		let set = this.boardThreadIds.get(boardId);
		if (!set) {
			set = new Set();
			this.boardThreadIds.set(boardId, set);
		}
		set.add(threadId);
	}
}
