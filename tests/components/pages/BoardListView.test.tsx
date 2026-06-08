import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BOARDS } from "@/core/config/constants";
import { BoardListView } from "@/ui/components/pages/BoardListView";

describe("BoardListView", () => {
	it("test_BoardListView_RendersAllBoardsAsLinks", () => {
		render(
			<MemoryRouter>
				<BoardListView />
			</MemoryRouter>,
		);
		for (const board of BOARDS) {
			const link = screen.getByRole("link", { name: new RegExp(board.name) });
			expect(link.getAttribute("href")).toBe(`/board/${board.boardId}`);
		}
	});
});
