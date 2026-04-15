import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PostItem } from "@/components/thread/PostItem";
import { DEFAULT_NAME } from "@/config/constants";
import { makeDisplayPost } from "../../helpers/fixtures";

describe("PostItem", () => {
	it("test_PostItem_WithAllFields_DisplaysNumberNameBodyOdId", () => {
		render(
			<PostItem
				post={makeDisplayPost({
					displayNumber: 42,
					name: "テスト太郎",
					body: "本文です",
					odId: "abc12345",
				})}
			/>,
		);
		expect(screen.getByText("42")).toBeTruthy();
		expect(screen.getByText("テスト太郎")).toBeTruthy();
		expect(screen.getByText("本文です")).toBeTruthy();
		expect(screen.getByText(/ID:abc12345/)).toBeTruthy();
	});

	it("test_PostItem_EmptyName_ShowsDefaultName", () => {
		render(<PostItem post={makeDisplayPost({ name: "" })} />);
		expect(screen.getByText(DEFAULT_NAME)).toBeTruthy();
	});

	it("test_PostItem_ScriptTagInBody_RenderedAsText", () => {
		render(
			<PostItem
				post={makeDisplayPost({ body: "<script>alert(1)</script>" })}
			/>,
		);
		expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
		expect(document.querySelector("script")).toBeNull();
	});

	it("test_PostItem_EmptyBody_RendersWithoutCrash", () => {
		render(
			<PostItem post={makeDisplayPost({ displayNumber: 42, body: "" })} />,
		);
		expect(screen.getByText("42")).toBeTruthy();
	});

	it("test_PostItem_Timestamp_RenderedInTimeElement", () => {
		render(<PostItem post={makeDisplayPost()} />);
		const timeEl = document.querySelector("time");
		expect(timeEl).not.toBeNull();
		expect(timeEl?.getAttribute("dateTime")).toBeTruthy();
	});
});
