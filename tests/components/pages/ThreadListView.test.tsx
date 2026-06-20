import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InMemoryPostStore } from "@/core/adapter/storage/InMemoryPostStore";
import { InMemoryReadHistoryStore } from "@/core/adapter/storage/InMemoryReadHistoryStore";
import type { BoardSession } from "@/ui/bootstrap";
import { ThreadListView } from "@/ui/components/pages/ThreadListView";
import type { Session } from "@/ui/session";
import { BoardSessionProvider, SessionProvider } from "@/ui/session";
import { TEST_BOARD_ID } from "../../helpers/constants";
import {
	makeControllableDigest,
	makePost,
	makeThread,
	makeThreadStore,
} from "../../helpers/fixtures";

function renderView(opts: { session: Session; board: BoardSession }) {
	return render(
		<MemoryRouter>
			<SessionProvider value={opts.session}>
				<BoardSessionProvider value={opts.board}>
					<ThreadListView />
				</BoardSessionProvider>
			</SessionProvider>
		</MemoryRouter>,
	);
}

function makeSession(overrides: Partial<Session>): Session {
	return {
		threadStore: makeThreadStore(),
		postStore: new InMemoryPostStore(),
		readHistory: new InMemoryReadHistoryStore(),
		publicKey: "self-pk",
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		...overrides,
	} as unknown as Session;
}

function makeBoard(overrides: Partial<BoardSession>): BoardSession {
	return {
		boardId: TEST_BOARD_ID,
		exchangeDigestUseCase: {
			canPost: () => true,
			subscribe: () => () => {},
		},
		createThreadUseCase: { execute: vi.fn().mockResolvedValue(undefined) },
		...overrides,
	} as unknown as BoardSession;
}

