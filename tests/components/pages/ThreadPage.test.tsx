import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InMemoryPostStore } from "@/core/adapter/storage/InMemoryPostStore";
import type { BoardSession } from "@/ui/bootstrap";
import { ThreadPage } from "@/ui/components/pages/ThreadPage";
import type { Session } from "@/ui/session";
import { BoardSessionProvider, SessionProvider } from "@/ui/session";
import { TEST_BOARD_ID } from "../../helpers/constants";
import { makePost, makeThread, makeThreadStore } from "../../helpers/fixtures";

function renderPage(opts: {
	session: Session;
	board: BoardSession;
	threadId: string;
}) {
	return render(
		<MemoryRouter initialEntries={[`/board/${TEST_BOARD_ID}/${opts.threadId}`]}>
			<SessionProvider value={opts.session}>
				<BoardSessionProvider value={opts.board}>
					<Routes>
						<Route path="/board/:boardId/:threadId" element={<ThreadPage />} />
					</Routes>
				</BoardSessionProvider>
			</SessionProvider>
		</MemoryRouter>,
	);
}

function makeSession(overrides: Partial<Session>): Session {
	return {
		threadStore: makeThreadStore(),
		postStore: new InMemoryPostStore(),
		crypto: {},
		clockMap: {},
		peerId: "self",
		publicKey: "pk",
		odId: "od",
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		...overrides,
	} as unknown as Session;
}

function makeBoard(): BoardSession {
	return {
		boardId: TEST_BOARD_ID,
		gateway: {},
		exchangeDigestUseCase: {
			canPost: () => true,
			subscribe: () => () => {},
		},
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
			session: makeSession({ threadStore, postStore }),
			board: makeBoard(),
			threadId: "t1",
		});
		expect(screen.getByRole("heading", { name: "テストスレ" })).toBeTruthy();
		expect(screen.getByText("最初のレス")).toBeTruthy();
	});

	it("test_ThreadPage_UnknownThread_ShowsNotFound", () => {
		renderPage({
			session: makeSession({}),
			board: makeBoard(),
			threadId: "nonexistent",
		});
		expect(screen.getByText("スレが見つかりません")).toBeTruthy();
	});
});
