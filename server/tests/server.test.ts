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

function joinMsg(peerId: string, boardId: string): string {
	return JSON.stringify({ type: "join", peerId, boardId });
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

	it("test_join_newPeer_sizeIncreasesAndBoardRecorded", () => {
		registry.join("peer-1", "mona", mockWs());
		expect(registry.size()).toBe(1);
		expect(registry.has("peer-1")).toBe(true);
		expect(registry.boardOf("peer-1")).toBe("mona");
	});

	it("test_remove_existingPeer_sizeDecreasesAndBoardCleared", () => {
		registry.join("peer-1", "mona", mockWs());
		registry.remove("peer-1");
		expect(registry.size()).toBe(0);
		expect(registry.has("peer-1")).toBe(false);
		expect(registry.boardOf("peer-1")).toBeUndefined();
	});

	it("test_join_reHomeToOtherBoard_movesPeerBetweenBoards", () => {
		registry.join("peer-1", "mona", mockWs());
		registry.join("peer-2", "mona", mockWs());
		// peer-1 を yaruo に付け替える
		registry.join("peer-1", "yaruo", mockWs());

		expect(registry.boardOf("peer-1")).toBe("yaruo");
		// mona の同板ピアからは外れている
		expect(registry.randomPeers("peer-2", "mona", 3)).toEqual([]);
		// yaruo 側に居る
		expect(registry.randomPeers("other", "yaruo", 3)).toEqual(["peer-1"]);
	});

	it("test_randomPeers_sameBoardOnly_excludesOtherBoardsAndSelf", () => {
		registry.join("peer-1", "mona", mockWs());
		registry.join("peer-2", "mona", mockWs());
		registry.join("peer-3", "mona", mockWs());
		registry.join("peer-x", "yaruo", mockWs());

		const result = registry.randomPeers("peer-1", "mona", 3);
		expect(result).toHaveLength(2);
		expect(result).not.toContain("peer-1");
		expect(result).not.toContain("peer-x");
		expect(new Set(result)).toEqual(new Set(["peer-2", "peer-3"]));
	});

	it("test_randomPeers_capAtCount", () => {
		for (let i = 1; i <= 5; i++) registry.join(`peer-${i}`, "mona", mockWs());
		expect(registry.randomPeers("peer-1", "mona", 3)).toHaveLength(3);
	});

	it("test_randomPeers_onlySelfInBoard_returnsEmpty", () => {
		registry.join("peer-1", "mona", mockWs());
		expect(registry.randomPeers("peer-1", "mona", 3)).toEqual([]);
	});

	it("test_removeIfCurrent_wsMatches_removes", () => {
		const ws = mockWs();
		registry.join("peer-1", "mona", ws);
		expect(registry.removeIfCurrent("peer-1", ws)).toBe(true);
		expect(registry.has("peer-1")).toBe(false);
	});

	it("test_removeIfCurrent_wsReplacedByReHome_doesNotRemove", () => {
		const oldWs = mockWs();
		const newWs = mockWs();
		registry.join("peer-1", "mona", oldWs);
		// 別接続で再 join（last-writer-wins で newWs に置換）
		registry.join("peer-1", "mona", newWs);
		// 旧 ws が遅れて close しても、現役の登録は消えない
		expect(registry.removeIfCurrent("peer-1", oldWs)).toBe(false);
		expect(registry.has("peer-1")).toBe(true);
		expect(registry.get("peer-1")).toBe(newWs);
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

	it("test_join_firstPeerInBoard_receivesEmptyPeerList", () => {
		handleClientMessage(joinMsg("peer-a", "mona"), ws, registry, onJoin);

		expect(sentMessages(ws)).toEqual([{ type: "peers", peers: [] }]);
		expect(onJoin).toHaveBeenCalledWith("peer-a");
		expect(registry.has("peer-a")).toBe(true);
		expect(registry.boardOf("peer-a")).toBe("mona");
	});

	it("test_join_sameBoardPeers_receivesThem", () => {
		for (const id of ["peer-b", "peer-c"]) registry.join(id, "mona", mockWs());
		handleClientMessage(joinMsg("peer-a", "mona"), ws, registry, onJoin);

		const msgs = sentMessages(ws);
		expect(msgs[0]?.type).toBe("peers");
		if (msgs[0]?.type === "peers") {
			expect(new Set(msgs[0].peers)).toEqual(new Set(["peer-b", "peer-c"]));
		}
	});

	it("test_join_otherBoardPeersNotReturned", () => {
		registry.join("peer-x", "yaruo", mockWs());
		handleClientMessage(joinMsg("peer-a", "mona"), ws, registry, onJoin);

		const msgs = sentMessages(ws);
		expect(msgs[0]?.type).toBe("peers");
		if (msgs[0]?.type === "peers") {
			expect(msgs[0].peers).toEqual([]);
		}
	});

	it("test_join_duplicatePeerId_reHomesWithoutErrorOrClose", () => {
		registry.join("peer-a", "mona", mockWs());
		handleClientMessage(joinMsg("peer-a", "yaruo"), ws, registry, onJoin);

		const msgs = sentMessages(ws);
		// エラーや close ではなく peers を返す（re-home）
		expect(msgs[0]?.type).toBe("peers");
		expect(ws.close).not.toHaveBeenCalled();
		expect(onJoin).toHaveBeenCalledWith("peer-a");
		expect(registry.boardOf("peer-a")).toBe("yaruo");
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
		registry.join("peer-a", "mona", senderWs);
		registry.join("peer-b", "mona", targetWs);
	});

	it("test_signal_sameBoardTargetOnline_forwardsEnvelope", () => {
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

	it("test_signal_crossBoard_dropsEnvelope", () => {
		// peer-b を別板に移す → 板またぎ signal は drop
		const otherWs = mockWs();
		registry.join("peer-b", "yaruo", otherWs);

		handleClientMessage(
			JSON.stringify({ type: "signal", envelope: dummyEnvelope }),
			senderWs,
			registry,
			vi.fn(),
		);
		expect(otherWs.send).not.toHaveBeenCalled();
	});

	it("test_signal_targetDisconnected_silentlyDrops", () => {
		const disconnectedWs = mockWs(WebSocket.CLOSED);
		registry.join("peer-c", "mona", disconnectedWs);
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

	it("test_joinMissingBoardId_ignoresAndDoesNotClose", () => {
		handleClientMessage(
			JSON.stringify({ type: "join", peerId: "peer-a" }),
			ws,
			registry,
			vi.fn(),
		);
		expect(ws.send).not.toHaveBeenCalled();
		expect(ws.close).not.toHaveBeenCalled();
		expect(registry.has("peer-a")).toBe(false);
	});

	it("test_joinMissingPeerId_ignoresAndDoesNotClose", () => {
		handleClientMessage(
			JSON.stringify({ type: "join", boardId: "mona" }),
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
			registry.join(`peer-${i}`, "mona", mockWs());
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

		ws.emit("message", joinMsg("peer-a", "mona"));

		expect(registry.has("peer-a")).toBe(true);
	});

	it("test_connection_closeAfterJoin_removesPeerFromRegistry", () => {
		const ws = mockWs();
		createConnectionHandler(registry)(ws);

		ws.emit("message", joinMsg("peer-a", "mona"));
		expect(registry.has("peer-a")).toBe(true);

		ws.emit("close");
		expect(registry.has("peer-a")).toBe(false);
	});

	it("test_connection_errorAfterJoin_removesPeerFromRegistry", () => {
		const ws = mockWs();
		createConnectionHandler(registry)(ws);

		ws.emit("message", joinMsg("peer-a", "mona"));
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

		ws.emit("message", joinMsg("peer-a", "mona"));
		ws.emit("close");
		ws.emit("close");

		expect(registry.size()).toBe(0);
	});

	it("test_connection_reHomeAcrossConnections_oldCloseKeepsReHomedPeer", () => {
		// 接続1 で join → 接続2 で同じ peerId が再 join（再接続レース）
		const ws1 = mockWs();
		const ws2 = mockWs();
		createConnectionHandler(registry)(ws1);
		createConnectionHandler(registry)(ws2);

		ws1.emit("message", joinMsg("peer-a", "mona"));
		ws2.emit("message", joinMsg("peer-a", "mona"));
		expect(registry.get("peer-a")).toBe(ws2);

		// 旧接続が遅れて close しても、現役の peer-a は残る
		ws1.emit("close");
		expect(registry.has("peer-a")).toBe(true);
		expect(registry.get("peer-a")).toBe(ws2);
	});
});
