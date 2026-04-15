import type { Post } from "./post";

/** エンベロープ: Post をネットワーク上で運ぶ包み。boardId/threadId は Post が持つ。 */
export type GossipMessage = {
	/** メッセージ種別。将来 "sync_request" | "sync_response" 等を追加。 */
	readonly type: "post";
	readonly post: Post;
	/** 中継のたびにデクリメント。0で転送停止。 */
	readonly ttl: number;
	/** 通過済みピアID。ループ防止。 */
	readonly path: string[];
};
