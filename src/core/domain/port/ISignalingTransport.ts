import type { SignalingEnvelope } from "../model/SignalingEnvelope";

export interface ISignalingTransport {
	send(envelope: SignalingEnvelope): void;
	onMessage(handler: (envelope: SignalingEnvelope) => void): () => void;
}
