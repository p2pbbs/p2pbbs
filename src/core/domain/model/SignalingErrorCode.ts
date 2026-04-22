export const SignalingErrorCode = {
	CAPACITY_EXCEEDED: "capacity_exceeded",
	INVALID_MESSAGE: "invalid_message",
} as const;

export type SignalingErrorCode =
	(typeof SignalingErrorCode)[keyof typeof SignalingErrorCode];
