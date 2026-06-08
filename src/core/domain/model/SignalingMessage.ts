import { z } from "zod";
import { SignalingEnvelopeSchema } from "./SignalingEnvelope";
import type { SignalingErrorCode } from "./SignalingErrorCode";

/** クライアント → サーバー */
export const ClientMessageSchema = z.union([
	// boardId は required（板別マッチング）。旧クライアント（boardId なし）は
	// parse 失敗で reject される。プレローンチのため互換性は不要。
	z.object({
		type: z.literal("join"),
		peerId: z.string(),
		boardId: z.string(),
	}),
	z.object({ type: z.literal("signal"), envelope: SignalingEnvelopeSchema }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** サーバー → クライアント */
export const ServerMessageSchema = z.union([
	z.object({ type: z.literal("peers"), peers: z.array(z.string()) }),
	z.object({ type: z.literal("signal"), envelope: SignalingEnvelopeSchema }),
	z.object({
		type: z.literal("error"),
		code: z.string() as z.ZodType<SignalingErrorCode>,
		message: z.string(),
	}),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
