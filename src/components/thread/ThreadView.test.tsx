import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makePost } from "../../../tests/helpers/fixtures";
import { ThreadView } from "./ThreadView";

describe("ThreadView", () => {
	it("test_ThreadView_WithTitle_DisplaysTitle", () => {
		render(<ThreadView title="テストスレ" posts={[]} />);
		expect(screen.getByRole("heading", { name: "テストスレ" })).toBeTruthy();
	});

	it("test_ThreadView_WithPosts_RendersAllPosts", () => {
		const posts = [
			makePost({ id: "a", number: 1, body: "1レス目" }),
			makePost({ id: "b", number: 2, body: "2レス目" }),
			makePost({ id: "c", number: 3, body: "3レス目" }),
		];
		render(<ThreadView title="スレ" posts={posts} />);
		expect(screen.getByText("1レス目")).toBeTruthy();
		expect(screen.getByText("2レス目")).toBeTruthy();
		expect(screen.getByText("3レス目")).toBeTruthy();
	});

	it("test_ThreadView_EmptyPosts_RendersOnlyTitle", () => {
		render(<ThreadView title="空スレ" posts={[]} />);
		expect(screen.queryByRole("article")).toBeNull();
	});
});
