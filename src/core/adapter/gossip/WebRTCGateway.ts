import { DataChannelMessageSchema } from "@/core/domain/model/DataChannelMessage";
import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import type { IDataChannel } from "@/core/domain/port/IDataChannel";
import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";

/**
 * IGossipMessageGateway の WebRTC 実装。
 * PeerManager が所有する channels Map への参照を読むだけで、状態を持たない。
 */
export class WebRTCGateway implements IGossipMessageGateway {
	private readonly handlers = new Set<(msg: GossipMessage) => void>();
	/** PeerManager が所有する Map への参照。send 時に毎回最新の接続先を読む。 */
	private readonly channelsRef: ReadonlyMap<string, IDataChannel>;

	constructor(channelsRef: ReadonlyMap<string, IDataChannel>) {
		this.channelsRef = channelsRef;
	}

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
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	/** DC から来た生データを解釈して gossip なら handlers に通知する。 */
	handleIncoming(raw: string): void {
		try {
			const result = DataChannelMessageSchema.safeParse(JSON.parse(raw));
			if (!result.success || result.data.type !== "gossip") return;
			for (const h of this.handlers) h(result.data.message);
		} catch {
			// malformed JSON は無視
		}
	}
}
