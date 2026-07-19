import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InMemoryPostStore } from "@/core/adapter/storage/InMemoryPostStore";
import { InMemoryReadHistoryStore } from "@/core/adapter/storage/InMemoryReadHistoryStore";
import type { BoardSession } from "@/ui/bootstrap";
import { ThreadPage } from "@/ui/components/pages/ThreadPage";
import type { NodeContext } from "@/ui/nodeContext";
import { BoardSessionProvider, NodeContextProvider } from "@/ui/nodeContext";
import { TEST_BOARD_ID } from "../../helpers/constants";
import {
	makeControllableDigest,
	makePost,
	makeThread,
	makeThreadStore,
} from "../../helpers/fixtures";

function renderPage(opts: {
	nodeCtx: NodeContext;
	board: BoardSession;
	threadId: string;
}) {
	return render(
		<MemoryRouter initialEntries={[`/board/${TEST_BOARD_ID}/${opts.threadId}`]}>
			<NodeContextProvider value={opts.nodeCtx}>
				<BoardSessionProvider value={opts.board}>
					<Routes>
						<Route path="/board/:boardId/:threadId" element={<ThreadPage />} />
					</Routes>
				</BoardSessionProvider>
			</NodeContextProvider>
		</MemoryRouter>,
	);
}

function makeNodeContext(overrides: Partial<NodeContext>): NodeContext {
	return {
		threadStore: makeThreadStore(),
		postStore: new InMemoryPostStore(),
		readHistory: new InMemoryReadHistoryStore(),
		crypto: {},
		clockMap: {},
		peerId: "self",
		publicKey: "pk",
		odId: "od",
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		...overrides,
	} as unknown as NodeContext;
}

function makeBoard(overrides: Partial<BoardSession> = {}): BoardSession {
	return {
		boardId: TEST_BOARD_ID,
		gateway: {},
		exchangeDigestUseCase: {
			canPost: () => true,
			subscribe: () => () => {},
		},
		...overrides,
	} as unknown as BoardSession;
}

describe("ThreadPage", () => {
	it("test_ThreadPage_ExistingThread_RendersTitleAndPosts", () => {
		const threadStore = makeThreadStore([
			makeThread({
				threadId: "t1",
				boardId: TEST_BOARD_ID,
				title: "テストスレ",
			}),
		]);
		const postStore = new InMemoryPostStore(
			new Map([
				[
					"t1",
					[
						makePost({
							id: "p1",
							threadId: "t1",
							lamport: 1,
							body: "最初のレス",
						}),
					],
				],
			]),
		);
		renderPage({
			nodeCtx: makeNodeContext({ threadStore, postStore }),
			board: makeBoard(),
			threadId: "t1",
		});
		expect(screen.getByRole("heading", { name: "テストスレ" })).toBeTruthy();
		expect(screen.getByText("最初のレス")).toBeTruthy();
	});

	it("test_ThreadPage_UndisplayedPostArrives_RefreshButtonLights", async () => {
		const threadStore = makeThreadStore([
			makeThread({ threadId: "t1", boardId: TEST_BOARD_ID, title: "スレ" }),
		]);
		const postStore = new InMemoryPostStore(
			new Map([
				[
					"t1",
					[makePost({ id: "p1", threadId: "t1", lamport: 1, body: "既存" })],
				],
			]),
		);
		renderPage({
			nodeCtx: makeNodeContext({ threadStore, postStore }),
			board: makeBoard(),
			threadId: "t1",
		});

		// 入場時は neutral（更新ボタンに未反映の手がかりなし）
		expect(screen.getByRole("button", { name: "更新" })).toBeTruthy();

		// 未反映レスがストアへ届くと点灯（aria-label が変わる）
		await act(async () => {
			await postStore.save(
				makePost({ id: "p2", threadId: "t1", lamport: 2, body: "新着" }),
			);
		});
		const lit = screen.getByRole("button", {
			name: "未反映のレスがあります。更新",
		});
		expect(lit).toBeTruthy();

		// 押下で取り込み＆消灯し、新着が表示される
		await act(async () => {
			fireEvent.click(lit);
		});
		expect(screen.getByRole("button", { name: "更新" })).toBeTruthy();
		expect(screen.getByText("新着")).toBeTruthy();
	});

	it("test_ThreadPage_ArrivalBeforeCanPostFlip_StaysNeutral", async () => {
		// 速い順での stuck-lit 回避: sync 到着 → その後 canPost flip → neutral であること。
		// auto-refresh の clear() を守る回帰テスト（refresh 単体では baseline が古く点灯したまま）。
		const digest = makeControllableDigest(false);
		const threadStore = makeThreadStore([
			makeThread({ threadId: "t1", boardId: TEST_BOARD_ID, title: "スレ" }),
		]);
		const postStore = new InMemoryPostStore(
			new Map([
				[
					"t1",
					[makePost({ id: "p1", threadId: "t1", lamport: 1, body: "既存" })],
				],
			]),
		);
		renderPage({
			nodeCtx: makeNodeContext({ threadStore, postStore }),
			board: makeBoard({
				exchangeDigestUseCase:
					digest as unknown as BoardSession["exchangeDigestUseCase"],
			}),
			threadId: "t1",
		});

		// canPost flip より前に sync 分が届く。
		await act(async () => {
			await postStore.save(
				makePost({ id: "p2", threadId: "t1", lamport: 2, body: "sync分" }),
			);
		});
		// 【回帰の本体】flip 前に必ず一度点灯することを assert する。これが無いと
		// 「最初から点かない」経路と区別できず、flip 由来の消灯を検出できなくなる。
		expect(
			screen.getByRole("button", { name: "未反映のレスがあります。更新" }),
		).toBeTruthy();

		// canPost flip → 初回 auto-refresh + clear が走り neutral へ戻る（取り込みも済む）
		await act(async () => {
			digest.flip();
		});
		expect(screen.getByRole("button", { name: "更新" })).toBeTruthy();
		expect(screen.getByText("sync分")).toBeTruthy();
	});

	it("test_ThreadPage_UnknownThread_ShowsNotFound", () => {
		renderPage({
			nodeCtx: makeNodeContext({}),
			board: makeBoard(),
			threadId: "nonexistent",
		});
		expect(screen.getByText("スレが見つかりません")).toBeTruthy();
	});
});
