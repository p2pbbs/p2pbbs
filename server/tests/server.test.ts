import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { SignalingEnvelope } from "@/core/domain/model/SignalingEnvelope.ts";
import { SignalingErrorCode } from "@/core/domain/model/SignalingErrorCode.ts";
import type { ServerMessage } from "@/core/domain/model/SignalingMessage.ts";
import {
	createConnectionHandler,
	handleClientMessage,
	MAX_CONNECTIONS,
	PeerRegistry,
	sendMessage,
} from "../server.ts";

type MockWs = WebSocket & {
	emit: (event: string, ...args: unknown[]) => void;
};

function mockWs(readyState: number = WebSocket.OPEN): MockWs {
	const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
	return {
		readyState,
		send: vi.fn(),
		close: vi.fn(),
		on(event: string, fn: (...args: unknown[]) => void) {
			if (handlers[event] === undefined) handlers[event] = [];
			handlers[event].push(fn);
		},
		emit(event: string, ...args: unknown[]) {
			for (const fn of handlers[event] ?? []) fn(...args);
		},
	} as unknown as MockWs;
}

function sentMessages(ws: WebSocket): ServerMessage[] {
	const mock = ws.send as ReturnType<typeof vi.fn>;
	return mock.mock.calls.map(
		([data]: [string]) => JSON.parse(data) as ServerMessage,
	);
}

const dummyEnvelope: SignalingEnvelope = {
	from: "peer-a",
	to: "peer-b",
	payload: { type: "offer", sdp: { type: "offer", sdp: "v=0" } },
};

// --- PeerRegistry ---

describe("PeerRegistry", () => {
	let registry: PeerRegistry;

	beforeEach(() => {
		registry = new PeerRegistry();
	});

	it("test_add_newPeer_sizeIncreases", () => {
		registry.add("peer-1", mockWs());
		expect(registry.size()).toBe(1);
		expect(registry.has("peer-1")).toBe(true);
	});

	it("test_remove_existingPeer_sizeDecreases", () => {
		registry.add("peer-1", mockWs());
		registry.remove("peer-1");
		expect(registry.size()).toBe(0);
		expect(registry.has("peer-1")).toBe(false);
	});

	it("test_randomPeers_fivePeers_returnsUpToThree", () => {
		for (let i = 1; i <= 5; i++) registry.add(`peer-${i}`, mockWs());
		const result = registry.randomPeers("peer-1", 3);
		expect(result).toHaveLength(3);
		expect(result).not.toContain("peer-1");
	});

	it("test_randomPeers_onlyOnePeer_returnsEmptyList", () => {
		registry.add("peer-1", mockWs());
		expect(registry.randomPeers("peer-1", 3)).toHaveLength(0);
	});

	it("test_randomPeers_twoTotalPeers_returnsOneOther", () => {
		registry.add("peer-1", mockWs());
		registry.add("peer-2", mockWs());
		expect(registry.randomPeers("peer-1", 3)).toEqual(["peer-2"]);
	});
});

// --- sendMessage ---

describe("sendMessage", () => {
	it("test_sendMessage_openConnection_sendsCalled", () => {
		const ws = mockWs(WebSocket.OPEN);
		sendMessage(ws, { type: "peers", peers: [] });
		expect(ws.send).toHaveBeenCalledOnce();
	});

	it("test_sendMessage_closedConnection_sendNotCalled", () => {
		const ws = mockWs(WebSocket.CLOSED);
		sendMessage(ws, { type: "peers", peers: [] });
		expect(ws.send).not.toHaveBeenCalled();
	});
});

// --- handleClientMessage: join ---

describe("handleClientMessage — join", () => {
	let registry: PeerRegistry;
	let ws: MockWs;
	let onJoin: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		registry = new PeerRegistry();
		ws = mockWs();
		onJoin = vi.fn();
	});

	it("test_join_firstPeer_receivesEmptyPeerList", () => {
		handleClientMessage(
			JSON.stringify({ type: "join", peerId: "peer-a" }),
			ws,
			registry,
			onJoin,
		);

		expect(sentMessages(ws)).toEqual([{ type: "peers", peers: [] }]);
		expect(onJoin).toHaveBeenCalledWith("peer-a");
		expect(registry.has("peer-a")).toBe(true);
	});

	it("test_join_threeExistingPeers_receivesUpToThreePeers", () => {
		for (const id of ["peer-b", "peer-c", "peer-d"]) {
			registry.add(id, mockWs());
		}
		handleClientMessage(
			JSON.stringify({ type: "join", peerId: "peer-a" }),
			ws,
			registry,
			onJoin,
		);

		const msgs = sentMessages(ws);
		expect(msgs[0]?.type).toBe("peers");
		if (msgs[0]?.type === "peers") {
			expect(msgs[0].peers.length).toBeLessThanOrEqual(3);
			expect(msgs[0].peers).not.toContain("peer-a");
		}
	});

	it("test_join_duplicatePeerId_sendsErrorAndCloses", () => {
		registry.add("peer-a", mockWs());
		handleClientMessage(
			JSON.stringify({ type: "join", peerId: "peer-a" }),
			ws,
			registry,
			onJoin,
		);

		const msgs = sentMessages(ws);
		expect(msgs[0]?.type).toBe("error");
		if (msgs[0]?.type === "error") {
			expect(msgs[0].code).toBe(SignalingErrorCode.INVALID_MESSAGE);
		}
		expect(ws.close).toHaveBeenCalledWith(1008);
		expect(onJoin).not.toHaveBeenCalled();
	});
});

