import { z } from "zod";
import { SignalingEnvelopeSchema } from "./SignalingEnvelope";
import type { SignalingErrorCode } from "./SignalingErrorCode";

/** クライアント → サーバー */
export const ClientMessageSchema = z.union([
	z.object({ type: z.literal("join"), peerId: z.string() }),
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
