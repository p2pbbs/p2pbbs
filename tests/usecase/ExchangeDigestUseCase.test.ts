import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/core/domain/model/Post";
import type { Thread } from "@/core/domain/model/Thread";
import type { ThreadDigest } from "@/core/domain/model/ThreadDigest";
import type { IDataSyncGateway } from "@/core/domain/port/IDataSyncGateway";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import type { IThreadStore } from "@/core/domain/port/IThreadStore";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { LamportClock } from "@/core/domain/service/LamportClock";
import { LamportClockMap } from "@/core/domain/service/LamportClockMap";
import { PostIngester } from "@/core/domain/service/PostIngester";
import { ThreadIngester } from "@/core/domain/service/ThreadIngester";
import { ExchangeDigestUseCase } from "@/core/usecase/ExchangeDigestUseCase";
import { makePost, makeThread, makeThreadStore } from "../helpers/fixtures";

const BOARD_ID = "board-1";
const THREAD_ID = "thread-1";

type DigestHandler = (
	peerId: string,
	boardId: string,
	threads: ThreadDigest[],
) => void;

type SyncHandler = (
	peerId: string,
	boardId: string,
	posts: Post[],
	threads: Thread[],
) => void;

function makeDigestGateway(): {
	mock: IDataSyncGateway;
	triggerDigest: DigestHandler;
	triggerSync: SyncHandler;
} {
	let digestHandler: DigestHandler | null = null;
	let syncHandler: SyncHandler | null = null;

	const mock: IDataSyncGateway = {
		sendDigest: vi.fn(),
		onDigestReceive: vi.fn((handler) => {
			digestHandler = handler;
			return () => {
				digestHandler = null;
			};
		}),
		sendSync: vi.fn(),
		onSyncReceive: vi.fn((handler) => {
			syncHandler = handler;
			return () => {
				syncHandler = null;
			};
		}),
	};

	const triggerDigest: DigestHandler = (peerId, boardId, threads) => {
		digestHandler?.(peerId, boardId, threads);
	};

	const triggerSync: SyncHandler = (peerId, boardId, posts, threads = []) => {
		syncHandler?.(peerId, boardId, posts, threads);
	};

	return { mock, triggerDigest, triggerSync };
}

function makePostStore(posts: Post[] = [makePost()]): IPostStore {
	const threadIds = [...new Set(posts.map((p) => p.threadId))];
	return {
		getSnapshot: vi.fn((threadId: string) =>
			posts.filter((p) => p.threadId === threadId),
		),
		subscribe: vi.fn().mockReturnValue(() => {}),
		save: vi.fn().mockResolvedValue(undefined),
		getThreadIds: vi.fn().mockReturnValue(threadIds),
	};
}

function makeLogger(): ILogger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

function makeUseCase(options?: {
	posts?: Post[];
	clockMap?: LamportClockMap;
	threadStore?: IThreadStore;
}) {
	const clockMap = options?.clockMap ?? new LamportClockMap();
	const logger = makeLogger();
	const store = makePostStore(options?.posts ?? [makePost()]);
	const threadStore = options?.threadStore ?? makeThreadStore();
	const { mock, triggerDigest, triggerSync } = makeDigestGateway();

	const signer = {
		generateKeyPair: vi.fn(),
		sign: vi.fn(),
		signThread: vi.fn(),
	};
	const crypto = new CryptoService(signer);
	vi.spyOn(crypto, "verifySignature").mockResolvedValue(true);
	vi.spyOn(crypto, "verifyPostHash").mockResolvedValue(true);
	const threadSigSpy = vi
		.spyOn(crypto, "verifyThreadSignature")
		.mockResolvedValue(true);
	const ingester = new PostIngester(store, crypto, clockMap, logger);
	const threadIngester = new ThreadIngester(threadStore, crypto, logger);

	const uc = new ExchangeDigestUseCase(
		BOARD_ID,
		store,
		threadStore,
		ingester,
		threadIngester,
		mock,
		clockMap,
		logger,
	);
	return {
		uc,
		mock,
		triggerDigest,
		triggerSync,
		store,
		threadStore,
		clockMap,
		logger,
		threadSigSpy,
	};
}

