/**
 * エラーの回復戦略。
 * - retry: Adapter 層で自動リトライし、UseCase には最終結果のみ返す
 * - ignore: 不正メッセージを捨ててログに記録。ユーザーには見せない
 * - fatal: UI まで伝播して表示する
 */
export type ErrorRecovery = "retry" | "ignore" | "fatal";

/** nch ドメインエラー。code + recovery + message の3要素で分類する。 */
export class NchError extends Error {
	readonly code: string;
	readonly recovery: ErrorRecovery;

	constructor(code: string, recovery: ErrorRecovery, message: string) {
		super(message);
		this.name = "NchError";
		this.code = code;
		this.recovery = recovery;
	}
}
