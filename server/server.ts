import express from "express";
import { WebSocket } from "ws";
import type { SignalingEnvelope } from "@/core/domain/model/SignalingEnvelope.ts";
import { SignalingErrorCode } from "@/core/domain/model/SignalingErrorCode.ts";
import type { ServerMessage } from "@/core/domain/model/SignalingMessage.ts";
import { ClientMessageSchema } from "@/core/domain/model/SignalingMessage.ts";

export const MAX_CONNECTIONS = 1000;
const MAX_PEERS_RETURNED = 3;

export class PeerRegistry {
	private readonly peers = new Map<string, WebSocket>();

	add(peerId: string, ws: WebSocket): void {
		this.peers.set(peerId, ws);
	}

	remove(peerId: string): void {
		this.peers.delete(peerId);
	}

	get(peerId: string): WebSocket | undefined {
		return this.peers.get(peerId);
	}

	has(peerId: string): boolean {
		return this.peers.has(peerId);
	}

	size(): number {
		return this.peers.size;
	}

	randomPeers(exclude: string, count: number): string[] {
		const all = [...this.peers.keys()].filter((id) => id !== exclude);
		for (let i = all.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const a = all[i];
			const b = all[j];
			if (a !== undefined && b !== undefined) {
				all[i] = b;
				all[j] = a;
			}
		}
		return all.slice(0, count);
	}
}

export function sendMessage(ws: WebSocket, msg: ServerMessage): void {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(msg));
	}
}

/**
 * クライアントから受信したメッセージを処理する。
 * 不正な JSON / スキーマ不一致は ignore（ログのみ）。接続は切らない。
 * 切断するのは容量超過と重複 Peer ID のみ。
 */
export function handleClientMessage(
	data: string,
	ws: WebSocket,
	registry: PeerRegistry,
	onJoin: (peerId: string) => void,
): void {
	let json: unknown;
	try {
		json = JSON.parse(data);
	} catch {
		console.warn("[signaling] invalid JSON received");
		return;
	}

	const parsed = ClientMessageSchema.safeParse(json);
	if (!parsed.success) {
		console.warn("[signaling] unknown message type");
		return;
	}

	const msg = parsed.data;

	if (msg.type === "join") {
		if (registry.has(msg.peerId)) {
			sendMessage(ws, {
				type: "error",
				code: SignalingErrorCode.INVALID_MESSAGE,
				message: "Peer ID already connected",
			});
			ws.close(1008);
			return;
		}
		registry.add(msg.peerId, ws);
		onJoin(msg.peerId);
		console.log(
			`[signaling] peer joined: ${msg.peerId} (total: ${registry.size()})`,
		);
		sendMessage(ws, {
			type: "peers",
			peers: registry.randomPeers(msg.peerId, MAX_PEERS_RETURNED),
		});
	} else {
		forwardSignal(msg.envelope, registry);
	}
}

function forwardSignal(
	envelope: SignalingEnvelope,
	registry: PeerRegistry,
): void {
	const target = registry.get(envelope.to);
	if (target !== undefined && target.readyState === WebSocket.OPEN) {
		console.log(
			`[signaling] relay: ${envelope.from} → ${envelope.to} (${envelope.payload.type})`,
		);
		sendMessage(target, { type: "signal", envelope });
	}
	// Target not found or disconnected: silently drop (client handles ICE timeout)
}

/** WebSocket 接続ごとのハンドラを返す。wss.on("connection", ...) に渡す。 */
export function createConnectionHandler(
	registry: PeerRegistry,
): (ws: WebSocket) => void {
	return (ws: WebSocket) => {
		if (registry.size() >= MAX_CONNECTIONS) {
			console.warn(
				`[signaling] connection rejected: capacity exceeded (${registry.size()}/${MAX_CONNECTIONS})`,
			);
			sendMessage(ws, {
				type: "error",
				code: SignalingErrorCode.CAPACITY_EXCEEDED,
				message: "Server is at capacity",
			});
			ws.close(1008);
			return;
		}

		let peerId: string | null = null;

		const cleanup = () => {
			if (peerId !== null) {
				registry.remove(peerId);
				console.log(
					`[signaling] peer left: ${peerId} (total: ${registry.size()})`,
				);
				peerId = null;
			}
		};

		ws.on("message", (data) => {
			handleClientMessage(data.toString(), ws, registry, (id) => {
				peerId = id;
			});
		});

		// error の後に必ず close が発火するが、cleanup は冪等なので両方に登録する
		ws.on("close", cleanup);
		ws.on("error", cleanup);
	};
}

export function createApp(registry: PeerRegistry): express.Application {
	const app = express();

	app.use((_req, res, next) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");
		next();
	});

	app.get("/health", (_req, res) => {
		res.json({ status: "ok", peers: registry.size() });
	});

	return app;
}
