import type { ThreadDigest } from "@/core/domain/model/DataChannelMessage";
import { SYNC_MAX_POSTS } from "@/core/domain/model/DataChannelMessage";
import type { Post } from "@/core/domain/model/Post";
import type { IDataSyncGateway } from "@/core/domain/port/IDataSyncGateway";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import { LamportClock } from "@/core/domain/service/LamportClock";
import type { PostIngester } from "@/core/domain/service/PostIngester";

type DigestStatus = "awaiting" | "received";

/** digest 定期送信間隔（ミリ秒）。 */
const DIGEST_INTERVAL_MS = 10_000;

/**
 * Digest 交換・投稿可能判定・過去データ Sync を管理する UseCase（板単位）。
 *
 * 【Digest 交換フロー】
 * ピア接続時に双方が自分の digest を送りつけ合い、
 * 全直接ピアから digest が届いた時点で canPost() が true になる。
 * canPost() は一度 true になると以降変化しない。
 *
 * 【Sync フロー】
 * digest を受信したとき、相手より自分が多く持つ投稿を sync として push する。
 * 受信した sync 投稿は PostVerifier で検証・保存する（ファンアウトしない）。
 * 定期的に digest を送信し、後から接続したピアへの差分 sync を促す。
 */
export class ExchangeDigestUseCase {
	private readonly boardId: string;
	// TODO: 複数スレ対応時は IPostStore から動的取得に変更する
	private readonly threadId: string;
	private readonly store: IPostStore;
	private readonly ingester: PostIngester;
	private readonly digestGateway: IDataSyncGateway;
	private readonly clock: LamportClock;
	private readonly logger: ILogger;

	/** DC open 中の全ピアの digest 受信状態。DC close でエントリ削除。 */
	private readonly connectedPeers = new Map<string, DigestStatus>();
	private canPostState = false;
	private readonly handlers = new Set<() => void>();

	/**
	 * 各ピアへ最後に sync push した時点の自分の postCount。
	 * 同じ内容の sync を重複送信しないための最適化。DC close でエントリ削除。
	 */
	private readonly lastSyncedPostCount = new Map<string, number>();

	private readonly unsubDigest: () => void;
	private readonly unsubSync: () => void;
	private readonly intervalId: ReturnType<typeof setInterval>;

	constructor(
		boardId: string,
		threadId: string,
		store: IPostStore,
		ingester: PostIngester,
		digestGateway: IDataSyncGateway,
		clock: LamportClock,
		logger: ILogger,
	) {
		this.boardId = boardId;
		this.threadId = threadId;
		this.store = store;
		this.ingester = ingester;
		this.digestGateway = digestGateway;
		this.clock = clock;
		this.logger = logger;

		this.unsubDigest = digestGateway.onDigestReceive(
			(peerId, incomingBoardId, threads) =>
				this.handleDigestReceived(peerId, incomingBoardId, threads),
		);
		this.unsubSync = digestGateway.onSyncReceive(
			(peerId, incomingBoardId, posts) =>
				void this.handleSyncReceived(peerId, incomingBoardId, posts).catch(
					(err) =>
						this.logger.error("exchange_digest.sync_receive_error", {
							peerId,
							err,
						}),
				),
		);
		this.intervalId = setInterval(
			() => this.sendDigestToAll(),
			DIGEST_INTERVAL_MS,
		);
	}

	/** DataChannel open 時に呼ぶ。自分の digest を送信し、接続ピア集合に追加する。 */
	onPeerConnected(peerId: string): void {
		this.connectedPeers.set(peerId, "awaiting");
		this.sendDigestTo(peerId);
	}

	/** DataChannel close 時に呼ぶ。接続ピア集合から除外して canPost を再判定する。 */
	onPeerDisconnected(peerId: string): void {
		this.lastSyncedPostCount.delete(peerId);
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
		this.unsubSync();
		clearInterval(this.intervalId);
	}

	private sendDigestTo(peerId: string): void {
		const posts = this.store.getSnapshot(this.threadId);
		const maxLamport = posts.reduce((max, p) => Math.max(max, p.lamport), 0);
		const threads: ThreadDigest[] = [
			{ threadId: this.threadId, maxLamport, postCount: posts.length },
		];
		this.digestGateway.sendDigest(peerId, this.boardId, threads);
	}

	private sendDigestToAll(): void {
		for (const peerId of this.connectedPeers.keys()) {
			this.sendDigestTo(peerId);
		}
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

		// 状態遷移は常に行う。checkCanPost の呼び出しだけ canPost 前にガードする
		if (this.connectedPeers.has(peerId)) {
			this.connectedPeers.set(peerId, "received");
		}
		if (!this.canPostState) {
			this.logger.info("exchange_digest.digest_received", {
				peerId,
				boardId: incomingBoardId,
				threadCount: threads.length,
			});
			this.checkCanPost();
		}

		// 相手より多く持つ投稿を sync push する
		this.pushSyncIfNeeded(peerId, threads).catch((err) =>
			this.logger.error("exchange_digest.sync_push_error", { peerId, err }),
		);
	}

	private async handleSyncReceived(
		peerId: string,
		incomingBoardId: string,
		posts: Post[],
	): Promise<void> {
		if (incomingBoardId !== this.boardId) return;

		if (posts.length > SYNC_MAX_POSTS) {
			this.logger.warn("exchange_digest.sync_too_large", {
				peerId,
				count: posts.length,
				max: SYNC_MAX_POSTS,
			});
			return;
		}

		for (const post of posts) {
			await this.ingester.ingest(post);
		}
	}

	private async pushSyncIfNeeded(
		peerId: string,
		peerThreads: ThreadDigest[],
	): Promise<void> {
		const myPosts = this.store.getSnapshot(this.threadId);

		const peerThread = peerThreads.find((t) => t.threadId === this.threadId);
		const peerPostCount = peerThread?.postCount ?? 0;
		const peerMaxLamport = peerThread?.maxLamport ?? 0;

		// 相手より多く持つ投稿がなければ何もしない
		if (myPosts.length <= peerPostCount) return;

		// 直前の sync push 以降に新しい投稿が増えていなければ送らない
		const lastSynced = this.lastSyncedPostCount.get(peerId) ?? -1;
		if (myPosts.length <= lastSynced) return;

		// NOTE: lamport ベースの差分抽出。ピアが持つ投稿に「穴」がある場合は検知できない。
		// 穴の補完は Story 19（postIds 交換プロトコル）で対応する。
		const missing = myPosts.filter((p) => p.lamport > peerMaxLamport);
		if (missing.length === 0) return;

		// SYNC_MAX_POSTS 件ずつ分割して送信
		for (let i = 0; i < missing.length; i += SYNC_MAX_POSTS) {
			const batch = missing.slice(i, i + SYNC_MAX_POSTS);
			this.digestGateway.sendSync(peerId, this.boardId, batch);
		}

		this.lastSyncedPostCount.set(peerId, myPosts.length);
		this.logger.info("exchange_digest.sync_pushed", {
			peerId,
			count: missing.length,
		});
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
