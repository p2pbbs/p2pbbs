/**
 * Lamport clock。スレ単位で1インスタンス生成して使う。
 * PostMessageUseCase と ReceiveMessageUseCase で共有する。
 */
export class LamportClock {
	private counter = 0;

	/** 投稿時に呼ぶ。カウンタをインクリメントして返す。 */
	tick(): number {
		this.counter += 1;
		return this.counter;
	}

	/** 受信時に呼ぶ。max(self, received) でカウンタを更新する。+1 しない。 */
	merge(received: number): void {
		if (received > this.counter) {
			this.counter = received;
		}
	}

	/** 現在のカウンタ値を返す。 */
	current(): number {
		return this.counter;
	}
}
