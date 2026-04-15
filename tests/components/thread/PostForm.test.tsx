import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PostForm } from "@/components/thread/PostForm";
import { MAX_POST_BYTES } from "@/config/constants";

describe("PostForm", () => {
	it("test_render_EmptyBody_SubmitButtonDisabled", () => {
		render(<PostForm onSubmit={vi.fn()} />);
		expect(
			(screen.getByRole("button", { name: "書き込む" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("test_submit_ValidBody_CallsOnSubmit", () => {
		const onSubmit = vi.fn();
		render(<PostForm onSubmit={onSubmit} />);
		fireEvent.change(screen.getByPlaceholderText("本文を入力..."), {
			target: { value: "テスト本文" },
		});
		fireEvent.click(screen.getByRole("button", { name: "書き込む" }));
		expect(onSubmit).toHaveBeenCalledWith("", "テスト本文");
	});

	it("test_submit_WithName_PassesNameToOnSubmit", () => {
		const onSubmit = vi.fn();
		render(<PostForm onSubmit={onSubmit} />);
		fireEvent.change(screen.getByPlaceholderText("名無しさん"), {
			target: { value: "Alice" },
		});
		fireEvent.change(screen.getByPlaceholderText("本文を入力..."), {
			target: { value: "本文" },
		});
		fireEvent.click(screen.getByRole("button", { name: "書き込む" }));
		expect(onSubmit).toHaveBeenCalledWith("Alice", "本文");
	});

	it("test_submit_ValidBody_ClearsBodyAfterSubmit", () => {
		render(<PostForm onSubmit={vi.fn()} />);
		const textarea = screen.getByPlaceholderText("本文を入力...");
		fireEvent.change(textarea, { target: { value: "本文" } });
		fireEvent.click(screen.getByRole("button", { name: "書き込む" }));
		expect((textarea as HTMLTextAreaElement).value).toBe("");
	});

	it("test_render_BodyExceedsMaxBytes_SubmitButtonDisabled", () => {
		render(<PostForm onSubmit={vi.fn()} />);
		// "あ" は UTF-8 で 3 bytes。MAX_POST_BYTES / 3 + 1 文字で確実に超過
		const over = "あ".repeat(Math.ceil(MAX_POST_BYTES / 3) + 1);
		fireEvent.change(screen.getByPlaceholderText("本文を入力..."), {
			target: { value: over },
		});
		expect(
			(screen.getByRole("button", { name: "書き込む" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("test_render_WhitespaceOnlyBody_SubmitButtonDisabled", () => {
		render(<PostForm onSubmit={vi.fn()} />);
		fireEvent.change(screen.getByPlaceholderText("本文を入力..."), {
			target: { value: "   " },
		});
		expect(
			(screen.getByRole("button", { name: "書き込む" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});
