import { SYNC_MAX_POSTS } from "@/core/domain/model/DataChannelMessage";
import type { PeerId } from "@/core/domain/model/ids";
import type { Post } from "@/core/domain/model/Post";
import type { Thread } from "@/core/domain/model/Thread";
import type { ThreadDigest } from "@/core/domain/model/ThreadDigest";
import type { IDataSyncGateway } from "@/core/domain/port/IDataSyncGateway";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import type { IThreadStore } from "@/core/domain/port/IThreadStore";
import { LamportClock } from "@/core/domain/service/LamportClock";
import type { LamportClockMap } from "@/core/domain/service/LamportClockMap";
import type { PostIngester } from "@/core/domain/service/PostIngester";
import type { ThreadIngester } from "@/core/domain/service/ThreadIngester";

type DigestStatus = "awaiting" | "received";

/** digest 定期送信間隔（ミリ秒）。 */
const DIGEST_INTERVAL_MS = 10_000;

/**
 * Digest 交換・投稿可能判定・過去データ Sync を管理する UseCase（板単位）。
 *
 * 【Digest 交換フロー】
 * ピア接続時に双方が自分の全スレ digest を送りつけ合い、
 * 全直接ピアから digest が届いた時点で canPost() が true になる。
 * canPost() は一度 true になると以降変化しない。
 *
 * 【Sync フロー】
 * digest を受信したとき、相手より自分が多く持つ投稿をスレ単位で sync として push する。
 * 相手が持っていない Thread エンティティは sync に同梱して送る（anti-entropy 経路のスレ発見）。
 * 受信した sync は ThreadIngester / PostIngester で検証・保存する（ファンアウトしない）。
 * 定期的に digest を送信し、後から接続したピアへの差分 sync を促す。
 */
export class ExchangeDigestUseCase {
	private readonly boardId: string;
	private readonly store: IPostStore;
	private readonly threadStore: IThreadStore;
	private readonly ingester: PostIngester;
	private readonly threadIngester: ThreadIngester;
	private readonly digestGateway: IDataSyncGateway;
	private readonly clockMap: LamportClockMap;
	private readonly logger: ILogger;

	/** DC open 中の全ピアの digest 受信状態。DC close でエントリ削除。 */
	private readonly connectedPeers = new Map<PeerId, DigestStatus>();
	private canPostState = false;
	private readonly handlers = new Set<() => void>();

	/**
	 * 各ピア・スレへ最後に sync push した時点の自分の postCount。
	 * 同じ内容の sync を重複送信しないための最適化。DC close でピアごとエントリ削除。
	 * 構造: Map<peerId, Map<threadId, postCount>>
	 */
	private readonly lastSyncedPostCount = new Map<PeerId, Map<string, number>>();

	private readonly unsubDigest: () => void;
	private readonly unsubSync: () => void;
	private readonly intervalId: ReturnType<typeof setInterval>;

