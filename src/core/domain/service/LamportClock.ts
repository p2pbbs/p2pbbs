/**
 * Lamport clock。スレ単位で1インスタンス生成して使う。
 * SubmitPostUseCase と ReceiveGossipUseCase で共有する。
 */
export class LamportClock {
	/** スレ最大レス数。この値を超える Lamport 値は safeMerge で拒否する。 */
	static readonly MAX_LAMPORT = 1000;

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

	/** digest 受信時に呼ぶ。MAX_LAMPORT を超える値は無視する。 */
	safeMerge(incoming: number): void {
		if (incoming > LamportClock.MAX_LAMPORT) return;
		this.merge(incoming);
	}

	/** 現在のカウンタ値を返す。 */
	current(): number {
		return this.counter;
	}
}
