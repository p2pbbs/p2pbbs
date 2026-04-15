import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThreadView } from "@/components/thread/ThreadView";
import { makeDisplayPost } from "../../helpers/fixtures";

describe("ThreadView", () => {
	it("test_ThreadView_WithTitle_DisplaysTitle", () => {
		render(<ThreadView title="テストスレ" posts={[]} />);
		expect(screen.getByRole("heading", { name: "テストスレ" })).toBeTruthy();
	});

	it("test_ThreadView_WithPosts_RendersAllPosts", () => {
		const posts = [
			makeDisplayPost({ id: "a", displayNumber: 1, body: "1レス目" }),
			makeDisplayPost({ id: "b", displayNumber: 2, body: "2レス目" }),
			makeDisplayPost({ id: "c", displayNumber: 3, body: "3レス目" }),
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
