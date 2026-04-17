import { z } from "zod";
import { PostSchema } from "./Post";

export const GossipMessageSchema = z
	.object({
		type: z.literal("post"),
		post: PostSchema,
		/** 残り転送ホップ数。整数かつ非負。0 で転送停止。 */
		ttl: z.number().int().min(0),
		path: z.array(z.string()),
	})
	.readonly();

/** エンベロープ: Post をネットワーク上で運ぶ包み。boardId/threadId は Post が持つ。 */
export type GossipMessage = z.infer<typeof GossipMessageSchema>;
