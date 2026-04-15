import type { GossipMessage } from "../../src/domain/model/GossipMessage";
import type { Post } from "../../src/domain/model/Post";
import type { DisplayPost } from "../../src/hooks/usePosts";

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
		boardId: "board-1",
		threadId: "thread-1",
		...overrides,
	};
}

export function makeDisplayPost(
	overrides: Partial<Post & { displayNumber: number }> = {},
): DisplayPost {
	const { displayNumber = 1, ...postOverrides } = overrides;
	return { ...makePost(postOverrides), displayNumber };
}

export function makeGossipMessage(
	overrides: Partial<GossipMessage> = {},
): GossipMessage {
	return {
		type: "post",
		post: makePost(),
		ttl: 3,
		path: ["peer-origin"],
		...overrides,
	};
}
