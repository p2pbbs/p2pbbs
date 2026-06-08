import type { ILogger } from "@/core/domain/port/ILogger";

/**
 * ILogger の console 実装。ブラウザの DevTools に構造化ログを出力する。
 * イベントIDで識別する。メッセージ文字列ではなくイベントIDで検索する。
 */
export class ConsoleLogger implements ILogger {
	debug(eventId: string, data?: Record<string, unknown>): void {
		console.debug(`[nch] ${eventId}`, data ?? "");
	}

	info(eventId: string, data?: Record<string, unknown>): void {
		console.info(`[nch] ${eventId}`, data ?? "");
	}

	warn(eventId: string, data?: Record<string, unknown>): void {
		console.warn(`[nch] ${eventId}`, data ?? "");
	}

	error(eventId: string, data?: Record<string, unknown>): void {
		console.error(`[nch] ${eventId}`, data ?? "");
	}
}
