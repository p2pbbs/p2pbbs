import { LamportClock } from "./LamportClock";

/**
 * スレ単位で LamportClock を管理するマップ。
 * 未知の threadId にアクセスしたとき、lamport 0 の新規 clock を自動生成する。
 */
export class LamportClockMap {
	private readonly clocks = new Map<string, LamportClock>();

	/** 指定 threadId の LamportClock を返す。存在しない場合は新規作成する。 */
	get(threadId: string): LamportClock {
		let clock = this.clocks.get(threadId);
		if (!clock) {
			clock = new LamportClock();
			this.clocks.set(threadId, clock);
		}
		return clock;
	}
}
