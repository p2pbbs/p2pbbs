import type { ThreadDigest } from "../model/DataChannelMessage";

export interface IDigestGateway {
	sendDigest(peerId: string, boardId: string, threads: ThreadDigest[]): void;
	onDigestReceive(
		handler: (peerId: string, boardId: string, threads: ThreadDigest[]) => void,
	): () => void;
}
