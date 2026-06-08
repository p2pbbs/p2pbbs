import { z } from "zod";

export const ThreadDigestSchema = z.object({
	threadId: z.string(),
	maxLamport: z.number().int().min(0),
	postCount: z.number().int().min(0),
});

/** スレの要約情報。digest 交換に使用する軽量な表現。 */
export type ThreadDigest = z.infer<typeof ThreadDigestSchema>;
