import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalingEnvelope } from "@/core/domain/model/SignalingEnvelope";
import {
	dummyIceCandidate,
	dummySdp,
	makeEnvelope,
} from "../../helpers/mockSignaling";

const PEER_ID = "my-peer-uuid";

// reconnecting-websocket を最小スタブに差し替える
let lastWs: {
	send: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	readyState: number;
	simulateOpen: () => void;
	simulateMessage: (data: unknown) => void;
	simulateRawMessage: (raw: string) => void;
} | null = null;

vi.mock("reconnecting-websocket", () => {
	return {
		default: class MockRWS {
			send = vi.fn();
			close = vi.fn();
			readyState: number = WebSocket.CONNECTING;
			private openHandlers: ((e: Event) => void)[] = [];
			private messageHandlers: ((e: MessageEvent) => void)[] = [];

			constructor() {
				const self = this;
				lastWs = {
					send: self.send,
					close: self.close,
					get readyState() {
						return self.readyState;
					},
					set readyState(v: number) {
						self.readyState = v;
					},
					simulateOpen: () => {
						self.readyState = WebSocket.OPEN;
						for (const h of self.openHandlers) h(new Event("open"));
					},
					simulateMessage: (data: unknown) => {
						for (const h of self.messageHandlers)
							h(new MessageEvent("message", { data: JSON.stringify(data) }));
					},
					simulateRawMessage: (raw: string) => {
						for (const h of self.messageHandlers)
							h(new MessageEvent("message", { data: raw }));
					},
				};
			}

			addEventListener(type: string, handler: (e: Event) => void): void {
				if (type === "open") this.openHandlers.push(handler);
				else if (type === "message")
					this.messageHandlers.push(handler as (e: MessageEvent) => void);
			}
		},
	};
});

async function makeTransport() {
	const { WebSocketSignalingTransport } = await import(
		"@/core/adapter/signaling/WebSocketSignalingTransport"
	);
	const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const transport = new WebSocketSignalingTransport(
		"ws://localhost:8080",
		logger,
	);
	if (!lastWs) throw new Error("MockRWS not instantiated");
	const ws = lastWs;
	return { transport, ws, logger };
}

describe("WebSocketSignalingTransport", () => {
	beforeEach(() => {
		lastWs = null;
		vi.resetModules();
	});

	// --- discover ---

	it("test_discover_whenAlreadyOpen_sendsJoinImmediately", async () => {
		const { transport, ws } = await makeTransport();
		ws.simulateOpen();
		ws.send.mockClear();

		void transport.discover(PEER_ID);

		expect(ws.send).toHaveBeenCalledOnce();
		const msg = JSON.parse(ws.send.mock.calls[0]?.[0] as string);
		expect(msg).toEqual({ type: "join", peerId: PEER_ID });
	});

	it("test_discover_whenNotYetOpen_sendsJoinOnOpen", async () => {
		const { transport, ws } = await makeTransport();

		void transport.discover(PEER_ID);
		expect(ws.send).not.toHaveBeenCalled();

		ws.simulateOpen();
		expect(ws.send).toHaveBeenCalledOnce();
		const msg = JSON.parse(ws.send.mock.calls[0]?.[0] as string);
		expect(msg).toEqual({ type: "join", peerId: PEER_ID });
	});

	it("test_discover_resolvesWithPeersList", async () => {
		const { transport, ws } = await makeTransport();
		ws.simulateOpen();

		const promise = transport.discover(PEER_ID);
		ws.simulateMessage({ type: "peers", peers: ["peer-a", "peer-b"] });

		await expect(promise).resolves.toEqual(["peer-a", "peer-b"]);
	});

	it("test_discover_reconnect_resendsJoin", async () => {
		const { transport, ws } = await makeTransport();
		ws.simulateOpen();
		void transport.discover(PEER_ID);
		ws.send.mockClear();

		// 再接続
		ws.simulateOpen();

		expect(ws.send).toHaveBeenCalledOnce();
		const msg = JSON.parse(ws.send.mock.calls[0]?.[0] as string);
		expect(msg).toEqual({ type: "join", peerId: PEER_ID });
	});

	// --- send / onMessage ---

	it("test_send_validEnvelope_sendsSignalMessage", async () => {
		const { transport, ws } = await makeTransport();
		const envelope = makeEnvelope();
		transport.send(envelope);
		const msg = JSON.parse(ws.send.mock.calls[0]?.[0] as string);
		expect(msg).toEqual({ type: "signal", envelope });
	});

	it("test_onMessage_signalMessage_callsHandler", async () => {
		const { transport, ws } = await makeTransport();
		const handler = vi.fn();
		transport.onMessage(handler);
		const envelope = makeEnvelope({ from: "peer-x", to: PEER_ID });
		ws.simulateMessage({ type: "signal", envelope });
		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith(envelope);
	});

	it("test_onMessage_unsubscribe_stopsReceiving", async () => {
		const { transport, ws } = await makeTransport();
		const handler = vi.fn();
		const unsubscribe = transport.onMessage(handler);
		unsubscribe();
		ws.simulateMessage({ type: "signal", envelope: makeEnvelope() });
		expect(handler).not.toHaveBeenCalled();
	});

	it("test_onMessage_iceCandidate_callsHandler", async () => {
		const { transport, ws } = await makeTransport();
		const handler = vi.fn();
		transport.onMessage(handler);
		const envelope: SignalingEnvelope = {
			from: "peer-x",
			to: PEER_ID,
			payload: { type: "ice-candidate", candidate: dummyIceCandidate },
		};
		ws.simulateMessage({ type: "signal", envelope });
		expect(handler).toHaveBeenCalledWith(envelope);
	});

	it("test_onMessage_answerPayload_callsHandler", async () => {
		const { transport, ws } = await makeTransport();
		const handler = vi.fn();
		transport.onMessage(handler);
		const envelope: SignalingEnvelope = {
			from: "peer-x",
			to: PEER_ID,
			payload: { type: "answer", sdp: { ...dummySdp, type: "answer" } },
		};
		ws.simulateMessage({ type: "signal", envelope });
		expect(handler).toHaveBeenCalledWith(envelope);
	});

	// --- エラー耐性 ---

	it("test_receive_invalidJson_logsWarningAndDoesNotCrash", async () => {
		const { ws, logger } = await makeTransport();
		ws.simulateRawMessage("not-json{{");
		expect(logger.warn).toHaveBeenCalledWith(
			"signaling.invalid_json",
			expect.anything(),
		);
	});

	it("test_receive_unknownMessageType_logsWarningAndDoesNotCrash", async () => {
		const { ws, logger } = await makeTransport();
		ws.simulateMessage({ type: "unknown_type", foo: "bar" });
		expect(logger.warn).toHaveBeenCalledWith(
			"signaling.invalid_message",
			expect.anything(),
		);
	});

	it("test_receive_serverError_logsWarning", async () => {
		const { ws, logger } = await makeTransport();
		ws.simulateMessage({
			type: "error",
			code: "capacity_exceeded",
			message: "too many peers",
		});
		expect(logger.warn).toHaveBeenCalledWith(
			"signaling.server_error",
			expect.objectContaining({ code: "capacity_exceeded" }),
		);
	});

	// --- disconnect ---

	it("test_disconnect_closesWebSocket", async () => {
		const { transport, ws } = await makeTransport();
		transport.disconnect();
		expect(ws.close).toHaveBeenCalledOnce();
	});
});
