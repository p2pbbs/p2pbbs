import { vi } from "vitest";
import type { GossipMessage } from "../../src/core/domain/model/GossipMessage";
import type { Post } from "../../src/core/domain/model/Post";
import type { Thread } from "../../src/core/domain/model/Thread";
import type { IThreadStore } from "../../src/core/domain/port/IThreadStore";
import type { DisplayPost } from "../../src/ui/hooks/usePostList";
import {
	TEST_BOARD_ID,
	TEST_THREAD_CREATED_AT,
	TEST_THREAD_ID,
	TEST_THREAD_TITLE,
} from "./constants";

export function makePost(overrides: Partial<Post> = {}): Post {
	return {
		id: "hash-abc123",
		name: "名無しさん",
		body: "テスト本文",
		odId: "abcd1234",
		timestamp: 1_700_000_000_000,
		lamport: 1,
		signature: "valid-sig",
		publicKey: "pubkey-base64",
		boardId: TEST_BOARD_ID,
		threadId: TEST_THREAD_ID,
		...overrides,
	};
}

export function makeDisplayPost(
	overrides: Partial<Post & { displayNumber: number }> = {},
): DisplayPost {
	const { displayNumber = 1, ...postOverrides } = overrides;
	return { ...makePost(postOverrides), displayNumber };
}

export function makeThread(overrides: Partial<Thread> = {}): Thread {
	return {
		threadId: TEST_THREAD_ID,
		boardId: TEST_BOARD_ID,
		title: TEST_THREAD_TITLE,
		createdAt: TEST_THREAD_CREATED_AT,
		signature: "valid-sig",
		publicKey: "pubkey-base64",
		...overrides,
	};
}

/**
 * IThreadStore のインメモリ模擬。先着勝ちの save、createdAt 昇順の getByBoard を持つ。
 * 各メソッドは vi.fn() なので呼び出し検証もできる。
 */
export function makeThreadStore(initial: Thread[] = []): IThreadStore {
	const threads = new Map(initial.map((t) => [t.threadId, t]));
	return {
		save: vi.fn(async (t: Thread) => {
			if (!threads.has(t.threadId)) threads.set(t.threadId, t);
		}),
		getByBoard: vi.fn((boardId: string) =>
			[...threads.values()]
				.filter((t) => t.boardId === boardId)
				.sort((a, b) => a.createdAt - b.createdAt),
		),
		get: vi.fn((id: string) => threads.get(id)),
		has: vi.fn((id: string) => threads.has(id)),
		delete: vi.fn(async (id: string) => {
			threads.delete(id);
		}),
		subscribe: vi.fn().mockReturnValue(() => {}),
	};
}

/** flip() で canPost を false→true へ遷移させ購読者へ通知できる digest 模擬。 */
export type ControllableDigest = {
	canPost: () => boolean;
	subscribe: (cb: () => void) => () => void;
	/** canPost を true にして購読者へ通知する。初回 sync 完了を再現する。 */
	flip: () => void;
};

/**
 * ExchangeDigestUseCase の最小模擬。canPost を後から flip でき、初回 sync 完了
 * （canPost: false→true）の到着順をテストで再現する。useCanPost の useSyncExternalStore
 * と同形の subscribe/canPost を持つ。
 */
export function makeControllableDigest(
	initialCanPost: boolean,
): ControllableDigest {
	let postable = initialCanPost;
	const subs = new Set<() => void>();
	return {
		canPost: () => postable,
		subscribe: (cb) => {
			subs.add(cb);
			return () => subs.delete(cb);
		},
		flip() {
			postable = true;
			for (const cb of subs) cb();
		},
	};
}

type PostGossipMessage = Extract<GossipMessage, { type: "post" }>;

export function makeGossipMessage(
	overrides: Partial<Omit<PostGossipMessage, "type">> = {},
): GossipMessage {
	return {
		type: "post",
		post: overrides.post ?? makePost(),
		ttl: overrides.ttl ?? 3,
		path: overrides.path ?? ["peer-origin"],
	};
}

type ThreadCreatedMessage = Extract<GossipMessage, { type: "thread_created" }>;

/**
 * thread_created エンベロープ。デフォルトでは thread と post の threadId が一致する。
 */
export function makeThreadCreatedMessage(
	overrides: Partial<Omit<ThreadCreatedMessage, "type">> = {},
): GossipMessage {
	const thread = overrides.thread ?? makeThread();
	const post =
		overrides.post ??
		makePost({
			boardId: thread.boardId,
			threadId: thread.threadId,
			lamport: 1,
		});
	return {
		type: "thread_created",
		thread,
		post,
		ttl: overrides.ttl ?? 3,
		path: overrides.path ?? ["peer-origin"],
	};
}
