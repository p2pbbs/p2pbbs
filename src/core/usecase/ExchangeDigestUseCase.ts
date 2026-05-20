import type { ThreadDigest } from "@/core/domain/model/DataChannelMessage";
import type { IDigestGateway } from "@/core/domain/port/IDigestGateway";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import { LamportClock } from "@/core/domain/service/LamportClock";

type DigestStatus = "awaiting" | "received";

/**
 * Digest 交換と投稿可能判定を管理する UseCase（板単位）。
 *
 * ピア接続時に双方が自分の digest を送りつけ合い、
 * 全直接ピアから digest が届いた時点で canPost() が true になる。
 * canPost() は一度 true になると以降変化しない。
 */
export class ExchangeDigestUseCase {
	private readonly boardId: string;
	// TODO: 複数スレ対応時は IPostStore から動的取得に変更する
	private readonly threadId: string;
	private readonly store: IPostStore;
	private readonly digestGateway: IDigestGateway;
	private readonly clock: LamportClock;
	private readonly logger: ILogger;

	/** DC open 中のピアの digest 受信状態。DC close でエントリ削除。 */
	private readonly connectedPeers = new Map<string, DigestStatus>();
	private canPostState = false;
	private readonly handlers = new Set<() => void>();
	private readonly unsubDigest: () => void;

	constructor(
		boardId: string,
		threadId: string,
		store: IPostStore,
		digestGateway: IDigestGateway,
		clock: LamportClock,
		logger: ILogger,
	) {
		this.boardId = boardId;
		this.threadId = threadId;
		this.store = store;
		this.digestGateway = digestGateway;
		this.clock = clock;
		this.logger = logger;
		this.unsubDigest = digestGateway.onDigestReceive(
			(peerId, incomingBoardId, threads) =>
				this.handleDigestReceived(peerId, incomingBoardId, threads),
		);
	}

	/** DataChannel open 時に呼ぶ。自分の digest を送信し、相手を digest 未着ピア集合に追加する。 */
	onPeerConnected(peerId: string): void {
		if (!this.canPostState) {
			this.connectedPeers.set(peerId, "awaiting");
		}
		this.sendDigestTo(peerId);
	}

	/** DataChannel close 時に呼ぶ。接続ピア集合から除外して canPost を再判定する。 */
	onPeerDisconnected(peerId: string): void {
		if (this.connectedPeers.delete(peerId)) {
			this.checkCanPost();
		}
	}

	canPost(): boolean {
		return this.canPostState;
	}

	/** canPost() の変化を購読する。useSyncExternalStore 互換。 */
	subscribe(handler: () => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	dispose(): void {
		this.unsubDigest();
	}

	private sendDigestTo(peerId: string): void {
		const posts = this.store.getSnapshot(this.threadId);
		const maxLamport = posts.reduce((max, p) => Math.max(max, p.lamport), 0);
		const threads: ThreadDigest[] = [
			{ threadId: this.threadId, maxLamport, postCount: posts.length },
		];
		this.digestGateway.sendDigest(peerId, this.boardId, threads);
	}

	private handleDigestReceived(
		peerId: string,
		incomingBoardId: string,
		threads: ThreadDigest[],
	): void {
		if (incomingBoardId !== this.boardId) {
			this.logger.warn("exchange_digest.wrong_board", {
				boardId: incomingBoardId,
				expected: this.boardId,
			});
			return;
		}

		for (const thread of threads) {
			if (thread.maxLamport > LamportClock.MAX_LAMPORT) {
				this.logger.warn("exchange_digest.lamport_overflow", {
					threadId: thread.threadId,
					maxLamport: thread.maxLamport,
				});
			}
			this.clock.safeMerge(thread.maxLamport);
		}

		if (!this.canPostState && this.connectedPeers.has(peerId)) {
			this.connectedPeers.set(peerId, "received");
			this.logger.info("exchange_digest.digest_received", {
				peerId,
				boardId: incomingBoardId,
				threadCount: threads.length,
			});
			this.checkCanPost();
		}
	}

	private checkCanPost(): void {
		if (this.canPostState) return;
		if (this.connectedPeers.size === 0) return;
		for (const status of this.connectedPeers.values()) {
			if (status === "awaiting") return;
		}
		this.canPostState = true;
		this.logger.info("exchange_digest.can_post_enabled", {
			peerCount: this.connectedPeers.size,
		});
		for (const h of this.handlers) h();
	}
}
