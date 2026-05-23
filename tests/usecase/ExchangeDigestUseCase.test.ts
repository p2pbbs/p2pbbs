import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/core/domain/model/Post";
import type { IDataSyncGateway } from "@/core/domain/port/IDataSyncGateway";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { LamportClock } from "@/core/domain/service/LamportClock";
import { PostIngester } from "@/core/domain/service/PostIngester";
import { ExchangeDigestUseCase } from "@/core/usecase/ExchangeDigestUseCase";
import { makePost } from "../helpers/fixtures";

const BOARD_ID = "board-1";
const THREAD_ID = "thread-1";

type DigestHandler = (
	peerId: string,
	boardId: string,
	threads: { threadId: string; maxLamport: number; postCount: number }[],
) => void;

type SyncHandler = (peerId: string, boardId: string, posts: Post[]) => void;

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

	const triggerSync: SyncHandler = (peerId, boardId, posts) => {
		syncHandler?.(peerId, boardId, posts);
	};

	return { mock, triggerDigest, triggerSync };
}

function makePostStore(posts: Post[] = [makePost()]): IPostStore {
	return {
		getSnapshot: vi.fn().mockReturnValue(posts),
		subscribe: vi.fn().mockReturnValue(() => {}),
		save: vi.fn().mockResolvedValue(undefined),
	};
}

