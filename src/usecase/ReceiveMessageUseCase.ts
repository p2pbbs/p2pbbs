import type { GossipMessage } from "@/domain/model/GossipMessage";
import type { IGossipMessageGateway } from "@/domain/port/IGossipMessageGateway";
import type { ILogger } from "@/domain/port/ILogger";
import type { IPostStore } from "@/domain/port/IPostStore";
import type { CryptoService } from "@/domain/service/CryptoService";
import type { LamportClock } from "@/domain/service/LamportClock";

/**
 * ゴシップメッセージの受信パイプライン。
 * 処理順序: 署名検証 → ハッシュ検証 → 重複排除 → 保存 → clock.merge → 再ファンアウト
 *
 * 重複排除は2段構成:
 * 1. path に selfId が含まれる → 自ノードが投稿/中継済み → スキップ
 * 2. seen Set に post.id がある → 既に処理済み → スキップ
 *
 * ⚠️ 重複排除を署名・ハッシュ検証より前に行ってはいけない。
 * 不正メッセージで seen を汚染されると、後から届く正規メッセージがスキップされる。
 */
export class ReceiveMessageUseCase {
	/**
	 * セッション内の重複排除用。post.id（コンテンツハッシュ）を記録する。
	 * TODO: 長時間セッションでメモリが肥大化する。LRU か TTL 付きの実装に置き換えること。
	 *       Story 3a で IndexedDB に保存済みの post.id を使って起動時に seen を復元することも検討する。
	 */
	private readonly seen = new Set<string>();

	constructor(
		private readonly postStore: IPostStore,
		private readonly crypto: CryptoService,
		private readonly clock: LamportClock,
		private readonly selfId: string,
		private readonly gateway: IGossipMessageGateway,
		private readonly logger: ILogger,
	) {}

	async execute(msg: GossipMessage): Promise<void> {
		const { post } = msg;

		// 1. 署名検証
		if (!(await this.crypto.verifySignature(post))) {
			this.logger.warn("receive.invalid_signature", { postId: post.id });
			return;
		}

		// 2. ハッシュ検証
		if (!(await this.crypto.verifyPostHash(post))) {
			this.logger.warn("receive.invalid_hash", { postId: post.id });
			return;
		}

		// 3. 重複排除
		// path に selfId が含まれる場合は自ノードが投稿または中継済みなのでスキップ
		if (msg.path.includes(this.selfId) || this.seen.has(post.id)) {
			return;
		}
		this.seen.add(post.id);

		// 4. 保存
		await this.postStore.save(post);

		// 5. clock.merge（表示順の正確性のために保存後に更新）
		this.clock.merge(post.lamport);

		// 6. TTL が切れていれば再ファンアウトしない
		if (msg.ttl <= 0) return;

		// 7. 再ファンアウト（TTL をデクリメントし、自 ID を path に追加）
		const forwarded: GossipMessage = {
			...msg,
			ttl: msg.ttl - 1,
			path: [...msg.path, this.selfId],
		};
		this.gateway.send(forwarded);
	}
}
