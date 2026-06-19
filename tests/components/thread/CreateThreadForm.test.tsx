import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MAX_THREAD_TITLE_BYTES } from "@/core/config/constants";
import { CreateThreadForm } from "@/ui/components/thread/CreateThreadForm";

function fillTitle(value: string) {
	fireEvent.change(screen.getByPlaceholderText("スレタイトル"), {
		target: { value },
	});
}
function fillBody(value: string) {
	fireEvent.change(screen.getByPlaceholderText("本文（>>1 になります）"), {
		target: { value },
	});
}

describe("CreateThreadForm", () => {
	it("test_render_EmptyFields_SubmitButtonDisabled", () => {
		render(<CreateThreadForm onSubmit={vi.fn()} />);
		expect(
			(
				screen.getByRole("button", {
					name: "スレを立てる",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("test_submit_TitleAndBody_CallsOnSubmit", () => {
		const onSubmit = vi.fn();
		render(<CreateThreadForm onSubmit={onSubmit} />);
		fillTitle("新スレ");
		fillBody(">>1 だよ");
		fireEvent.click(screen.getByRole("button", { name: "スレを立てる" }));
		expect(onSubmit).toHaveBeenCalledWith("新スレ", "", ">>1 だよ");
	});

	it("test_submit_OnlyTitle_SubmitButtonDisabled", () => {
		render(<CreateThreadForm onSubmit={vi.fn()} />);
		fillTitle("タイトルだけ");
		expect(
			(
				screen.getByRole("button", {
					name: "スレを立てる",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("test_render_TitleExceedsMaxBytes_SubmitButtonDisabled", () => {
		render(<CreateThreadForm onSubmit={vi.fn()} />);
		const over = "あ".repeat(Math.ceil(MAX_THREAD_TITLE_BYTES / 3) + 1);
		fillTitle(over);
		fillBody("本文");
		expect(
			(
				screen.getByRole("button", {
					name: "スレを立てる",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("test_render_DisabledTrue_ShowsSyncingLabel", () => {
		render(<CreateThreadForm onSubmit={vi.fn()} disabled={true} />);
		expect(
			screen.getByRole("button", { name: "ピア接続待ち..." }),
		).toBeTruthy();
	});

	it("test_render_NoticeSet_DisablesFormAndShowsNotice", () => {
		const onSubmit = vi.fn();
		render(
			<CreateThreadForm onSubmit={onSubmit} notice="上限に達しています" />,
		);
		fillTitle("スレ");
		fillBody("本文");
		const button = screen.getByRole("button", {
			name: "作成できません",
		}) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(screen.getByText("上限に達しています")).toBeTruthy();
		fireEvent.click(button);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("test_submit_ValidInput_ClearsTitleAndBody", () => {
		render(<CreateThreadForm onSubmit={vi.fn()} />);
		const title = screen.getByPlaceholderText(
			"スレタイトル",
		) as HTMLInputElement;
		const body = screen.getByPlaceholderText(
			"本文（>>1 になります）",
		) as HTMLTextAreaElement;
		fillTitle("スレ");
		fillBody("本文");
		fireEvent.click(screen.getByRole("button", { name: "スレを立てる" }));
		expect(title.value).toBe("");
		expect(body.value).toBe("");
	});
});