describe("ExchangeDigestUseCase", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// --- canPost の初期状態 ---

	it("test_canPost_Initial_ReturnsFalse", () => {
		const { uc } = makeUseCase();
		expect(uc.canPost()).toBe(false);
		uc.dispose();
	});

	// --- 1ピアから digest を受信して canPost が true になる ---

	it("test_canPost_SinglePeerDigestReceived_BecomesTrue", () => {
		const { uc, triggerDigest } = makeUseCase();

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 5, postCount: 3 },
		]);

		expect(uc.canPost()).toBe(true);
		uc.dispose();
	});

	// --- 2ピア全員が応答して canPost が true になる ---

	it("test_canPost_AllPeersDigestReceived_BecomesTrue", () => {
		const { uc, triggerDigest } = makeUseCase();

		uc.onPeerConnected("peer-a");
		uc.onPeerConnected("peer-b");
		triggerDigest("peer-a", BOARD_ID, []);

		expect(uc.canPost()).toBe(false); // まだ peer-b が未応答

		triggerDigest("peer-b", BOARD_ID, []);
		expect(uc.canPost()).toBe(true);
		uc.dispose();
	});

	// --- ピアが切断されて pending が空になり canPost が true になる ---

	it("test_canPost_AwaitingPeerDisconnects_BecomesTrue", () => {
		const { uc, triggerDigest } = makeUseCase();

		uc.onPeerConnected("peer-a");
		uc.onPeerConnected("peer-b");
		triggerDigest("peer-a", BOARD_ID, []); // peer-a だけ応答

		expect(uc.canPost()).toBe(false);

		uc.onPeerDisconnected("peer-b"); // peer-b が切断 → awaiting なピアがいなくなる
		expect(uc.canPost()).toBe(true);
		uc.dispose();
	});

	// --- ピアが 0 人では canPost が true にならない ---

	it("test_canPost_NoPeersEverConnected_RemainsFalse", () => {
		const { uc } = makeUseCase();
		expect(uc.canPost()).toBe(false);
		uc.dispose();
	});

	// --- canPost が true になると新規ピアが接続しても変化しない ---

	it("test_canPost_NewPeerAfterEnabled_RemainsTrue", () => {
		const { uc, triggerDigest } = makeUseCase();

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, []);
		expect(uc.canPost()).toBe(true);

		uc.onPeerConnected("peer-b"); // canPost 後の新規接続
		expect(uc.canPost()).toBe(true);
		uc.dispose();
	});

	// --- 接続時に全スレの digest を送信する ---

	it("test_onPeerConnected_SendsDigestToPeer", () => {
		const { uc, mock } = makeUseCase({
			posts: [makePost({ lamport: 3 }), makePost({ id: "p2", lamport: 7 })],
		});

		uc.onPeerConnected("peer-a");

		expect(mock.sendDigest).toHaveBeenCalledWith("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 7, postCount: 2 },
		]);
		uc.dispose();
	});

	it("test_onPeerConnected_MultipleThreads_SendsDigestPerThread", () => {
		const { uc, mock } = makeUseCase({
			posts: [
				makePost({ id: "a1", threadId: "t-a", lamport: 2 }),
				makePost({ id: "b1", threadId: "t-b", lamport: 5 }),
				makePost({ id: "b2", threadId: "t-b", lamport: 9 }),
			],
		});

		uc.onPeerConnected("peer-a");

		const digests = vi.mocked(mock.sendDigest).mock
			.calls[0]?.[2] as ThreadDigest[];
		expect(digests).toEqual(
			expect.arrayContaining([
				{ threadId: "t-a", maxLamport: 2, postCount: 1 },
				{ threadId: "t-b", maxLamport: 9, postCount: 2 },
			]),
		);
		uc.dispose();
	});

	// --- 別板の digest は無視される ---

	it("test_handleDigest_WrongBoardId_Ignored", () => {
		const { uc, triggerDigest, logger } = makeUseCase();

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", "other-board", [
			{ threadId: THREAD_ID, maxLamport: 5, postCount: 3 },
		]);

		expect(uc.canPost()).toBe(false);
		expect(logger.warn).toHaveBeenCalledWith(
			"exchange_digest.wrong_board",
			expect.anything(),
		);
		uc.dispose();
	});

	// --- MAX_LAMPORT を超える値は clock に適用されない ---

	it("test_handleDigest_LamportOverflow_ClockNotUpdated", () => {
		const clockMap = new LamportClockMap();
		const { uc, triggerDigest, logger } = makeUseCase({ clockMap });

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{
				threadId: THREAD_ID,
				maxLamport: LamportClock.MAX_LAMPORT + 1,
				postCount: 0,
			},
		]);

		expect(clockMap.get(THREAD_ID).current()).toBe(0);
		expect(logger.warn).toHaveBeenCalledWith(
			"exchange_digest.lamport_overflow",
			expect.anything(),
		);
		uc.dispose();
	});

	// --- 正常な maxLamport は対応スレの clock に反映される ---

	it("test_handleDigest_ValidLamport_UpdatesPerThreadClock", () => {
		const clockMap = new LamportClockMap();
		const { uc, triggerDigest } = makeUseCase({ clockMap });

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: "t-a", maxLamport: 42, postCount: 10 },
			{ threadId: "t-b", maxLamport: 7, postCount: 2 },
		]);

		expect(clockMap.get("t-a").current()).toBe(42);
		expect(clockMap.get("t-b").current()).toBe(7);
		uc.dispose();
	});

	// --- subscribe の通知 ---

	it("test_subscribe_DigestReceived_NotifiesHandler", () => {
		const { uc, triggerDigest } = makeUseCase();
		const handler = vi.fn();
		uc.subscribe(handler);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, []);

		expect(handler).toHaveBeenCalledOnce();
		uc.dispose();
	});

	it("test_subscribe_AfterUnsubscribe_NotCalled", () => {
		const { uc, triggerDigest } = makeUseCase();
		const handler = vi.fn();
		const unsub = uc.subscribe(handler);
		unsub();

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, []);

		expect(handler).not.toHaveBeenCalled();
		uc.dispose();
	});

	// --- dispose で gateway 購読が解除される ---

	it("test_dispose_StopsDigestSubscription", () => {
		const { uc, triggerDigest } = makeUseCase();

		uc.onPeerConnected("peer-a");
		uc.dispose();

		triggerDigest("peer-a", BOARD_ID, []);
		expect(uc.canPost()).toBe(false);
	});

	// --- ピアが切断してもピア数 0 で応答なしなら canPost のまま false ---

	it("test_canPost_AllPeersDisconnectedWithoutDigest_RemainsFalse", () => {
		const { uc } = makeUseCase();

		uc.onPeerConnected("peer-a");
		uc.onPeerDisconnected("peer-a");

		expect(uc.canPost()).toBe(false);
		uc.dispose();
	});

	// =============================================
	// Story 13b / 15c: Sync Push
	// =============================================

	it("test_syncPush_PeerHasLessPosts_SendsSyncToPeer", async () => {
		// 自分は 3 件持つ。ピアは 0 件（maxLamport=0, postCount=0）
		const myPosts = [
			makePost({ id: "p1", lamport: 1 }),
			makePost({ id: "p2", lamport: 2 }),
			makePost({ id: "p3", lamport: 3 }),
		];
		const { uc, mock, triggerDigest } = makeUseCase({ posts: myPosts });

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);

		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalled());
		const call = vi.mocked(mock.sendSync).mock.calls[0];
		expect(call?.[0]).toBe("peer-a");
		expect(call?.[1]).toBe(BOARD_ID);
		expect(call?.[2]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "p1" }),
				expect.objectContaining({ id: "p2" }),
				expect.objectContaining({ id: "p3" }),
			]),
		);
		uc.dispose();
	});

	it("test_syncPush_PeerMissingThread_AttachesThreadEntity", async () => {
		const thread = makeThread({ threadId: THREAD_ID, boardId: BOARD_ID });
		const myPosts = [makePost({ id: "p1", lamport: 1 })];
		const { uc, mock, triggerDigest } = makeUseCase({
			posts: myPosts,
			threadStore: makeThreadStore([thread]),
		});

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);

		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalled());
		const call = vi.mocked(mock.sendSync).mock.calls[0];
		expect(call?.[3]).toEqual([thread]);
		uc.dispose();
	});

	it("test_syncPush_PeerHasSamePostCount_NoSync", async () => {
		const myPosts = [makePost({ id: "p1", lamport: 1 })];
		const { uc, mock, triggerDigest } = makeUseCase({ posts: myPosts });

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 1, postCount: 1 },
		]);

		await Promise.resolve();
		expect(mock.sendSync).not.toHaveBeenCalled();
		uc.dispose();
	});

	it("test_syncPush_WrongBoardId_NoSync", async () => {
		const myPosts = [makePost({ id: "p1", lamport: 1 })];
		const { uc, mock, triggerDigest } = makeUseCase({ posts: myPosts });

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", "other-board", [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);

		await Promise.resolve();
		expect(mock.sendSync).not.toHaveBeenCalled();
		uc.dispose();
	});

	it("test_syncPush_SameDigestTwice_SendsOnlyOnce", async () => {
		const myPosts = [
			makePost({ id: "p1", lamport: 1 }),
			makePost({ id: "p2", lamport: 2 }),
		];
		const { uc, mock, triggerDigest } = makeUseCase({ posts: myPosts });

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);
		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalledOnce());

		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);
		await Promise.resolve();
		expect(mock.sendSync).toHaveBeenCalledOnce(); // 変化なし
		uc.dispose();
	});

	it("test_syncPush_LargePostSet_SplitsIntoBatches", async () => {
		// 101 件持つ → 2 バッチに分割される（100 件 + 1 件）
		const myPosts = Array.from({ length: 101 }, (_, i) =>
			makePost({ id: `p${i}`, lamport: i + 1 }),
		);
		const { uc, mock, triggerDigest } = makeUseCase({ posts: myPosts });

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);

		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalledTimes(2));
		const calls = vi.mocked(mock.sendSync).mock.calls;
		expect(calls[0]?.[2]).toHaveLength(100);
		expect(calls[1]?.[2]).toHaveLength(1);
		uc.dispose();
	});

	it("test_syncPush_OnlyNewerThreadSynced_PerThreadDedup", async () => {
		// t-a はピアに無く、t-b はピアと同じ → t-a だけ sync する
		const myPosts = [
			makePost({ id: "a1", threadId: "t-a", lamport: 1 }),
			makePost({ id: "b1", threadId: "t-b", lamport: 1 }),
		];
		const { uc, mock, triggerDigest } = makeUseCase({ posts: myPosts });

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: "t-b", maxLamport: 1, postCount: 1 },
		]);

		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalledOnce());
		const call = vi.mocked(mock.sendSync).mock.calls[0];
		expect(call?.[2]?.[0]?.threadId).toBe("t-a");
		uc.dispose();
	});

	it("test_syncPush_PeerDisconnected_ClearsLastSyncedState", async () => {
		const myPosts = [makePost({ id: "p1", lamport: 1 })];
		const { uc, mock, triggerDigest } = makeUseCase({ posts: myPosts });

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);
		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalledOnce());

		uc.onPeerDisconnected("peer-a");
		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);

		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalledTimes(2));
		uc.dispose();
	});

	// =============================================
	// Story 13b / 15c: Sync 受信
	// =============================================

	it("test_syncReceive_ValidPosts_VerifiesAndSaves", async () => {
		const { uc, triggerSync, store } = makeUseCase();
		const incomingPost = makePost({ id: "incoming-1", lamport: 10 });

		triggerSync("peer-a", BOARD_ID, [incomingPost], []);

		await vi.waitFor(() =>
			expect(store.save).toHaveBeenCalledWith(incomingPost),
		);
		uc.dispose();
	});

	it("test_syncReceive_WithThreads_SavesThreadEntity", async () => {
		const { uc, triggerSync, threadStore } = makeUseCase();
		// threadId === String(createdAt) を満たす（makeThread のデフォルト）
		const thread = makeThread({ boardId: BOARD_ID });

		triggerSync("peer-a", BOARD_ID, [], [thread]);

		await vi.waitFor(() =>
			expect(threadStore.save).toHaveBeenCalledWith(thread),
		);
		uc.dispose();
	});

	it("test_syncReceive_InvalidThreadSignature_IgnoresThreadSavesPost", async () => {
		const { uc, triggerSync, threadStore, store, threadSigSpy } = makeUseCase();
		threadSigSpy.mockResolvedValue(false);
		const thread = makeThread({ boardId: BOARD_ID });
		const post = makePost({ id: "incoming-1", lamport: 1 });

		triggerSync("peer-a", BOARD_ID, [post], [thread]);

		await vi.waitFor(() => expect(store.save).toHaveBeenCalledWith(post));
		expect(threadStore.save).not.toHaveBeenCalled();
		uc.dispose();
	});

	it("test_syncReceive_WrongBoardId_Ignored", async () => {
		const { uc, triggerSync, store } = makeUseCase();

		triggerSync(
			"peer-a",
			"other-board",
			[makePost({ id: "x", lamport: 1 })],
			[],
		);

		await Promise.resolve();
		expect(store.save).not.toHaveBeenCalled();
		uc.dispose();
	});

	it("test_syncReceive_TooManyPosts_Rejected", async () => {
		const { uc, triggerSync, store, logger } = makeUseCase();
		const posts = Array.from({ length: 101 }, (_, i) =>
			makePost({ id: `p${i}`, lamport: i + 1 }),
		);
		triggerSync("peer-a", BOARD_ID, posts, []);

		await vi.waitFor(() =>
			expect(logger.warn).toHaveBeenCalledWith(
				"exchange_digest.sync_too_large",
				expect.objectContaining({ count: 101 }),
			),
		);
		expect(store.save).not.toHaveBeenCalled();
		uc.dispose();
	});

	// =============================================
	// Story 13b: 定期 digest 送信
	// =============================================

	it("test_periodicDigest_AfterInterval_SendsDigestToAllPeers", () => {
		const { uc, mock } = makeUseCase();

		uc.onPeerConnected("peer-a");
		uc.onPeerConnected("peer-b");
		vi.mocked(mock.sendDigest).mockClear();

		vi.advanceTimersByTime(10_000);

		expect(mock.sendDigest).toHaveBeenCalledWith(
			"peer-a",
			BOARD_ID,
			expect.any(Array),
		);
		expect(mock.sendDigest).toHaveBeenCalledWith(
			"peer-b",
			BOARD_ID,
			expect.any(Array),
		);
		uc.dispose();
	});

	it("test_periodicDigest_AfterDispose_StopsTimer", () => {
		const { uc, mock } = makeUseCase();

		uc.onPeerConnected("peer-a");
		uc.dispose();
		vi.mocked(mock.sendDigest).mockClear();

		vi.advanceTimersByTime(10_000);

		expect(mock.sendDigest).not.toHaveBeenCalled();
	});

	it("test_periodicDigest_NoConnectedPeers_DoesNotSend", () => {
		const { uc, mock } = makeUseCase();
		vi.mocked(mock.sendDigest).mockClear();

		vi.advanceTimersByTime(10_000);

		expect(mock.sendDigest).not.toHaveBeenCalled();
		uc.dispose();
	});
});
