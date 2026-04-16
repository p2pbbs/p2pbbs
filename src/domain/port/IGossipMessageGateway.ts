import type { GossipMessage } from "../model/GossipMessage";

/**
 * ゴシップメッセージの送受信窓口。
 * ゴシップのロジック（TTL、path、ファンアウト）は持たない。
 * Phase 1: BroadcastChannelGateway が実装。Phase 2: WebRTCGateway に差し替え。
 */
export interface IGossipMessageGateway {
	/** メッセージを送信する。実装はエラーを内部でハンドルする（throw しない）。 */
	send(message: GossipMessage): void;
	/** 受信ハンドラを登録する。戻り値はアンサブスクライブ関数。 */
	onReceive(handler: (message: GossipMessage) => void): () => void;
}
