import type { Post } from "./Post";

/** エンベロープ: Post をネットワーク上で運ぶ包み。 */
export type GossipMessage = {
	/** メッセージ種別。将来 "sync_request" | "sync_response" 等を追加。 */
	readonly type: "post";
	readonly boardId: string;
	readonly threadId: string;
	readonly post: Post;
	/** 中継のたびにデクリメント。0で転送停止。 */
	readonly ttl: number;
	/** 通過済みピアID。ループ防止。 */
	readonly path: string[];
};
