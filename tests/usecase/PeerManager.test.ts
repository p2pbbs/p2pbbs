import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ACTIVE_PEERS } from "../../src/core/config/constants";
import type { SignalingEnvelope } from "../../src/core/domain/model/SignalingEnvelope";
import type { ISignalingTransport } from "../../src/core/domain/port/ISignalingTransport";
import { PeerManager } from "../../src/core/usecase/PeerManager";
import {
	createMockIPeerConnection,
	type MockIPeerConnection,
} from "../helpers/mockPeerConnection";
import { dummyIceCandidate, dummySdp } from "../helpers/mockSignaling";

const SELF_ID = "self-peer";
const PEER_A = "peer-aaaa";

/** テスト用の大きなタイムアウト値（heartbeat タイマーが発火しないようにする）。 */
const LARGE_MS = 9_999_999;

function createMockSignaling() {
	const handlers: ((envelope: SignalingEnvelope) => void)[] = [];
	const transport: ISignalingTransport = {
		send: vi.fn(),
		onMessage(handler) {
			handlers.push(handler);
			return () => {};
		},
	};
	const trigger = (envelope: SignalingEnvelope) => {
		for (const h of handlers) h(envelope);
	};
	return { transport, trigger };
}

function createMockLogger() {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

function makeFactory(pcPerCall: MockIPeerConnection[]) {
	let idx = 0;
	return {
		create: vi.fn(() => {
			const pc = pcPerCall[idx];
			idx++;
			return pc!;
		}),
	};
}

describe("PeerManager", () => {
	let signaling: ReturnType<typeof createMockSignaling>;
	let logger: ReturnType<typeof createMockLogger>;
	let manager: PeerManager;
	let pc1: MockIPeerConnection;
	let pc2: MockIPeerConnection;

	beforeEach(() => {
		signaling = createMockSignaling();
		logger = createMockLogger();
		pc1 = createMockIPeerConnection();
		pc2 = createMockIPeerConnection();
	});

	afterEach(() => {
		manager?.dispose();
	});

	function makeManager(selfId = SELF_ID, pcs = [pc1, pc2]) {
		const factory = makeFactory(pcs);
		const onChannel = vi.fn();
		manager = new PeerManager(
			signaling.transport,
			factory,
			selfId,
			onChannel,
			logger,
			LARGE_MS,
			LARGE_MS,
		);
		return { factory, onChannel };
	}

	describe("connectTo", () => {
		it("test_connectTo_newPeer_createsSessionAndSendsOffer", async () => {
			const { factory } = makeManager();
			manager.connectTo(PEER_A);
			await vi.waitFor(() =>
				expect(signaling.transport.send).toHaveBeenCalledWith(
					expect.objectContaining({
						from: SELF_ID,
						to: PEER_A,
						payload: expect.objectContaining({ type: "offer" }),
					}),
				),
			);
			expect(factory.create).toHaveBeenCalledOnce();
		});

		it("test_connectTo_alreadyConnectedPeer_ignoresDuplicate", async () => {
			const { factory } = makeManager();
			manager.connectTo(PEER_A);
			manager.connectTo(PEER_A);
			await vi.waitFor(() =>
				expect(signaling.transport.send).toHaveBeenCalledTimes(1),
			);
			expect(factory.create).toHaveBeenCalledOnce();
		});

		it("test_connectTo_atMaxActivePeers_ignoresNewConnection", async () => {
			const pcs = Array.from({ length: MAX_ACTIVE_PEERS + 1 }, () =>
				createMockIPeerConnection(),
			);
			const { factory } = makeManager(SELF_ID, pcs);

			for (let i = 0; i < MAX_ACTIVE_PEERS; i++) {
				manager.connectTo(`peer-${i}`);
			}
			await vi.waitFor(() =>
				expect(factory.create).toHaveBeenCalledTimes(MAX_ACTIVE_PEERS),
			);

			manager.connectTo("peer-overflow");
			expect(factory.create).toHaveBeenCalledTimes(MAX_ACTIVE_PEERS);
			expect(logger.warn).toHaveBeenCalledWith(
				"peer_manager.max_peers_reached",
				expect.anything(),
			);
		});
	});

	describe("シグナリングルーティング", () => {
		it("test_route_offer_createsSessionAndHandlesOffer", async () => {
			makeManager();
			signaling.trigger({
				from: PEER_A,
				to: SELF_ID,
				payload: { type: "offer", sdp: dummySdp },
			});
			await vi.waitFor(() =>
				expect(signaling.transport.send).toHaveBeenCalledWith(
					expect.objectContaining({
						from: SELF_ID,
						to: PEER_A,
						payload: expect.objectContaining({ type: "answer" }),
					}),
				),
			);
			expect(pc1.setRemoteDescription).toHaveBeenCalledWith(dummySdp);
			expect(pc1.createAnswer).toHaveBeenCalledOnce();
		});

		it("test_route_answer_delegatesToExistingSession", async () => {
			makeManager();
			manager.connectTo(PEER_A);
			await vi.waitFor(() =>
				expect(signaling.transport.send).toHaveBeenCalled(),
			);

			signaling.trigger({
				from: PEER_A,
				to: SELF_ID,
				payload: { type: "answer", sdp: { type: "answer", sdp: "ans" } },
			});
			await vi.waitFor(() =>
				expect(pc1.setRemoteDescription).toHaveBeenCalledWith({
					type: "answer",
					sdp: "ans",
				}),
			);
		});

		it("test_route_iceCandidate_delegatesToExistingSession", async () => {
			makeManager();
			manager.connectTo(PEER_A);
			await vi.waitFor(() =>
				expect(signaling.transport.send).toHaveBeenCalled(),
			);

			signaling.trigger({
				from: PEER_A,
				to: SELF_ID,
				payload: { type: "ice-candidate", candidate: dummyIceCandidate },
			});
			await vi.waitFor(() =>
				expect(pc1.addIceCandidate).toHaveBeenCalledWith(dummyIceCandidate),
			);
		});

		it("test_route_answerFromUnknownPeer_ignored", () => {
			makeManager();
			expect(() => {
				signaling.trigger({
					from: "unknown-peer",
					to: SELF_ID,
					payload: { type: "answer", sdp: { type: "answer", sdp: "sdp" } },
				});
			}).not.toThrow();
			expect(pc1.setRemoteDescription).not.toHaveBeenCalled();
		});

		it("test_route_iceCandidateFromUnknownPeer_ignored", () => {
			makeManager();
			expect(() => {
				signaling.trigger({
					from: "unknown-peer",
					to: SELF_ID,
					payload: { type: "ice-candidate", candidate: dummyIceCandidate },
				});
			}).not.toThrow();
			expect(pc1.addIceCandidate).not.toHaveBeenCalled();
		});

		it("test_route_offerAtMaxActivePeers_ignored", async () => {
			const pcs = Array.from({ length: MAX_ACTIVE_PEERS + 1 }, () =>
				createMockIPeerConnection(),
			);
			const factory = makeFactory(pcs);
			manager = new PeerManager(
				signaling.transport,
				factory,
				SELF_ID,
				vi.fn(),
				logger,
				LARGE_MS,
				LARGE_MS,
			);

			for (let i = 0; i < MAX_ACTIVE_PEERS; i++) {
				manager.connectTo(`peer-${i}`);
			}
			await vi.waitFor(() =>
				expect(factory.create).toHaveBeenCalledTimes(MAX_ACTIVE_PEERS),
			);

			signaling.trigger({
				from: "peer-overflow",
				to: SELF_ID,
				payload: { type: "offer", sdp: dummySdp },
			});
			expect(factory.create).toHaveBeenCalledTimes(MAX_ACTIVE_PEERS);
			expect(logger.warn).toHaveBeenCalledWith(
				"peer_manager.max_peers_reached_offer",
				expect.anything(),
			);
		});
	});

	describe("glare 解決（Peer ID 辞書順）", () => {
		it("test_glare_selfIdSmaller_selfOfferWins_theirOfferIgnored", async () => {
			// SELF_ID < PEER_B なので自分の offer が勝つ
			const selfId = "aaaa";
			const remotePeer = "zzzz";
			makeManager(selfId);

			manager.connectTo(remotePeer);
			await vi.waitFor(() =>
				expect(signaling.transport.send).toHaveBeenCalled(),
			);
			const createCallsBefore = pc1.close.mock.calls.length;

			// 相手から offer が来ても無視される
			signaling.trigger({
				from: remotePeer,
				to: selfId,
				payload: { type: "offer", sdp: dummySdp },
			});

			// 既存 session は破棄されない
			expect(pc1.close).toHaveBeenCalledTimes(createCallsBefore);
			// setRemoteDescription は呼ばれない（offer が無視された）
			expect(pc1.setRemoteDescription).not.toHaveBeenCalled();
		});

		it("test_glare_selfIdLarger_theirOfferWins_existingSessionReplaced", async () => {
			// selfId > remotePeer なので相手の offer が勝つ
			const selfId = "zzzz";
			const remotePeer = "aaaa";
			const pcs = [pc1, pc2];
			const factory = makeFactory(pcs);
			manager = new PeerManager(
				signaling.transport,
				factory,
				selfId,
				vi.fn(),
				logger,
				LARGE_MS,
				LARGE_MS,
			);

			manager.connectTo(remotePeer);
			await vi.waitFor(() =>
				expect(signaling.transport.send).toHaveBeenCalled(),
			);

			// 相手から offer が来ると既存 session を破棄して相手の offer を受け入れる
			signaling.trigger({
				from: remotePeer,
				to: selfId,
				payload: { type: "offer", sdp: dummySdp },
			});

			expect(pc1.close).toHaveBeenCalledOnce();
			await vi.waitFor(() =>
				expect(pc2.setRemoteDescription).toHaveBeenCalledWith(dummySdp),
			);
			expect(pc2.createAnswer).toHaveBeenCalledOnce();
		});
	});

	describe("removeSession", () => {
		it("test_removeSession_existingPeer_closesSessionAndCleansUp", async () => {
			makeManager();
			manager.connectTo(PEER_A);
			await vi.waitFor(() =>
				expect(signaling.transport.send).toHaveBeenCalled(),
			);

			manager.removeSession(PEER_A);

			expect(pc1.close).toHaveBeenCalledOnce();
		});

		it("test_removeSession_unknownPeer_doesNotThrow", () => {
			makeManager();
			expect(() => manager.removeSession("non-existent")).not.toThrow();
		});

		it("test_removeSession_calledTwice_idempotent", async () => {
			makeManager();
			manager.connectTo(PEER_A);
			await vi.waitFor(() =>
				expect(signaling.transport.send).toHaveBeenCalled(),
			);

			manager.removeSession(PEER_A);
			manager.removeSession(PEER_A);

			expect(pc1.close).toHaveBeenCalledOnce();
		});
	});

	describe("DataChannel open/close ライフサイクル", () => {
		it("test_channelOpen_callsOnChannelCallback", async () => {
			const { onChannel } = makeManager();
			signaling.trigger({
				from: PEER_A,
				to: SELF_ID,
				payload: { type: "offer", sdp: dummySdp },
			});
			await vi.waitFor(() =>
				expect(pc1.setRemoteDescription).toHaveBeenCalled(),
			);

			const incomingDc = pc1._dc;
			pc1._triggerDataChannel(incomingDc);
			incomingDc._triggerOpen();

			expect(onChannel).toHaveBeenCalledWith(PEER_A, incomingDc);
		});

		it("test_channelClose_removesSession", async () => {
			makeManager();
			signaling.trigger({
				from: PEER_A,
				to: SELF_ID,
				payload: { type: "offer", sdp: dummySdp },
			});
			await vi.waitFor(() =>
				expect(pc1.setRemoteDescription).toHaveBeenCalled(),
			);

			const incomingDc = pc1._dc;
			pc1._triggerDataChannel(incomingDc);
			incomingDc._triggerOpen();
			pc1.close.mockClear();

			incomingDc._triggerClose();

			expect(pc1.close).toHaveBeenCalledOnce();
		});

		it("test_heartbeatMessage_received_doesNotThrow", async () => {
			makeManager();
			signaling.trigger({
				from: PEER_A,
				to: SELF_ID,
				payload: { type: "offer", sdp: dummySdp },
			});
			await vi.waitFor(() =>
				expect(pc1.setRemoteDescription).toHaveBeenCalled(),
			);

			const incomingDc = pc1._dc;
			pc1._triggerDataChannel(incomingDc);
			incomingDc._triggerOpen();

			expect(() => {
				incomingDc._triggerMessage(JSON.stringify({ type: "heartbeat" }));
			}).not.toThrow();
		});

		it("test_malformedDataChannelMessage_received_ignored", async () => {
			makeManager();
			signaling.trigger({
				from: PEER_A,
				to: SELF_ID,
				payload: { type: "offer", sdp: dummySdp },
			});
			await vi.waitFor(() =>
				expect(pc1.setRemoteDescription).toHaveBeenCalled(),
			);

			const incomingDc = pc1._dc;
			pc1._triggerDataChannel(incomingDc);
			incomingDc._triggerOpen();

			expect(() => {
				incomingDc._triggerMessage("not-json{{");
			}).not.toThrow();
		});
	});

	describe("HeartbeatTracker 統合", () => {
		it("test_peerDead_removesSession", async () => {
			vi.useFakeTimers();
			try {
				const intervalMs = 100;
				const timeoutMs = 200;
				const factory = makeFactory([pc1]);
				manager = new PeerManager(
					signaling.transport,
					factory,
					SELF_ID,
					vi.fn(),
					logger,
					intervalMs,
					timeoutMs,
				);

				signaling.trigger({
					from: PEER_A,
					to: SELF_ID,
					payload: { type: "offer", sdp: dummySdp },
				});
				await vi.waitFor(() =>
					expect(pc1.setRemoteDescription).toHaveBeenCalled(),
				);
				const incomingDc = pc1._dc;
				pc1._triggerDataChannel(incomingDc);
				incomingDc._triggerOpen();

				// heartbeat 受信なしでタイムアウトを超過させる
				vi.advanceTimersByTime(timeoutMs + intervalMs + 1);

				expect(pc1.close).toHaveBeenCalledOnce();
				expect(logger.warn).toHaveBeenCalledWith(
					"peer_manager.peer_dead",
					expect.anything(),
				);
			} finally {
				vi.useRealTimers();
			}
		});
	});
});
