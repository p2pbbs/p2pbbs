import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InMemoryPostStore } from "@/core/adapter/storage/InMemoryPostStore";
import type { BoardSession } from "@/ui/bootstrap";
import { ThreadListView } from "@/ui/components/pages/ThreadListView";
import type { Session } from "@/ui/session";
import { BoardSessionProvider, SessionProvider } from "@/ui/session";
import { makePost, makeThread, makeThreadStore } from "../../helpers/fixtures";

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
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		...overrides,
	} as unknown as Session;
}

function makeBoard(overrides: Partial<BoardSession>): BoardSession {
	return {
		boardId: "mona",
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
			makeThread({ threadId: "t1", boardId: "mona", title: "既存スレ" }),
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
		expect(screen.getByRole("button", { name: "同期中..." })).toBeTruthy();
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
});
