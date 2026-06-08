import { MAX_THREADS_PER_BOARD } from "@/core/config/constants";
import type { Thread } from "@/core/domain/model/Thread";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IThreadStore } from "@/core/domain/port/IThreadStore";
import type { CryptoService } from "@/core/domain/service/CryptoService";

/**
 * スレの受け入れパイプライン。gossip(thread_created) 受信・sync 受信・スレ作成で共有する。
 * パイプライン順序: 署名検証 → threadId === String(createdAt) 検証 → 重複排除 → FIFO evict → 保存
 *
 * Post と Thread の紐づけ検証（post.threadId === thread.threadId）は呼び出し側の責務。
 * Thread エンティティ単体の正当性だけをここで担保する。
 */
export class ThreadIngester {
	private readonly threadStore: IThreadStore;
	private readonly crypto: CryptoService;
	private readonly logger: ILogger;

	constructor(
		threadStore: IThreadStore,
		crypto: CryptoService,
		logger: ILogger,
	) {
		this.threadStore = threadStore;
		this.crypto = crypto;
		this.logger = logger;
	}

	/**
	 * Thread を検証して保存する。
	 * 保存できた場合は true、不正または重複の場合は false を返す。
	 * 板のスレ数が上限に達している場合は最古スレを FIFO evict してから保存する。
	 */
	async ingest(thread: Thread): Promise<boolean> {
		if (!(await this.verifySignatureSafe(thread))) {
			this.logger.warn("thread_ingester.invalid_signature", {
				threadId: thread.threadId,
			});
			return false;
		}
		if (thread.threadId !== String(thread.createdAt)) {
			this.logger.warn("thread_ingester.id_mismatch", {
				threadId: thread.threadId,
				createdAt: thread.createdAt,
			});
			return false;
		}
		if (this.threadStore.has(thread.threadId)) return false;

		await this.evictIfNeeded(thread.boardId);
		await this.threadStore.save(thread);
		return true;
	}

	/**
	 * 署名検証を例外安全に行う。
	 * publicKey が base64 として不正（例: genesis センチネル "genesis"）な場合、
	 * importKey が例外を投げるため false に倒す。ネットワーク経由のジェネシス偽装を弾く。
	 */
	private async verifySignatureSafe(thread: Thread): Promise<boolean> {
		try {
			return await this.crypto.verifyThreadSignature(thread);
		} catch {
			return false;
		}
	}

	/** 板のスレ数が上限に達していれば最古スレ（createdAt 昇順の先頭）を削除する。 */
	private async evictIfNeeded(boardId: string): Promise<void> {
		const threads = this.threadStore.getByBoard(boardId);
		if (threads.length < MAX_THREADS_PER_BOARD) return;

		const oldest = threads[0];
		if (!oldest) return;
		await this.threadStore.delete(oldest.threadId);
		this.logger.info("thread_ingester.evicted", {
			boardId,
			threadId: oldest.threadId,
		});
	}
}