function makeLogger(): ILogger {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

function makePostIngester(
	logger: ILogger,
	clock: LamportClock,
	store: IPostStore,
) {
	const signer = { generateKeyPair: vi.fn(), sign: vi.fn() };
	const crypto = new CryptoService(signer);
	vi.spyOn(crypto, "verifySignature").mockResolvedValue(true);
	vi.spyOn(crypto, "verifyPostHash").mockResolvedValue(true);
	return new PostIngester(store, crypto, clock, logger);
}

function makeUseCase(options?: { posts?: Post[]; clock?: LamportClock }) {
	const clock = options?.clock ?? new LamportClock();
	const logger = makeLogger();
	const store = makePostStore(options?.posts ?? [makePost()]);
	const { mock, triggerDigest, triggerSync } = makeDigestGateway();
	const verifier = makePostIngester(logger, clock, store);
	const uc = new ExchangeDigestUseCase(
		BOARD_ID,
		THREAD_ID,
		store,
		verifier,
		mock,
		clock,
		logger,
	);
	return {
		uc,
		mock,
		triggerDigest,
		triggerSync,
		store,
		clock,
		logger,
		verifier,
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

	// --- 接続時に digest を送信する ---

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
		const clock = new LamportClock();
		const { uc, triggerDigest, logger } = makeUseCase({ clock });

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{
				threadId: THREAD_ID,
				maxLamport: LamportClock.MAX_LAMPORT + 1,
				postCount: 0,
			},
		]);

		expect(clock.current()).toBe(0);
		expect(logger.warn).toHaveBeenCalledWith(
			"exchange_digest.lamport_overflow",
			expect.anything(),
		);
		uc.dispose();
	});

	// --- 正常な maxLamport は clock に反映される ---

	it("test_handleDigest_ValidLamport_UpdatesClock", () => {
		const clock = new LamportClock();
		const { uc, triggerDigest } = makeUseCase({ clock });

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 42, postCount: 10 },
		]);

		expect(clock.current()).toBe(42);
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
	// Story 13b: Sync Push
	// =============================================

	it("test_syncPush_PeerHasLessPosts_SendsSyncToPeer", async () => {
		// 自分は 3 件持つ。ピアは 0 件（maxLamport=0, postCount=0）
		const myPosts = [
			makePost({ id: "p1", lamport: 1 }),
			makePost({ id: "p2", lamport: 2 }),
			makePost({ id: "p3", lamport: 3 }),
		];
		const { uc, mock, triggerDigest, store } = makeUseCase({ posts: myPosts });
		vi.mocked(store.getSnapshot).mockReturnValue(myPosts);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);

		// 非同期の sync push 完了を待つ
		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalled());
		expect(mock.sendSync).toHaveBeenCalledWith(
			"peer-a",
			BOARD_ID,
			expect.arrayContaining([
				expect.objectContaining({ id: "p1" }),
				expect.objectContaining({ id: "p2" }),
				expect.objectContaining({ id: "p3" }),
			]),
		);
		uc.dispose();
	});

	it("test_syncPush_PeerHasSamePostCount_NoSync", async () => {
		const myPosts = [makePost({ id: "p1", lamport: 1 })];
		const { uc, mock, triggerDigest, store } = makeUseCase({ posts: myPosts });
		vi.mocked(store.getSnapshot).mockReturnValue(myPosts);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 1, postCount: 1 },
		]);

		// 少し待っても sendSync は呼ばれない
		await Promise.resolve();
		expect(mock.sendSync).not.toHaveBeenCalled();
		uc.dispose();
	});

	it("test_syncPush_WrongBoardId_NoSync", async () => {
		const myPosts = [makePost({ id: "p1", lamport: 1 })];
		const { uc, mock, triggerDigest, store } = makeUseCase({ posts: myPosts });
		vi.mocked(store.getSnapshot).mockReturnValue(myPosts);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", "other-board", [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);

		await Promise.resolve();
		expect(mock.sendSync).not.toHaveBeenCalled();
		uc.dispose();
	});

	it("test_syncPush_SameDigestTwice_SendsOnlyOnce", async () => {
		// 同じ digest が 2 回届いても、lastSyncedPostCount により 2 回目は送らない
		const myPosts = [
			makePost({ id: "p1", lamport: 1 }),
			makePost({ id: "p2", lamport: 2 }),
		];
		const { uc, mock, triggerDigest, store } = makeUseCase({ posts: myPosts });
		vi.mocked(store.getSnapshot).mockReturnValue(myPosts);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);
		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalledOnce());

		// 同じ digest をもう一度受け取っても 2 回目は送らない
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
		const { uc, mock, triggerDigest, store } = makeUseCase({ posts: myPosts });
		vi.mocked(store.getSnapshot).mockReturnValue(myPosts);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);

		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalledTimes(2));
		const calls = vi.mocked(mock.sendSync).mock.calls as [
			string,
			string,
			Post[],
		][];
		expect(calls[0]?.[2]).toHaveLength(100);
		expect(calls[1]?.[2]).toHaveLength(1);
		uc.dispose();
	});

	it("test_syncPush_PeerDisconnected_ClearsLastSyncedState", async () => {
		// 切断後に再接続すると lastSyncedPostCount がリセットされ再度送信する
		const myPosts = [makePost({ id: "p1", lamport: 1 })];
		const { uc, mock, triggerDigest, store } = makeUseCase({ posts: myPosts });
		vi.mocked(store.getSnapshot).mockReturnValue(myPosts);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);
		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalledOnce());

		// 切断 → 再接続
		uc.onPeerDisconnected("peer-a");
		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 0, postCount: 0 },
		]);

		await vi.waitFor(() => expect(mock.sendSync).toHaveBeenCalledTimes(2));
		uc.dispose();
	});

	// =============================================
	// Story 13b: Sync 受信
	// =============================================

	it("test_syncReceive_ValidPosts_VerifiesAndSaves", async () => {
		const { uc, triggerSync, store } = makeUseCase();
		const incomingPost = makePost({ id: "incoming-1", lamport: 10 });

		triggerSync("peer-a", BOARD_ID, [incomingPost]);

		await vi.waitFor(() =>
			expect(store.save).toHaveBeenCalledWith(incomingPost),
		);
		uc.dispose();
	});

	it("test_syncReceive_WrongBoardId_Ignored", async () => {
		const { uc, triggerSync, store } = makeUseCase();

		triggerSync("peer-a", "other-board", [makePost({ id: "x", lamport: 1 })]);

		await Promise.resolve();
		// store.save は init 時の posts 以外では呼ばれない
		expect(store.save).not.toHaveBeenCalled();
		uc.dispose();
	});

	it("test_syncReceive_TooManyPosts_Rejected", async () => {
		const { uc, triggerSync, store, logger } = makeUseCase();
		// 101 件 → 拒否
		const posts = Array.from({ length: 101 }, (_, i) =>
			makePost({ id: `p${i}`, lamport: i + 1 }),
		);
		// DataChannelMessageSchema が 100 件 max で弾くため gateway は 101 件を受け取らないが、
		// ExchangeDigestUseCase 自体も guard する
		triggerSync("peer-a", BOARD_ID, posts);

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
		// 接続時の sendDigest をリセット
		vi.mocked(mock.sendDigest).mockClear();

		// 10 秒経過
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

		// dispose 後はタイマーが止まり送信しない
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