	constructor(
		boardId: string,
		store: IPostStore,
		threadStore: IThreadStore,
		ingester: PostIngester,
		threadIngester: ThreadIngester,
		digestGateway: IDataSyncGateway,
		clockMap: LamportClockMap,
		logger: ILogger,
	) {
		this.boardId = boardId;
		this.store = store;
		this.threadStore = threadStore;
		this.ingester = ingester;
		this.threadIngester = threadIngester;
		this.digestGateway = digestGateway;
		this.clockMap = clockMap;
		this.logger = logger;

		this.unsubDigest = digestGateway.onDigestReceive(
			(peerId, incomingBoardId, threads) =>
				this.handleDigestReceived(peerId, incomingBoardId, threads),
		);
		this.unsubSync = digestGateway.onSyncReceive(
			(peerId, incomingBoardId, posts, threads) =>
				void this.handleSyncReceived(
					peerId,
					incomingBoardId,
					posts,
					threads,
				).catch((err) =>
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
	onPeerConnected(peerId: PeerId): void {
		this.connectedPeers.set(peerId, "awaiting");
		this.sendDigestTo(peerId);
	}

	/** DataChannel close 時に呼ぶ。接続ピア集合から除外して canPost を再判定する。 */
	onPeerDisconnected(peerId: PeerId): void {
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

	/** 自分が投稿を持つ全スレの ThreadDigest を動的に構築する。 */
	private buildDigests(): ThreadDigest[] {
		return this.store.getThreadIds(this.boardId).map((threadId) => {
			const posts = this.store.getSnapshot(threadId);
			const maxLamport = posts.reduce((max, p) => Math.max(max, p.lamport), 0);
			return { threadId, maxLamport, postCount: posts.length };
		});
	}

	private sendDigestTo(peerId: PeerId): void {
		this.digestGateway.sendDigest(peerId, this.boardId, this.buildDigests());
	}

	private sendDigestToAll(): void {
		for (const peerId of this.connectedPeers.keys()) {
			this.sendDigestTo(peerId);
		}
	}

	private handleDigestReceived(
		peerId: PeerId,
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
			this.clockMap.get(thread.threadId).safeMerge(thread.maxLamport);
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
		peerId: PeerId,
		incomingBoardId: string,
		posts: Post[],
		threads: Thread[],
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

		// Thread を先に取り込む（署名検証失敗時は無視し、Post のみ保存する）
		for (const thread of threads) {
			await this.threadIngester.ingest(thread);
		}
		for (const post of posts) {
			await this.ingester.ingest(post);
		}
	}

	private async pushSyncIfNeeded(
		peerId: PeerId,
		peerThreads: ThreadDigest[],
	): Promise<void> {
		const peerByThread = new Map(peerThreads.map((t) => [t.threadId, t]));

		for (const threadId of this.store.getThreadIds(this.boardId)) {
			await this.pushThreadSyncIfNeeded(
				peerId,
				threadId,
				peerByThread.get(threadId),
			);
		}
	}

	private async pushThreadSyncIfNeeded(
		peerId: PeerId,
		threadId: string,
		peerThread: ThreadDigest | undefined,
	): Promise<void> {
		const myPosts = this.store.getSnapshot(threadId);
		const peerPostCount = peerThread?.postCount ?? 0;
		const peerMaxLamport = peerThread?.maxLamport ?? 0;

		// 相手より多く持つ投稿がなければ何もしない
		if (myPosts.length <= peerPostCount) return;

		// 直前の sync push 以降に新しい投稿が増えていなければ送らない
		const peerSynced = this.lastSyncedPostCount.get(peerId);
		const lastSynced = peerSynced?.get(threadId) ?? -1;
		if (myPosts.length <= lastSynced) return;

		// NOTE: lamport ベースの差分抽出。ピアが持つ投稿に「穴」がある場合は検知できない。
		// 穴の補完は Story 19（postIds 交換プロトコル）で対応する。
		const missing = myPosts.filter((p) => p.lamport > peerMaxLamport);
		if (missing.length === 0) return;

		// 相手が持っていない可能性のある Thread エンティティを先頭バッチに同梱する
		const threadEntity = this.threadStore.get(threadId);
		const threadsToSend = threadEntity ? [threadEntity] : undefined;

		// SYNC_MAX_POSTS 件ずつ分割して送信
		for (let i = 0; i < missing.length; i += SYNC_MAX_POSTS) {
			const batch = missing.slice(i, i + SYNC_MAX_POSTS);
			const attachThreads = i === 0 ? threadsToSend : undefined;
			this.digestGateway.sendSync(peerId, this.boardId, batch, attachThreads);
		}

		this.markSynced(peerId, threadId, myPosts.length);
		this.logger.info("exchange_digest.sync_pushed", {
			peerId,
			threadId,
			count: missing.length,
		});
	}

	private markSynced(
		peerId: PeerId,
		threadId: string,
		postCount: number,
	): void {
		let perThread = this.lastSyncedPostCount.get(peerId);
		if (!perThread) {
			perThread = new Map();
			this.lastSyncedPostCount.set(peerId, perThread);
		}
		perThread.set(threadId, postCount);
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
