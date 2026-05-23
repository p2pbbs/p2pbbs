import { z } from "zod";
import { GossipMessageSchema } from "./GossipMessage";
import { PostSchema } from "./Post";

export const ThreadDigestSchema = z.object({
	threadId: z.string(),
	maxLamport: z.number().int().min(0),
	postCount: z.number().int().min(0),
});

export type ThreadDigest = z.infer<typeof ThreadDigestSchema>;

/** sync 1 メッセージあたりの最大投稿件数。100 件 × 約 500 bytes ≒ 50 KB。 */
export const SYNC_MAX_POSTS = 100;

export const DataChannelMessageSchema = z.union([
	z.object({ type: z.literal("gossip"), message: GossipMessageSchema }),
	z.object({ type: z.literal("heartbeat") }),
	z.object({
		type: z.literal("digest"),
		boardId: z.string(),
		threads: z.array(ThreadDigestSchema),
	}),
	z.object({
		type: z.literal("sync"),
		boardId: z.string(),
		posts: z.array(PostSchema).max(SYNC_MAX_POSTS),
	}),
]);

export type DataChannelMessage = z.infer<typeof DataChannelMessageSchema>;
