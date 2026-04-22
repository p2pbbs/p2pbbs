import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeartbeatTracker } from "@/core/domain/service/HeartbeatTracker";

const INTERVAL_MS = 30_000;
const TIMEOUT_MS = 90_000;

describe("HeartbeatTracker", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function makeTracker() {
		const sendHeartbeat = vi.fn();
		const onDead = vi.fn();
		const tracker = new HeartbeatTracker(
			sendHeartbeat,
			onDead,
			INTERVAL_MS,
			TIMEOUT_MS,
		);
		return { tracker, sendHeartbeat, onDead };
	}

	it("test_start_onInterval_sendsHeartbeatToAllPeers", () => {
		const { tracker, sendHeartbeat } = makeTracker();
		tracker.start(() => ["peer-a", "peer-b"]);

		vi.advanceTimersByTime(INTERVAL_MS);

		expect(sendHeartbeat).toHaveBeenCalledWith("peer-a");
		expect(sendHeartbeat).toHaveBeenCalledWith("peer-b");
	});

	it("test_start_noPeers_doesNotCallSend", () => {
		const { tracker, sendHeartbeat } = makeTracker();
		tracker.start(() => []);

		vi.advanceTimersByTime(INTERVAL_MS);

		expect(sendHeartbeat).not.toHaveBeenCalled();
	});

	it("test_receiveFrom_resetsTimeout_doesNotCallOnDead", () => {
		const { tracker, onDead } = makeTracker();
		tracker.trackPeer("peer-a");
		tracker.start(() => ["peer-a"]);

		// 60 秒経過したところで heartbeat を受信する
		vi.advanceTimersByTime(60_000);
		tracker.receiveFrom("peer-a");

		// さらに 60 秒経過（合計 120 秒）しても受信から 60 秒なので dead にならない
		vi.advanceTimersByTime(60_000);

		expect(onDead).not.toHaveBeenCalled();
	});

	it("test_noHeartbeat_afterTimeout_callsOnDead", () => {
		const { tracker, onDead } = makeTracker();
		tracker.trackPeer("peer-a");
		tracker.start(() => ["peer-a"]);

		// タイムアウト + 1 インターバル分経過
		vi.advanceTimersByTime(TIMEOUT_MS + INTERVAL_MS);

		expect(onDead).toHaveBeenCalledWith("peer-a");
	});

	it("test_removePeer_beforeTimeout_doesNotCallOnDead", () => {
		const { tracker, onDead } = makeTracker();
		tracker.trackPeer("peer-a");
		tracker.start(() => []);

		tracker.removePeer("peer-a");
		vi.advanceTimersByTime(TIMEOUT_MS + INTERVAL_MS);

		expect(onDead).not.toHaveBeenCalled();
	});

	it("test_stop_cancelsInterval_noMoreHeartbeats", () => {
		const { tracker, sendHeartbeat } = makeTracker();
		tracker.start(() => ["peer-a"]);

		vi.advanceTimersByTime(INTERVAL_MS);
		expect(sendHeartbeat).toHaveBeenCalledTimes(1);

		tracker.stop();
		vi.advanceTimersByTime(INTERVAL_MS * 3);

		// stop 後はカウントが増えない
		expect(sendHeartbeat).toHaveBeenCalledTimes(1);
	});

	it("test_multiplePeers_onlyDeadPeerTriggersOnDead", () => {
		const { tracker, onDead } = makeTracker();
		tracker.trackPeer("peer-a");
		tracker.trackPeer("peer-b");
		tracker.start(() => ["peer-a", "peer-b"]);

		// peer-b だけ heartbeat を受信し続ける
		vi.advanceTimersByTime(INTERVAL_MS);
		tracker.receiveFrom("peer-b");
		vi.advanceTimersByTime(INTERVAL_MS);
		tracker.receiveFrom("peer-b");
		vi.advanceTimersByTime(INTERVAL_MS * 2);

		// peer-a は 90 秒以上 heartbeat が来ていないので dead
		expect(onDead).toHaveBeenCalledWith("peer-a");
		expect(onDead).not.toHaveBeenCalledWith("peer-b");
	});

	it("test_deadPeer_removedFromTracking_doesNotTriggerAgain", () => {
		const { tracker, onDead } = makeTracker();
		tracker.trackPeer("peer-a");
		tracker.start(() => ["peer-a"]);

		vi.advanceTimersByTime(TIMEOUT_MS + INTERVAL_MS);
		expect(onDead).toHaveBeenCalledTimes(1);

		// もう一度インターバルが来ても再通知しない（既に Map から削除済み）
		vi.advanceTimersByTime(INTERVAL_MS * 2);
		expect(onDead).toHaveBeenCalledTimes(1);
	});
});
