import { z } from "zod";

export const PostSchema = z
	.object({
		id: z.string(),
		boardId: z.string(),
		threadId: z.string(),
		name: z.string(),
		body: z.string(),
		odId: z.string(),
		/** 表示用。Unix ms。負値は不正。 */
		timestamp: z.number().min(0),
		/** Lamport 論理クロック。整数かつ非負。 */
		lamport: z.number().int().min(0),
		signature: z.string(),
		publicKey: z.string(),
	})
	.readonly();

/** レス: 1つの書き込み。 */
export type Post = z.infer<typeof PostSchema>;
