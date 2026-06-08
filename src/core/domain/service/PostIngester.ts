import type { Post } from "@/core/domain/model/Post";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import type { CryptoService } from "@/core/domain/service/CryptoService";
import type { LamportClockMap } from "@/core/domain/service/LamportClockMap";

/**
 * 投稿の受け入れパイプライン。gossip 受信と sync 受信で共有する。
 * パイプライン順序: 署名検証 → ハッシュ検証 → seen 重複排除 → 保存 → clock.merge
 *
 * ⚠️ 重複排除を署名・ハッシュ検証より前に行ってはいけない。
 * 攻撃者が既知の post.id を持つ不正メッセージを先に送ると seen が汚染され、
 * 後から届く正規メッセージがスキップされる。
 */
export class PostIngester {
	/**
	 * セッション内の重複排除用。post.id（コンテンツハッシュ）を記録する。
	 * gossip 受信と sync 受信で同一インスタンスを共有することで、
	 * どちらの経路から届いても重複保存を防ぐ。
	 * TODO: 長時間セッションでメモリが肥大化する。LRU か TTL 付き実装に置き換えること。
	 */
	private readonly seen = new Set<string>();
	private readonly postStore: IPostStore;
	private readonly crypto: CryptoService;
	private readonly clockMap: LamportClockMap;
	private readonly logger: ILogger;

	constructor(
		postStore: IPostStore,
		crypto: CryptoService,
		clockMap: LamportClockMap,
		logger: ILogger,
	) {
		this.postStore = postStore;
		this.crypto = crypto;
		this.clockMap = clockMap;
		this.logger = logger;
	}

	/**
	 * 投稿を検証して保存する。
	 * 保存できた場合は true、不正または重複の場合は false を返す。
	 */
	async ingest(post: Post): Promise<boolean> {
		if (!(await this.crypto.verifySignature(post))) {
			this.logger.warn("post_ingester.invalid_signature", { postId: post.id });
			return false;
		}
		if (!(await this.crypto.verifyPostHash(post))) {
			this.logger.warn("post_ingester.invalid_hash", { postId: post.id });
			return false;
		}
		if (this.seen.has(post.id)) return false;
		this.seen.add(post.id);
		await this.postStore.save(post);
		this.clockMap.get(post.threadId).merge(post.lamport);
		return true;
	}
}
