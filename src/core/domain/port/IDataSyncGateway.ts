import type { ThreadDigest } from "../model/DataChannelMessage";
import type { Post } from "../model/Post";

export interface IDataSyncGateway {
	sendDigest(peerId: string, boardId: string, threads: ThreadDigest[]): void;
	onDigestReceive(
		handler: (peerId: string, boardId: string, threads: ThreadDigest[]) => void,
	): () => void;
	sendSync(peerId: string, boardId: string, posts: Post[]): void;
	onSyncReceive(
		handler: (peerId: string, boardId: string, posts: Post[]) => void,
	): () => void;
}
