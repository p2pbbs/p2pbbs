/**
 * DataChannel 接続のハートビート管理。
 * 30 秒ごとに全ピアへ heartbeat を送信し、
 * 90 秒以内に相手からの heartbeat が届かなければ dead と判定する。
 *
 * 両端が独立して送り合うため、片方だけ生きている場合も検知できる。
 */
export class HeartbeatTracker {
	private readonly lastSeen = new Map<string, number>();
	private readonly sendHeartbeat: (peerId: string) => void;
	private readonly onDead: (peerId: string) => void;
	private readonly intervalMs: number;
	private readonly timeoutMs: number;
	private intervalId: ReturnType<typeof setInterval> | null = null;

	constructor(
		sendHeartbeat: (peerId: string) => void,
		onDead: (peerId: string) => void,
		intervalMs: number,
		timeoutMs: number,
	) {
		this.sendHeartbeat = sendHeartbeat;
		this.onDead = onDead;
		this.intervalMs = intervalMs;
		this.timeoutMs = timeoutMs;
	}

	start(getPeerIds: () => string[]): void {
		this.intervalId = setInterval(() => {
			const now = Date.now();
			for (const peerId of getPeerIds()) {
				this.sendHeartbeat(peerId);
			}
			for (const [peerId, last] of this.lastSeen) {
				if (now - last > this.timeoutMs) {
					this.lastSeen.delete(peerId);
					this.onDead(peerId);
				}
			}
		}, this.intervalMs);
	}

	/** ピアとの接続確立時に呼ぶ。タイムアウト計測を開始する。 */
	trackPeer(peerId: string): void {
		this.lastSeen.set(peerId, Date.now());
	}

	/** 相手から heartbeat を受信したときに呼ぶ。タイムアウトをリセットする。 */
	receiveFrom(peerId: string): void {
		this.lastSeen.set(peerId, Date.now());
	}

	/** ピア切断時に呼ぶ。追跡から除去する。 */
	removePeer(peerId: string): void {
		this.lastSeen.delete(peerId);
	}

	stop(): void {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}
}
