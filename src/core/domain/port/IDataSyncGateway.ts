import type { Post } from "../model/Post";
import type { Thread } from "../model/Thread";
import type { ThreadDigest } from "../model/ThreadDigest";

export interface IDataSyncGateway {
	sendDigest(peerId: string, boardId: string, threads: ThreadDigest[]): void;
	onDigestReceive(
		handler: (peerId: string, boardId: string, threads: ThreadDigest[]) => void,
	): () => void;
	/** threads は旧バージョンのピアとの後方互換のためオプショナル。 */
	sendSync(
		peerId: string,
		boardId: string,
		posts: Post[],
		threads?: Thread[],
	): void;
	onSyncReceive(
		handler: (
			peerId: string,
			boardId: string,
			posts: Post[],
			threads: Thread[],
		) => void,
	): () => void;
}
