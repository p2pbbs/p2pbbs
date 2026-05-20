import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDigestGateway } from "@/core/domain/port/IDigestGateway";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import { LamportClock } from "@/core/domain/service/LamportClock";
import { ExchangeDigestUseCase } from "@/core/usecase/ExchangeDigestUseCase";
import { makePost } from "../helpers/fixtures";

const BOARD_ID = "board-1";
const THREAD_ID = "thread-1";

function makeDigestGateway(): {
	mock: IDigestGateway;
	triggerDigest: (
		peerId: string,
		boardId: string,
		threads: { threadId: string; maxLamport: number; postCount: number }[],
	) => void;
} {
	let digestHandler:
		| ((
				peerId: string,
				boardId: string,
				threads: { threadId: string; maxLamport: number; postCount: number }[],
		  ) => void)
		| null = null;

	const mock: IDigestGateway = {
		sendDigest: vi.fn(),
		onDigestReceive: vi.fn((handler) => {
			digestHandler = handler;
			return () => {
				digestHandler = null;
			};
		}),
	};

	const triggerDigest = (
		peerId: string,
		boardId: string,
		threads: { threadId: string; maxLamport: number; postCount: number }[],
	) => {
		digestHandler?.(peerId, boardId, threads);
	};

	return { mock, triggerDigest };
}

function makePostStore(posts = [makePost()]): IPostStore {
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

describe("ExchangeDigestUseCase", () => {
	let clock: LamportClock;
	let logger: ILogger;

	beforeEach(() => {
		clock = new LamportClock();
		logger = makeLogger();
	});

	// --- canPost の初期状態 ---

	it("test_canPost_Initial_ReturnsFalse", () => {
		const { mock } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);
		expect(uc.canPost()).toBe(false);
		uc.dispose();
	});

	// --- 1ピアから digest を受信して canPost が true になる ---

	it("test_canPost_SinglePeerDigestReceived_BecomesTrue", () => {
		const { mock, triggerDigest } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 5, postCount: 3 },
		]);

		expect(uc.canPost()).toBe(true);
		uc.dispose();
	});

	// --- 2ピア全員が応答して canPost が true になる ---

	it("test_canPost_AllPeersDigestReceived_BecomesTrue", () => {
		const { mock, triggerDigest } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);

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
		const { mock, triggerDigest } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);

		uc.onPeerConnected("peer-a");
		uc.onPeerConnected("peer-b");
		triggerDigest("peer-a", BOARD_ID, []); // peer-a だけ応答

		expect(uc.canPost()).toBe(false);

		uc.onPeerDisconnected("peer-b"); // peer-b が切断 → awaiting なピアがいなくなり、received が 1 件以上あるため canPost = true
		expect(uc.canPost()).toBe(true);
		uc.dispose();
	});

	// --- ピアが 0 人では canPost が true にならない ---

	it("test_canPost_NoPeersEverConnected_RemainseFalse", () => {
		const { mock } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);
		// ピアが接続せずに切断した場合も false のまま
		expect(uc.canPost()).toBe(false);
		uc.dispose();
	});

	// --- canPost が true になると新規ピアが接続しても変化しない ---

	it("test_canPost_NewPeerAfterEnabled_RemainsTrue", () => {
		const { mock, triggerDigest } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, []);
		expect(uc.canPost()).toBe(true);

		uc.onPeerConnected("peer-b"); // canPost 後の新規接続
		expect(uc.canPost()).toBe(true);
		uc.dispose();
	});

	// --- digest 受信時に digest を送信する ---

	it("test_onPeerConnected_SendsDigestToPeer", () => {
		const { mock } = makeDigestGateway();
		const store = makePostStore([
			makePost({ lamport: 3 }),
			makePost({ id: "p2", lamport: 7 }),
		]);
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			store,
			mock,
			clock,
			logger,
		);

		uc.onPeerConnected("peer-a");

		expect(mock.sendDigest).toHaveBeenCalledWith("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 7, postCount: 2 },
		]);
		uc.dispose();
	});

	// --- 別板の digest は無視される ---

	it("test_handleDigest_WrongBoardId_Ignored", () => {
		const { mock, triggerDigest } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", "other-board", [
			{ threadId: THREAD_ID, maxLamport: 5, postCount: 3 },
		]);

		expect(uc.canPost()).toBe(false); // 別板なので pending から除外されない
		expect(logger.warn).toHaveBeenCalledWith(
			"exchange_digest.wrong_board",
			expect.anything(),
		);
		uc.dispose();
	});

	// --- MAX_LAMPORT を超える値は clock に適用されない ---

	it("test_handleDigest_LamportOverflow_ClockNotUpdated", () => {
		const { mock, triggerDigest } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{
				threadId: THREAD_ID,
				maxLamport: LamportClock.MAX_LAMPORT + 1,
				postCount: 0,
			},
		]);

		expect(clock.current()).toBe(0); // MAX_LAMPORT 超過は無視される
		expect(logger.warn).toHaveBeenCalledWith(
			"exchange_digest.lamport_overflow",
			expect.anything(),
		);
		uc.dispose();
	});

	// --- 正常な maxLamport は clock に反映される ---

	it("test_handleDigest_ValidLamport_UpdatesClock", () => {
		const { mock, triggerDigest } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, [
			{ threadId: THREAD_ID, maxLamport: 42, postCount: 10 },
		]);

		expect(clock.current()).toBe(42);
		uc.dispose();
	});

	// --- subscribe の通知 ---

	it("test_subscribe_DigestReceived_NotifiesHandler", () => {
		const { mock, triggerDigest } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);
		const handler = vi.fn();
		uc.subscribe(handler);

		uc.onPeerConnected("peer-a");
		triggerDigest("peer-a", BOARD_ID, []);

		expect(handler).toHaveBeenCalledOnce();
		uc.dispose();
	});

	it("test_subscribe_AfterUnsubscribe_NotCalled", () => {
		const { mock, triggerDigest } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);
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
		const { mock, triggerDigest } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);

		uc.onPeerConnected("peer-a");
		uc.dispose();

		// dispose 後に digest が届いても canPost は変わらない
		triggerDigest("peer-a", BOARD_ID, []);
		expect(uc.canPost()).toBe(false);
	});

	// --- ピアが切断してもピア数 0 で応答なしなら canPost のまま false ---

	it("test_canPost_AllPeersDisconnectedWithoutDigest_RemainsFalse", () => {
		const { mock } = makeDigestGateway();
		const uc = new ExchangeDigestUseCase(
			BOARD_ID,
			THREAD_ID,
			makePostStore(),
			mock,
			clock,
			logger,
		);

		uc.onPeerConnected("peer-a");
		uc.onPeerDisconnected("peer-a"); // 応答なしで切断

		expect(uc.canPost()).toBe(false);
		uc.dispose();
	});
});