// --- handleClientMessage: signal ---

describe("handleClientMessage — signal", () => {
	let registry: PeerRegistry;
	let senderWs: MockWs;
	let targetWs: MockWs;

	beforeEach(() => {
		registry = new PeerRegistry();
		senderWs = mockWs();
		targetWs = mockWs();
		registry.add("peer-a", senderWs);
		registry.add("peer-b", targetWs);
	});

	it("test_signal_targetOnline_forwardsEnvelope", () => {
		handleClientMessage(
			JSON.stringify({ type: "signal", envelope: dummyEnvelope }),
			senderWs,
			registry,
			vi.fn(),
		);

		expect(sentMessages(targetWs)).toEqual([
			{ type: "signal", envelope: dummyEnvelope },
		]);
	});

	it("test_signal_targetDisconnected_silentlyDrops", () => {
		const disconnectedWs = mockWs(WebSocket.CLOSED);
		registry.add("peer-c", disconnectedWs);
		handleClientMessage(
			JSON.stringify({
				type: "signal",
				envelope: { ...dummyEnvelope, to: "peer-c" },
			}),
			senderWs,
			registry,
			vi.fn(),
		);
		expect(disconnectedWs.send).not.toHaveBeenCalled();
	});

	it("test_signal_unknownTarget_silentlyDrops", () => {
		handleClientMessage(
			JSON.stringify({
				type: "signal",
				envelope: { ...dummyEnvelope, to: "unknown" },
			}),
			senderWs,
			registry,
			vi.fn(),
		);
		expect(targetWs.send).not.toHaveBeenCalled();
	});
});

// --- handleClientMessage: invalid input (ignore, no close) ---

describe("handleClientMessage — invalid input", () => {
	let registry: PeerRegistry;
	let ws: MockWs;

	beforeEach(() => {
		registry = new PeerRegistry();
		ws = mockWs();
	});

	it("test_invalidJson_ignoresAndDoesNotClose", () => {
		handleClientMessage("not-json{{{", ws, registry, vi.fn());
		expect(ws.send).not.toHaveBeenCalled();
		expect(ws.close).not.toHaveBeenCalled();
	});

	it("test_unknownMessageType_ignoresAndDoesNotClose", () => {
		handleClientMessage(
			JSON.stringify({ type: "unknown", data: "foo" }),
			ws,
			registry,
			vi.fn(),
		);
		expect(ws.send).not.toHaveBeenCalled();
		expect(ws.close).not.toHaveBeenCalled();
	});

	it("test_joinMissingPeerId_ignoresAndDoesNotClose", () => {
		handleClientMessage(
			JSON.stringify({ type: "join" }),
			ws,
			registry,
			vi.fn(),
		);
		expect(ws.send).not.toHaveBeenCalled();
		expect(ws.close).not.toHaveBeenCalled();
	});
});

// --- createConnectionHandler ---

describe("createConnectionHandler", () => {
	let registry: PeerRegistry;

	beforeEach(() => {
		registry = new PeerRegistry();
	});

	it("test_connection_capacityExceeded_sendsErrorAndCloses", () => {
		for (let i = 0; i < MAX_CONNECTIONS; i++) {
			registry.add(`peer-${i}`, mockWs());
		}

		const ws = mockWs();
		createConnectionHandler(registry)(ws);

		const msgs = sentMessages(ws);
		expect(msgs[0]?.type).toBe("error");
		if (msgs[0]?.type === "error") {
			expect(msgs[0].code).toBe(SignalingErrorCode.CAPACITY_EXCEEDED);
		}
		expect(ws.close).toHaveBeenCalledWith(1008);
	});

	it("test_connection_normal_wiresMessageHandler", () => {
		const ws = mockWs();
		createConnectionHandler(registry)(ws);

		ws.emit("message", JSON.stringify({ type: "join", peerId: "peer-a" }));

		expect(registry.has("peer-a")).toBe(true);
	});

	it("test_connection_closeAfterJoin_removesPeerFromRegistry", () => {
		const ws = mockWs();
		createConnectionHandler(registry)(ws);

		ws.emit("message", JSON.stringify({ type: "join", peerId: "peer-a" }));
		expect(registry.has("peer-a")).toBe(true);

		ws.emit("close");
		expect(registry.has("peer-a")).toBe(false);
	});

	it("test_connection_errorAfterJoin_removesPeerFromRegistry", () => {
		const ws = mockWs();
		createConnectionHandler(registry)(ws);

		ws.emit("message", JSON.stringify({ type: "join", peerId: "peer-a" }));
		ws.emit("error", new Error("network error"));
		expect(registry.has("peer-a")).toBe(false);
	});

	it("test_connection_closeBeforeJoin_doesNotThrow", () => {
		const ws = mockWs();
		createConnectionHandler(registry)(ws);
		expect(() => ws.emit("close")).not.toThrow();
	});

	it("test_connection_doubleClose_isIdempotent", () => {
		const ws = mockWs();
		createConnectionHandler(registry)(ws);

		ws.emit("message", JSON.stringify({ type: "join", peerId: "peer-a" }));
		ws.emit("close");
		ws.emit("close");

		expect(registry.size()).toBe(0);
	});
});
