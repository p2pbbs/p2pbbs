import { z } from "zod";
import { GossipMessageSchema } from "./GossipMessage";

export const ThreadDigestSchema = z.object({
	threadId: z.string(),
	maxLamport: z.number().int().min(0),
	postCount: z.number().int().min(0),
});

export type ThreadDigest = z.infer<typeof ThreadDigestSchema>;

export const DataChannelMessageSchema = z.union([
	z.object({ type: z.literal("gossip"), message: GossipMessageSchema }),
	z.object({ type: z.literal("heartbeat") }),
	z.object({
		type: z.literal("digest"),
		boardId: z.string(),
		threads: z.array(ThreadDigestSchema),
	}),
]);

export type DataChannelMessage = z.infer<typeof DataChannelMessageSchema>;
