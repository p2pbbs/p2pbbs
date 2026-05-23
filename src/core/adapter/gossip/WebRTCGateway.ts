import type { ThreadDigest } from "@/core/domain/model/DataChannelMessage";
import { DataChannelMessageSchema } from "@/core/domain/model/DataChannelMessage";
import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import type { Post } from "@/core/domain/model/Post";
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
		(peerId: string, boardId: string, threads: ThreadDigest[]) => void
	>();
	private readonly syncHandlers = new Set<
		(peerId: string, boardId: string, posts: Post[]) => void
	>();
	/** PeerManager が所有する Map への参照。send 時に毎回最新の接続先を読む。 */
	private readonly channelsRef: ReadonlyMap<string, IDataChannel>;

	constructor(channelsRef: ReadonlyMap<string, IDataChannel>) {
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
	sendDigest(peerId: string, boardId: string, threads: ThreadDigest[]): void {
		const dc = this.channelsRef.get(peerId);
		if (!dc) return;
		try {
			dc.send(JSON.stringify({ type: "digest", boardId, threads }));
		} catch {
			// closing 中の DC は無視
		}
	}

	onDigestReceive(
		handler: (peerId: string, boardId: string, threads: ThreadDigest[]) => void,
	): () => void {
		this.digestHandlers.add(handler);
		return () => this.digestHandlers.delete(handler);
	}

	/** sync を特定ピアへ送信する。 */
	sendSync(peerId: string, boardId: string, posts: Post[]): void {
		const dc = this.channelsRef.get(peerId);
		if (!dc) return;
		try {
			dc.send(JSON.stringify({ type: "sync", boardId, posts }));
		} catch {
			// closing 中の DC は無視
		}
	}

	onSyncReceive(
		handler: (peerId: string, boardId: string, posts: Post[]) => void,
	): () => void {
		this.syncHandlers.add(handler);
		return () => this.syncHandlers.delete(handler);
	}

	/** DC から来た生データを解釈してタイプ別に振り分ける。 */
	handleIncoming(peerId: string, raw: string): void {
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
				for (const h of this.syncHandlers) h(peerId, msg.boardId, msg.posts);
			}
		} catch {
			// malformed JSON は無視
		}
	}
}
