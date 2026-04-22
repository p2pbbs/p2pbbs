import { z } from "zod";

const RTCSessionDescriptionInitSchema = z.object({
	type: z.enum(["offer", "answer", "pranswer", "rollback"]),
	sdp: z.string().optional(),
});

const RTCIceCandidateInitSchema = z.object({
	candidate: z.string().optional(),
	sdpMid: z.string().nullable().optional(),
	sdpMLineIndex: z.number().int().nullable().optional(),
	usernameFragment: z.string().nullable().optional(),
});

export const SignalingPayloadSchema = z.union([
	z
		.object({ type: z.literal("offer"), sdp: RTCSessionDescriptionInitSchema })
		.readonly(),
	z
		.object({ type: z.literal("answer"), sdp: RTCSessionDescriptionInitSchema })
		.readonly(),
	z
		.object({
			type: z.literal("ice-candidate"),
			candidate: RTCIceCandidateInitSchema,
		})
		.readonly(),
]);

export type SignalingPayload = z.infer<typeof SignalingPayloadSchema>;

export const SignalingEnvelopeSchema = z
	.object({
		/** 送信元 Peer ID */
		from: z.string(),
		/** 宛先 Peer ID */
		to: z.string(),
		payload: SignalingPayloadSchema,
	})
	.readonly();

export type SignalingEnvelope = z.infer<typeof SignalingEnvelopeSchema>;
