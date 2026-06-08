import { z } from "zod";
import { MAX_THREAD_TITLE_BYTES } from "@/core/config/constants";

export const ThreadSchema = z
	.object({
		/** Unix ms の文字列表現（13桁）。String(createdAt) と一致する。 */
		threadId: z.string().min(1),
		boardId: z.string().min(1),
		/** 0 bytes（空文字）または MAX_THREAD_TITLE_BYTES+1 bytes 以上は reject される。 */
		title: z
			.string()
			.min(1)
			.refine(
				(s) => new TextEncoder().encode(s).byteLength <= MAX_THREAD_TITLE_BYTES,
				{
					message: `タイトルは${MAX_THREAD_TITLE_BYTES}バイト以内にしてください`,
				},
			),
		/** Unix ms。threadId === String(createdAt) が成立する。 */
		createdAt: z.number().int().min(0),
		/** Ed25519 署名（base64）。
		 * TODO: min(1) を追加する。genesis センチネル（"genesis"）の扱いを
		 * 15c 検証パイプラインで確定してから制約を強化すること。
		 */
		signature: z.string(),
		/** TODO: min(1) を追加する（signature と同様の理由）。 */
		publicKey: z.string(),
	})
	.readonly();

/** スレ: レスの集合のメタデータ。 */
export type Thread = z.infer<typeof ThreadSchema>;
