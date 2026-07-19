import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import { GossipMessageSchema } from "@/core/domain/model/GossipMessage";
import type { PeerId } from "@/core/domain/model/ids";
import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { PostIngester } from "@/core/domain/service/PostIngester";
import type { ThreadIngester } from "@/core/domain/service/ThreadIngester";

/**
 * ゴシップメッセージの受信パイプライン。
 * 処理順序: スキーマ検証 → path 重複排除 → タイプ別処理 → TTL チェック → 再ファンアウト
 *
 * 署名検証・ハッシュ検証・seen 重複排除・保存・clock merge は PostIngester / ThreadIngester に委譲する。
 * gossip 受信と sync 受信で同一インスタンスを共有することで、
 * どちらの経路から届いても重複保存を防ぐ。
 */
export class ReceiveGossipUseCase {
	private readonly ingester: PostIngester;
	private readonly threadIngester: ThreadIngester;
	private readonly selfId: PeerId;
	private readonly gateway: IGossipMessageGateway;
	private readonly logger: ILogger;

	constructor(
		ingester: PostIngester,
		threadIngester: ThreadIngester,
		selfId: PeerId,
		gateway: IGossipMessageGateway,
		logger: ILogger,
	) {
		this.ingester = ingester;
		this.threadIngester = threadIngester;
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

		// 2. タイプ別に保存処理。保存できた（＝新規情報がある）場合のみ再ファンアウトする
		const hasNewInfo =
			msg.type === "post"
				? await this.ingester.ingest(msg.post)
				: await this.ingestThreadCreated(msg);
		if (!hasNewInfo) return;

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

	/**
	 * thread_created の検証・保存パイプライン。
	 * Post と Thread を独立に ingest し、どちらかが新規なら true を返す。
	 *
	 * - Post は独立して有効なため、Thread が無効でも保存する（content-addressed・署名済み）
	 * - Thread は post.threadId === thread.threadId の紐づけが成立する場合のみ受け入れる
	 */
	private async ingestThreadCreated(
		msg: Extract<GossipMessage, { type: "thread_created" }>,
	): Promise<boolean> {
		const { thread, post } = msg;

		const bound = post.threadId === thread.threadId;
		if (!bound) {
			this.logger.warn("receive.thread_post_mismatch", {
				threadId: thread.threadId,
				postThreadId: post.threadId,
			});
		}

		const postSaved = await this.ingester.ingest(post);
		const threadSaved = bound
			? await this.threadIngester.ingest(thread)
			: false;
		return postSaved || threadSaved;
	}
}
