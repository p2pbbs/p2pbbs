import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import { GossipMessageSchema } from "@/core/domain/model/GossipMessage";
import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";
import type { ILogger } from "@/core/domain/port/ILogger";

/**
 * IGossipMessageGateway の BroadcastChannel 実装（Phase 1）。
 * 同一オリジンの全タブにブロードキャストする。送信元タブには届かない（BroadcastChannel 仕様）。
 * Phase 2 では WebRTCGateway に差し替える。
 */
export class BroadcastChannelGateway implements IGossipMessageGateway {
	private readonly channel: BroadcastChannel;
	private readonly logger: ILogger;

	constructor(channelName: string, logger: ILogger) {
		this.channel = new BroadcastChannel(channelName);
		this.logger = logger;
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
			let data: unknown;
			try {
				data =
					typeof event.data === "string" ? JSON.parse(event.data) : event.data;
			} catch (err) {
				this.logger.warn("gossip.receive_parse_error", { error: String(err) });
				return;
			}
			const result = GossipMessageSchema.safeParse(data);
			if (!result.success) {
				this.logger.warn("gossip.receive_invalid_schema", {
					error: result.error.message,
				});
				return;
			}
			handler(result.data);
		};
		this.channel.addEventListener("message", listener);
		return () => this.channel.removeEventListener("message", listener);
	}

	close(): void {
		this.channel.close();
	}
}
