import { describe, expect, it } from "vitest";
import { ThreadSchema } from "@/core/domain/model/Thread";
import { TEST_BOARD_ID, TEST_THREAD_ID } from "../../helpers/constants";

function makeValidThread(overrides: Record<string, unknown> = {}) {
	return {
		threadId: TEST_THREAD_ID,
		boardId: TEST_BOARD_ID,
		title: "テストスレ",
		createdAt: 1700000000000,
		signature: "valid-sig",
		publicKey: "valid-pubkey",
		...overrides,
	};
}

describe("ThreadSchema", () => {
	describe("有効なスレ", () => {
		it("test_parse_ValidThread_Succeeds", () => {
			const result = ThreadSchema.safeParse(makeValidThread());
			expect(result.success).toBe(true);
		});

		it("test_parse_TitleExactly150Bytes_Succeeds", () => {
			// 150 bytes = 50 文字の全角（各 3 bytes）
			const title = "あ".repeat(50);
			expect(new TextEncoder().encode(title).byteLength).toBe(150);
			const result = ThreadSchema.safeParse(makeValidThread({ title }));
			expect(result.success).toBe(true);
		});

		it("test_parse_TitleASCII_Succeeds", () => {
			const result = ThreadSchema.safeParse(
				makeValidThread({ title: "hello" }),
			);
			expect(result.success).toBe(true);
		});
	});

	describe("タイトルバイト長バリデーション", () => {
		it("test_parse_EmptyTitle_Fails", () => {
			const result = ThreadSchema.safeParse(makeValidThread({ title: "" }));
			expect(result.success).toBe(false);
		});

		it("test_parse_Title151Bytes_Fails", () => {
			// 151 bytes: 50 全角 + 1 ASCII（= 150 + 1 = 151）
			const title = "あ".repeat(50) + "a";
			expect(new TextEncoder().encode(title).byteLength).toBe(151);
			const result = ThreadSchema.safeParse(makeValidThread({ title }));
			expect(result.success).toBe(false);
		});

		it("test_parse_TitleFarOver150Bytes_Fails", () => {
			const title = "あ".repeat(100); // 300 bytes
			const result = ThreadSchema.safeParse(makeValidThread({ title }));
			expect(result.success).toBe(false);
		});
	});

	describe("必須フィールドバリデーション", () => {
		it("test_parse_MissingThreadId_Fails", () => {
			const { threadId: _, ...rest } = makeValidThread();
			const result = ThreadSchema.safeParse(rest);
			expect(result.success).toBe(false);
		});

		it("test_parse_MissingBoardId_Fails", () => {
			const { boardId: _, ...rest } = makeValidThread();
			const result = ThreadSchema.safeParse(rest);
			expect(result.success).toBe(false);
		});

		it("test_parse_NegativeCreatedAt_Fails", () => {
			const result = ThreadSchema.safeParse(makeValidThread({ createdAt: -1 }));
			expect(result.success).toBe(false);
		});

		it("test_parse_FloatCreatedAt_Fails", () => {
			const result = ThreadSchema.safeParse(
				makeValidThread({ createdAt: 1.5 }),
			);
			expect(result.success).toBe(false);
		});
	});

	describe("readonly", () => {
		it("test_parse_ParsedObject_IsFrozen", () => {
			const result = ThreadSchema.safeParse(makeValidThread());
			if (!result.success) throw new Error("parse failed");
			// zod の .readonly() は Object.freeze を適用する
			expect(Object.isFrozen(result.data)).toBe(true);
		});
	});
});