describe("ThreadListView", () => {
	it("test_ThreadListView_RendersThreadsFromStore", () => {
		const threadStore = makeThreadStore([
			makeThread({ threadId: "t1", boardId: TEST_BOARD_ID, title: "既存スレ" }),
		]);
		const postStore = new InMemoryPostStore(
			new Map([["t1", [makePost({ id: "p1", threadId: "t1", lamport: 1 })]]]),
		);
		renderView({
			session: makeSession({ threadStore, postStore }),
			board: makeBoard({}),
		});
		expect(screen.getByText("既存スレ")).toBeTruthy();
		expect(screen.getByText("1レス")).toBeTruthy();
	});

	it("test_ThreadListView_UnreadPosts_ShowsUnreadBadge", () => {
		const threadStore = makeThreadStore([
			makeThread({ threadId: "t1", boardId: TEST_BOARD_ID, title: "未読あり" }),
		]);
		const postStore = new InMemoryPostStore(
			new Map([
				[
					"t1",
					[
						makePost({ id: "p1", threadId: "t1", lamport: 1 }),
						makePost({ id: "p2", threadId: "t1", lamport: 2 }),
					],
				],
			]),
		);
		// 既読履歴が空 = 未訪問 → 他人の投稿 2 件が未読
		renderView({
			session: makeSession({ threadStore, postStore }),
			board: makeBoard({}),
		});
		expect(screen.getByText("2")).toBeTruthy();
	});

	it("test_ThreadListView_NoUnread_HidesUnreadBadge", () => {
		const threadStore = makeThreadStore([
			makeThread({ threadId: "t1", boardId: TEST_BOARD_ID, title: "既読のみ" }),
		]);
		const postStore = new InMemoryPostStore(
			new Map([["t1", [makePost({ id: "p1", threadId: "t1", lamport: 1 })]]]),
		);
		const readHistory = new InMemoryReadHistoryStore(new Map([["t1", ["p1"]]]));
		renderView({
			session: makeSession({ threadStore, postStore, readHistory }),
			board: makeBoard({}),
		});
		// 既読のみ → 未読バッジ（"0"）は出ない。レス数バッジのみ。
		expect(screen.queryByText("0")).toBeNull();
	});

	it("test_ThreadListView_CreateForm_CallsCreateThreadUseCase", async () => {
		const execute = vi.fn().mockResolvedValue(undefined);
		renderView({
			session: makeSession({}),
			board: makeBoard({
				createThreadUseCase: {
					execute,
				} as unknown as BoardSession["createThreadUseCase"],
			}),
		});
		// スレ作成フォームは FAB で開くモーダル内にある
		fireEvent.click(screen.getByRole("button", { name: "スレ作成" }));
		fireEvent.change(screen.getByPlaceholderText("スレタイトル"), {
			target: { value: "新スレ" },
		});
		fireEvent.change(screen.getByPlaceholderText("本文（>>1 になります）"), {
			target: { value: "本文" },
		});
		fireEvent.click(screen.getByRole("button", { name: "スレを立てる" }));
		expect(execute).toHaveBeenCalledWith({
			title: "新スレ",
			name: "",
			body: "本文",
		});
	});

	it("test_ThreadListView_NotPostable_DisablesCreateForm", () => {
		renderView({
			session: makeSession({}),
			board: makeBoard({
				exchangeDigestUseCase: {
					canPost: () => false,
					subscribe: () => () => {},
				} as unknown as BoardSession["exchangeDigestUseCase"],
			}),
		});
		fireEvent.click(screen.getByRole("button", { name: "スレ作成" }));
		expect(
			screen.getByRole("button", { name: "ピア接続待ち..." }),
		).toBeTruthy();
	});

	it("test_ThreadListView_FabClosed_FormNotVisible", () => {
		renderView({ session: makeSession({}), board: makeBoard({}) });
		// FAB を開くまでフォームは表示されない
		expect(screen.queryByPlaceholderText("スレタイトル")).toBeNull();
	});

	it("test_ThreadListView_EmptyBoard_ShowsEmptyMessage", () => {
		renderView({ session: makeSession({}), board: makeBoard({}) });
		expect(screen.getByText(/まだスレがありません/)).toBeTruthy();
	});

	it("test_ThreadListView_UndisplayedPostArrives_RefreshButtonLights", async () => {
		const threadStore = makeThreadStore([
			makeThread({ threadId: "t1", boardId: TEST_BOARD_ID, title: "既存スレ" }),
		]);
		const postStore = new InMemoryPostStore(
			new Map([["t1", [makePost({ id: "p1", threadId: "t1", lamport: 1 })]]]),
		);
		renderView({
			session: makeSession({ threadStore, postStore }),
			board: makeBoard({}),
		});

		// 入場時は neutral
		expect(screen.getByRole("button", { name: "更新" })).toBeTruthy();

		// 板内のいずれかのスレへ未反映レスが届くと点灯
		await act(async () => {
			await postStore.save(
				makePost({
					id: "p2",
					boardId: TEST_BOARD_ID,
					threadId: "t1",
					lamport: 2,
				}),
			);
		});
		const lit = screen.getByRole("button", {
			name: "未反映のレスがあります。更新",
		});
		expect(lit).toBeTruthy();

		// 押下で消灯する
		await act(async () => {
			fireEvent.click(lit);
		});
		expect(screen.getByRole("button", { name: "更新" })).toBeTruthy();
	});

	it("test_ThreadListView_EmptyBoardThenArrival_LightsThenTapShowsAndClears", async () => {
		// 空表示からの導線（主役挙動）: 空 → save 到着で点灯 → タップで描画＋消灯
		const threadStore = makeThreadStore();
		const postStore = new InMemoryPostStore();
		renderView({
			session: makeSession({ threadStore, postStore }),
			board: makeBoard({}),
		});
		expect(screen.getByText(/まだスレがありません/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "更新" })).toBeTruthy();

		// 新スレの >>1 が届く（Thread エンティティも同時着）→ 点灯。一覧はまだ空のまま。
		await act(async () => {
			await threadStore.save(
				makeThread({ threadId: "t1", boardId: TEST_BOARD_ID, title: "新スレ" }),
			);
			await postStore.save(
				makePost({ id: "p1", boardId: TEST_BOARD_ID, threadId: "t1" }),
			);
		});
		expect(
			screen.getByRole("button", { name: "未反映のレスがあります。更新" }),
		).toBeTruthy();
		expect(screen.queryByText("新スレ")).toBeNull();

		// タップで一覧へ取り込み、ボタンは neutral へ
		await act(async () => {
			fireEvent.click(
				screen.getByRole("button", { name: "未反映のレスがあります。更新" }),
			);
		});
		expect(screen.getByText("新スレ")).toBeTruthy();
		expect(screen.getByRole("button", { name: "更新" })).toBeTruthy();
	});

	it("test_ThreadListView_ArrivalBeforeCanPostFlip_StaysNeutral", async () => {
		// 速い順での stuck-lit 回避: sync 到着 → その後 canPost flip → neutral であること。
		// auto-refresh の clear() を守る回帰テスト（refresh 単体では baseline が古く点灯したまま）。
		const digest = makeControllableDigest(false);
		const threadStore = makeThreadStore();
		const postStore = new InMemoryPostStore();
		renderView({
			session: makeSession({ threadStore, postStore }),
			board: makeBoard({
				exchangeDigestUseCase:
					digest as unknown as BoardSession["exchangeDigestUseCase"],
			}),
		});

		// canPost flip より前に sync 分が届く。
		await act(async () => {
			await threadStore.save(
				makeThread({
					threadId: "t1",
					boardId: TEST_BOARD_ID,
					title: "既存スレ",
				}),
			);
			await postStore.save(
				makePost({ id: "p1", boardId: TEST_BOARD_ID, threadId: "t1" }),
			);
		});
		// 【回帰の本体】flip 前に必ず一度点灯することを assert する。これが無いと
		// 「最初から点かない」経路と区別できず、flip 由来の消灯を検出できなくなる。
		expect(
			screen.getByRole("button", { name: "未反映のレスがあります。更新" }),
		).toBeTruthy();

		// canPost flip → 初回 auto-refresh + clear が走り、ボタンは neutral へ戻る
		await act(async () => {
			digest.flip();
		});
		expect(screen.getByRole("button", { name: "更新" })).toBeTruthy();
	});

	it("test_ThreadListView_SelfCreateThread_DoesNotStayLit", async () => {
		// 自分のスレ作成では点灯したままにならない（作成 → refreshAndClear で消灯）。
		const threadStore = makeThreadStore();
		const postStore = new InMemoryPostStore();
		// createThreadUseCase.execute が自分の >>1 を board へ save するのを再現する
		const execute = vi.fn(async () => {
			await postStore.save(
				makePost({
					id: "mine",
					boardId: TEST_BOARD_ID,
					threadId: "self-thread",
				}),
			);
		});
		renderView({
			session: makeSession({ threadStore, postStore }),
			board: makeBoard({
				createThreadUseCase: {
					execute,
				} as unknown as BoardSession["createThreadUseCase"],
			}),
		});

		fireEvent.click(screen.getByRole("button", { name: "スレ作成" }));
		fireEvent.change(screen.getByPlaceholderText("スレタイトル"), {
			target: { value: "自スレ" },
		});
		fireEvent.change(screen.getByPlaceholderText("本文（>>1 になります）"), {
			target: { value: "本文" },
		});
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "スレを立てる" }));
		});

		expect(execute).toHaveBeenCalled();
		// 自分の save で一瞬点灯しても .then(refreshAndClear) で neutral に戻る
		expect(screen.getByRole("button", { name: "更新" })).toBeTruthy();
	});
});
