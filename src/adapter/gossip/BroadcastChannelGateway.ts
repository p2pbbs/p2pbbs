import type { GossipMessage } from "@/domain/model/GossipMessage";
import type { IGossipMessageGateway } from "@/domain/port/IGossipMessageGateway";
import type { ILogger } from "@/domain/port/ILogger";

/**
 * IGossipMessageGateway の BroadcastChannel 実装（Phase 1）。
 * 同一オリジンの全タブにブロードキャストする。送信元タブには届かない（BroadcastChannel 仕様）。
 * Phase 2 では WebRTCGateway に差し替える。
 */
export class BroadcastChannelGateway implements IGossipMessageGateway {
	private readonly channel: BroadcastChannel;

	constructor(
		channelName: string,
		private readonly logger: ILogger,
	) {
		this.channel = new BroadcastChannel(channelName);
	}

	send(message: GossipMessage): void {
		try {
			this.channel.postMessage(JSON.stringify(message));
		} catch (err) {
			this.logger.error("gossip.send_failed", { error: String(err) });
		}
	}

	onReceive(handler: (message: GossipMessage) => void): () => void {
		const listener = (event: MessageEvent<unknown>) => {
			try {
				const data: unknown =
					typeof event.data === "string" ? JSON.parse(event.data) : event.data;
				handler(data as GossipMessage);
			} catch (err) {
				this.logger.warn("gossip.receive_parse_error", { error: String(err) });
			}
		};
		this.channel.addEventListener("message", listener);
		return () => this.channel.removeEventListener("message", listener);
	}

	close(): void {
		this.channel.close();
	}
}
