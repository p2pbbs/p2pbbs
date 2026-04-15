/**
 * 構造化ログのポート。
 * ブラウザ完結のため実装は console に出力する（ConsoleLogger）。
 * イベントIDで識別する。メッセージ文字列ではなくイベントIDでテスト・検索する。
 */
export interface ILogger {
	info(eventId: string, data?: Record<string, unknown>): void;
	warn(eventId: string, data?: Record<string, unknown>): void;
	error(eventId: string, data?: Record<string, unknown>): void;
}
