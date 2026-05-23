import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import { GossipMessageSchema } from "@/core/domain/model/GossipMessage";
import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { PostIngester } from "@/core/domain/service/PostIngester";

/**
 * ゴシップメッセージの受信パイプライン。
 * 処理順序: スキーマ検証 → path 重複排除 → PostIngester → TTL チェック → 再ファンアウト
 *
 * 署名検証・ハッシュ検証・seen 重複排除・保存・clock.merge は PostIngester に委譲する。
 * gossip 受信と sync 受信で同一 PostIngester インスタンスを共有することで、
 * どちらの経路から届いても重複保存を防ぐ。
 */
export class ReceiveMessageUseCase {
	private readonly ingester: PostIngester;
	/** タブごとのランダム UUID（Peer ID）。OD ID ではない。 */
	private readonly selfId: string;
	private readonly gateway: IGossipMessageGateway;
	private readonly logger: ILogger;

	constructor(
		ingester: PostIngester,
		selfId: string,
		gateway: IGossipMessageGateway,
		logger: ILogger,
	) {
		this.ingester = ingester;
		this.selfId = selfId;
		this.gateway = gateway;
		this.logger = logger;
	}

	async execute(raw: unknown): Promise<void> {
		// 0. スキーマ検証（全入口で共通。不正な構造のメッセージを早期排除する）
		const parseResult = GossipMessageSchema.safeParse(raw);
		if (!parseResult.success) {
			this.logger.warn("receive.invalid_schema", {
				error: parseResult.error.message,
			});
			return;
		}
		const msg: GossipMessage = parseResult.data;

		// 1. path 重複排除: selfId が含まれる場合は自ノードが投稿または中継済み
		if (msg.path.includes(this.selfId)) return;

		// 2. PostIngester に委譲（署名検証 → ハッシュ検証 → seen 重複排除 → 保存 → clock.merge）
		const saved = await this.ingester.ingest(msg.post);
		if (!saved) return;

		// 3. TTL が切れていれば再ファンアウトしない
		if (msg.ttl <= 0) return;

		// 4. 再ファンアウト（TTL をデクリメントし、自 ID を path に追加）
		const forwarded: GossipMessage = {
			...msg,
			ttl: msg.ttl - 1,
			path: [...msg.path, this.selfId],
		};
		this.gateway.send(forwarded);
	}
}
