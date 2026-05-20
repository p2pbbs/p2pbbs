import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebRTCGateway } from "@/core/adapter/gossip/WebRTCGateway";
import type { IDataChannel } from "@/core/domain/port/IDataChannel";
import { makeGossipMessage } from "../../helpers/fixtures";

const PEER_A = "peer-a";

function makeMockDc(): IDataChannel {
	return { send: vi.fn(), close: vi.fn() };
}

describe("WebRTCGateway", () => {
	let channels: Map<string, IDataChannel>;
	let gateway: WebRTCGateway;

	beforeEach(() => {
		channels = new Map();
		gateway = new WebRTCGateway(channels);
	});

	// --- send (gossip broadcast) ---

	it("test_send_SingleChannel_SendsGossipJson", () => {
		const dc = makeMockDc();
		channels.set(PEER_A, dc);
		const msg = makeGossipMessage();
		gateway.send(msg);
		expect(dc.send).toHaveBeenCalledWith(
			JSON.stringify({ type: "gossip", message: msg }),
		);
	});

	it("test_send_MultipleChannels_SendsToAll", () => {
		const dc1 = makeMockDc();
		const dc2 = makeMockDc();
		channels.set(PEER_A, dc1);
		channels.set("peer-b", dc2);
		gateway.send(makeGossipMessage());
		expect(dc1.send).toHaveBeenCalledOnce();
		expect(dc2.send).toHaveBeenCalledOnce();
	});

	it("test_send_EmptyChannels_DoesNotThrow", () => {
		expect(() => gateway.send(makeGossipMessage())).not.toThrow();
	});

	it("test_send_ChannelThrows_DoesNotPropagateError", () => {
		const dc = makeMockDc();
		vi.mocked(dc.send).mockImplementation(() => {
			throw new Error("dc closing");
		});
		channels.set(PEER_A, dc);
		expect(() => gateway.send(makeGossipMessage())).not.toThrow();
	});

	it("test_send_ChannelAddedAfterConstruction_IsIncluded", () => {
		const msg = makeGossipMessage();
		gateway.send(msg); // channels 空 → 何も送らない

		const dc = makeMockDc();
		channels.set(PEER_A, dc);
		gateway.send(msg);
		expect(dc.send).toHaveBeenCalledOnce();
	});

	// --- handleIncoming / onReceive (gossip) ---

	it("test_handleIncoming_GossipMessage_CallsRegisteredHandlers", () => {
		const handler = vi.fn();
		gateway.onReceive(handler);
		const msg = makeGossipMessage();
		gateway.handleIncoming(
			PEER_A,
			JSON.stringify({ type: "gossip", message: msg }),
		);
		expect(handler).toHaveBeenCalledWith(msg);
	});

	it("test_handleIncoming_MultipleHandlers_AllCalled", () => {
		const h1 = vi.fn();
		const h2 = vi.fn();
		gateway.onReceive(h1);
		gateway.onReceive(h2);
		const msg = makeGossipMessage();
		gateway.handleIncoming(
			PEER_A,
			JSON.stringify({ type: "gossip", message: msg }),
		);
		expect(h1).toHaveBeenCalledWith(msg);
		expect(h2).toHaveBeenCalledWith(msg);
	});

	it("test_handleIncoming_Heartbeat_DoesNotCallHandlers", () => {
		const handler = vi.fn();
		gateway.onReceive(handler);
		gateway.handleIncoming(PEER_A, JSON.stringify({ type: "heartbeat" }));
		expect(handler).not.toHaveBeenCalled();
	});

	it("test_handleIncoming_MalformedJson_DoesNotThrow", () => {
		gateway.onReceive(vi.fn());
		expect(() => gateway.handleIncoming(PEER_A, "{bad json")).not.toThrow();
	});

	it("test_handleIncoming_InvalidSchema_DoesNotCallHandlers", () => {
		const handler = vi.fn();
		gateway.onReceive(handler);
		gateway.handleIncoming(PEER_A, JSON.stringify({ type: "unknown" }));
		expect(handler).not.toHaveBeenCalled();
	});

	// --- unsubscribe (gossip) ---

	it("test_onReceive_AfterUnsubscribe_HandlerNotCalled", () => {
		const handler = vi.fn();
		const unsub = gateway.onReceive(handler);
		unsub();
		const msg = makeGossipMessage();
		gateway.handleIncoming(
			PEER_A,
			JSON.stringify({ type: "gossip", message: msg }),
		);
		expect(handler).not.toHaveBeenCalled();
	});

	it("test_onReceive_UnsubscribeOneHandler_OtherHandlerStillCalled", () => {
		const h1 = vi.fn();
		const h2 = vi.fn();
		const unsub1 = gateway.onReceive(h1);
		gateway.onReceive(h2);
		unsub1();
		const msg = makeGossipMessage();
		gateway.handleIncoming(
			PEER_A,
			JSON.stringify({ type: "gossip", message: msg }),
		);
		expect(h1).not.toHaveBeenCalled();
		expect(h2).toHaveBeenCalledWith(msg);
	});

	// --- sendDigest ---

	it("test_sendDigest_KnownPeer_SendsDigestJson", () => {
		const dc = makeMockDc();
		channels.set(PEER_A, dc);
		const threads = [{ threadId: "t1", maxLamport: 5, postCount: 3 }];
		gateway.sendDigest(PEER_A, "board-1", threads);
		expect(dc.send).toHaveBeenCalledWith(
			JSON.stringify({ type: "digest", boardId: "board-1", threads }),
		);
	});

	it("test_sendDigest_UnknownPeer_DoesNotThrow", () => {
		expect(() =>
			gateway.sendDigest("unknown-peer", "board-1", []),
		).not.toThrow();
	});

	it("test_sendDigest_ChannelThrows_DoesNotPropagateError", () => {
		const dc = makeMockDc();
		vi.mocked(dc.send).mockImplementation(() => {
			throw new Error("dc closing");
		});
		channels.set(PEER_A, dc);
		expect(() => gateway.sendDigest(PEER_A, "board-1", [])).not.toThrow();
	});

	// --- handleIncoming / onDigestReceive (digest) ---

	it("test_handleIncoming_DigestMessage_CallsDigestHandlers", () => {
		const handler = vi.fn();
		gateway.onDigestReceive(handler);
		const threads = [{ threadId: "t1", maxLamport: 5, postCount: 3 }];
		gateway.handleIncoming(
			PEER_A,
			JSON.stringify({ type: "digest", boardId: "board-1", threads }),
		);
		expect(handler).toHaveBeenCalledWith(PEER_A, "board-1", threads);
	});

	it("test_handleIncoming_DigestMessage_PassesPeerId", () => {
		const handler = vi.fn();
		gateway.onDigestReceive(handler);
		gateway.handleIncoming(
			"peer-x",
			JSON.stringify({ type: "digest", boardId: "board-1", threads: [] }),
		);
		expect(handler).toHaveBeenCalledWith("peer-x", "board-1", []);
	});

	it("test_handleIncoming_Digest_DoesNotCallGossipHandlers", () => {
		const gossipHandler = vi.fn();
		gateway.onReceive(gossipHandler);
		gateway.handleIncoming(
			PEER_A,
			JSON.stringify({ type: "digest", boardId: "board-1", threads: [] }),
		);
		expect(gossipHandler).not.toHaveBeenCalled();
	});

	it("test_onDigestReceive_AfterUnsubscribe_HandlerNotCalled", () => {
		const handler = vi.fn();
		const unsub = gateway.onDigestReceive(handler);
		unsub();
		gateway.handleIncoming(
			PEER_A,
			JSON.stringify({ type: "digest", boardId: "board-1", threads: [] }),
		);
		expect(handler).not.toHaveBeenCalled();
	});
});
