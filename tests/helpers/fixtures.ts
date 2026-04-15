import type { Post } from "../../src/domain/model/Post";

export function makePost(overrides: Partial<Post> = {}): Post {
	return {
		id: "hash-abc123",
		number: 1,
		name: "名無しさん",
		body: "テスト本文",
		odId: "abcd1234",
		timestamp: 1_700_000_000_000,
		signature: "valid-sig",
		publicKey: "pubkey-base64",
		...overrides,
	};
}
