import { z } from "zod";
import { PostSchema } from "./Post";
import { ThreadSchema } from "./Thread";

// z.discriminatedUnion は ZodObject を要求するため各 variant に .readonly() を付けず、
// ユニオン全体に .readonly() を適用する。
export const GossipMessageSchema = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("post"),
			post: PostSchema,
			/** 残り転送ホップ数。整数かつ非負。0 で転送停止。 */
			ttl: z.number().int().min(0),
			path: z.array(z.string()),
		}),
		z.object({
			type: z.literal("thread_created"),
			thread: ThreadSchema,
			/** スレ >>1 の投稿。thread と同時にアトミックに伝播する。 */
			post: PostSchema,
			ttl: z.number().int().min(0),
			path: z.array(z.string()),
		}),
	])
	.readonly();

/** エンベロープ: Post（またはスレ+Post）をネットワーク上で運ぶ包み。boardId/threadId は Post が持つ。 */
export type GossipMessage = z.infer<typeof GossipMessageSchema>;
