import { DataChannelMessageSchema } from "@/core/domain/model/DataChannelMessage";
import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import type { PeerId } from "@/core/domain/model/ids";
import type { Post } from "@/core/domain/model/Post";
import type { Thread } from "@/core/domain/model/Thread";
import type { ThreadDigest } from "@/core/domain/model/ThreadDigest";
import type { IDataChannel } from "@/core/domain/port/IDataChannel";
import type { IDataSyncGateway } from "@/core/domain/port/IDataSyncGateway";
import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";

/**
 * IGossipMessageGateway + IDataSyncGateway の WebRTC 実装。
 * PeerManager が所有する channels Map への参照を読むだけで、状態を持たない。
 */
export class WebRTCGateway implements IGossipMessageGateway, IDataSyncGateway {
	private readonly gossipHandlers = new Set<(msg: GossipMessage) => void>();
	private readonly digestHandlers = new Set<
		(peerId: PeerId, boardId: string, threads: ThreadDigest[]) => void
	>();
	private readonly syncHandlers = new Set<
		(peerId: PeerId, boardId: string, posts: Post[], threads: Thread[]) => void
	>();
	/** PeerManager が所有する Map への参照。send 時に毎回最新の接続先を読む。 */
	private readonly channelsRef: ReadonlyMap<PeerId, IDataChannel>;

	constructor(channelsRef: ReadonlyMap<PeerId, IDataChannel>) {
		this.channelsRef = channelsRef;
	}

	/** gossip をブロードキャスト送信する。 */
	send(message: GossipMessage): void {
		const data = JSON.stringify({ type: "gossip", message });
		for (const dc of this.channelsRef.values()) {
			try {
				dc.send(data);
			} catch {
				// closing 中の DC は無視
			}
		}
	}

	onReceive(handler: (msg: GossipMessage) => void): () => void {
		this.gossipHandlers.add(handler);
		return () => this.gossipHandlers.delete(handler);
	}

	/** digest を特定ピアへ送信する。 */
	sendDigest(peerId: PeerId, boardId: string, threads: ThreadDigest[]): void {
		const dc = this.channelsRef.get(peerId);
		if (!dc) return;
		try {
			dc.send(JSON.stringify({ type: "digest", boardId, threads }));
		} catch {
			// closing 中の DC は無視
		}
	}

	onDigestReceive(
		handler: (peerId: PeerId, boardId: string, threads: ThreadDigest[]) => void,
	): () => void {
		this.digestHandlers.add(handler);
		return () => this.digestHandlers.delete(handler);
	}

	/** sync を特定ピアへ送信する。threads を渡すと同梱される。 */
	sendSync(
		peerId: PeerId,
		boardId: string,
		posts: Post[],
		threads?: Thread[],
	): void {
		const dc = this.channelsRef.get(peerId);
		if (!dc) return;
		try {
			dc.send(
				JSON.stringify({
					type: "sync",
					boardId,
					posts,
					...(threads && threads.length > 0 ? { threads } : {}),
				}),
			);
		} catch {
			// closing 中の DC は無視
		}
	}

	onSyncReceive(
		handler: (
			peerId: PeerId,
			boardId: string,
			posts: Post[],
			threads: Thread[],
		) => void,
	): () => void {
		this.syncHandlers.add(handler);
		return () => this.syncHandlers.delete(handler);
	}

	/** DC から来た生データを解釈してタイプ別に振り分ける。 */
	handleIncoming(peerId: PeerId, raw: string): void {
		try {
			const result = DataChannelMessageSchema.safeParse(JSON.parse(raw));
			if (!result.success) return;
			const msg = result.data;
			if (msg.type === "gossip") {
				for (const h of this.gossipHandlers) h(msg.message);
			} else if (msg.type === "digest") {
				for (const h of this.digestHandlers)
					h(peerId, msg.boardId, msg.threads);
			} else if (msg.type === "sync") {
				for (const h of this.syncHandlers)
					h(peerId, msg.boardId, msg.posts, msg.threads ?? []);
			}
		} catch {
			// malformed JSON は無視
		}
	}
}
