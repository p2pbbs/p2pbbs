import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalingEnvelope } from "../../src/core/domain/model/SignalingEnvelope";
import type { IDataChannel } from "../../src/core/domain/port/IDataChannel";
import type { IDataChannelEvents } from "../../src/core/domain/port/IDataChannelEvents";
import { PeerSession } from "../../src/core/usecase/PeerSession";
import {
	createMockIDataChannel,
	createMockIPeerConnection,
} from "../helpers/mockPeerConnection";
import { dummyIceCandidate, dummySdp } from "../helpers/mockSignaling";

const SELF_ID = "self-peer";
const REMOTE_ID = "remote-peer";

describe("PeerSession", () => {
	let pc: ReturnType<typeof createMockIPeerConnection>;
	let sendSignal: ReturnType<
		typeof vi.fn<(envelope: SignalingEnvelope) => void>
	>;
	let onChannelReady: ReturnType<
		typeof vi.fn<(dc: IDataChannel & IDataChannelEvents) => void>
	>;
	let session: PeerSession;

	beforeEach(() => {
		pc = createMockIPeerConnection();
		sendSignal = vi.fn<(envelope: SignalingEnvelope) => void>();
		onChannelReady = vi.fn<(dc: IDataChannel & IDataChannelEvents) => void>();
		session = new PeerSession(
			SELF_ID,
			REMOTE_ID,
			pc,
			sendSignal,
			onChannelReady,
		);
	});

	describe("initiateOffer", () => {
		it("test_initiateOffer_called_createDataChannelWithNchLabel", async () => {
			await session.initiateOffer();
			expect(pc.createDataChannel).toHaveBeenCalledWith("nch");
		});

		it("test_initiateOffer_called_createOfferThenSetLocalDescriptionInOrder", async () => {
			const order: string[] = [];
			pc.createOffer.mockImplementation(async () => {
				order.push("createOffer");
				return { type: "offer", sdp: "sdp" };
			});
			pc.setLocalDescription.mockImplementation(async () => {
				order.push("setLocalDescription");
			});
			await session.initiateOffer();
			expect(order).toEqual(["createOffer", "setLocalDescription"]);
		});

		it("test_initiateOffer_called_sendsOfferSignalWithCorrectFromTo", async () => {
			await session.initiateOffer();
			expect(sendSignal).toHaveBeenCalledWith({
				from: SELF_ID,
				to: REMOTE_ID,
				payload: {
					type: "offer",
					sdp: { type: "offer", sdp: "dummy-offer-sdp" },
				},
			});
		});

		it("test_initiateOffer_dataChannelOpen_callsOnChannelReady", async () => {
			await session.initiateOffer();
			pc._dc._triggerOpen();
			expect(onChannelReady).toHaveBeenCalledWith(pc._dc);
		});
	});

	describe("handleOffer", () => {
		it("test_handleOffer_called_setRemoteDescriptionThenCreateAnswerThenSetLocalDescriptionInOrder", async () => {
			const order: string[] = [];
			pc.setRemoteDescription.mockImplementation(async () => {
				order.push("setRemoteDescription");
			});
			pc.createAnswer.mockImplementation(async () => {
				order.push("createAnswer");
				return { type: "answer", sdp: "sdp" };
			});
			pc.setLocalDescription.mockImplementation(async () => {
				order.push("setLocalDescription");
			});
			await session.handleOffer(dummySdp);
			expect(order).toEqual([
				"setRemoteDescription",
				"createAnswer",
				"setLocalDescription",
			]);
		});

		it("test_handleOffer_called_sendsAnswerSignalWithCorrectFromTo", async () => {
			await session.handleOffer(dummySdp);
			expect(sendSignal).toHaveBeenCalledWith({
				from: SELF_ID,
				to: REMOTE_ID,
				payload: {
					type: "answer",
					sdp: { type: "answer", sdp: "dummy-answer-sdp" },
				},
			});
		});

		it("test_handleOffer_dataChannelOpen_callsOnChannelReady", async () => {
			await session.handleOffer(dummySdp);
			const incomingDc = createMockIDataChannel();
			pc._triggerDataChannel(incomingDc);
			incomingDc._triggerOpen();
			expect(onChannelReady).toHaveBeenCalledWith(incomingDc);
		});
	});

	describe("handleAnswer", () => {
		it("test_handleAnswer_called_setsRemoteDescription", async () => {
			const answerSdp: RTCSessionDescriptionInit = {
				type: "answer",
				sdp: "answer-sdp",
			};
			await session.handleAnswer(answerSdp);
			expect(pc.setRemoteDescription).toHaveBeenCalledWith(answerSdp);
		});

		it("test_handleAnswer_called_doesNotSendSignal", async () => {
			await session.handleAnswer({ type: "answer", sdp: "sdp" });
			expect(sendSignal).not.toHaveBeenCalled();
		});
	});

	describe("addIceCandidate", () => {
		it("test_addIceCandidate_called_delegatesToPeerConnection", async () => {
			await session.addIceCandidate(dummyIceCandidate);
			expect(pc.addIceCandidate).toHaveBeenCalledWith(dummyIceCandidate);
		});
	});

	describe("onIceCandidate", () => {
		it("test_iceCandidate_triggered_sendsIceCandidateSignal", () => {
			pc._triggerIceCandidate(dummyIceCandidate);
			expect(sendSignal).toHaveBeenCalledWith({
				from: SELF_ID,
				to: REMOTE_ID,
				payload: { type: "ice-candidate", candidate: dummyIceCandidate },
			});
		});
	});

	describe("close", () => {
		it("test_close_called_closesPeerConnection", () => {
			session.close();
			expect(pc.close).toHaveBeenCalledOnce();
		});

		it("test_close_called_stopsForwardingIceCandidates", () => {
			session.close();
			sendSignal.mockClear();
			pc._triggerIceCandidate(dummyIceCandidate);
			expect(sendSignal).not.toHaveBeenCalled();
		});
	});
});
