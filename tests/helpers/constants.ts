/** 既定のテスト板 ID。実在板(mona/yaruo)とは独立。 */
export const TEST_BOARD_ID = "test-board";
/** クロスボード判定テスト用の第2板 ID（旧 "yaruo"）。 */
export const TEST_BOARD_ID_ALT = "test-board-alt";
/** 既定のテストスレ作成時刻。 */
export const TEST_THREAD_CREATED_AT = 1700000000000;
/**
 * 既定のテストスレ ID（旧 "thread-1" / "1700000000000"）。
 * ドメインの genesis ルール上 threadId === String(createdAt) を満たす必要があるため、
 * TEST_THREAD_CREATED_AT から導出する。
 */
export const TEST_THREAD_ID = String(TEST_THREAD_CREATED_AT);
/** 既定のテストスレタイトル。 */
export const TEST_THREAD_TITLE = "テストスレ";
