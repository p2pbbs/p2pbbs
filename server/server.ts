import express from "express";
import { WebSocket } from "ws";
import type { SignalingEnvelope } from "@/core/domain/model/SignalingEnvelope.ts";
import { SignalingErrorCode } from "@/core/domain/model/SignalingErrorCode.ts";
import type { ServerMessage } from "@/core/domain/model/SignalingMessage.ts";
import { ClientMessageSchema } from "@/core/domain/model/SignalingMessage.ts";

export const MAX_CONNECTIONS = 1000;
const MAX_PEERS_RETURNED = 3;

/**
 * 板別にピアを管理するレジストリ。
 * 同じ板のピアだけをマッチング（randomPeers）し、signal リレーも板内に限定する。
 */
export class PeerRegistry {
	/** peerId → WebSocket。signal リレーの宛先解決に使う。 */
	private readonly peers = new Map<string, WebSocket>();
	/** peerId → boardId。離脱・signal 検証の逆引きに使う。 */
	private readonly peerBoard = new Map<string, string>();
	/** boardId → Set<peerId>。同板ピアの列挙に使う。 */
	private readonly boardPeers = new Map<string, Set<string>>();

	/**
	 * ピアを板に登録する（join / re-home）。
	 * 既に別板に居た場合は旧板から外して新板へ付け替える。
	 * 同一 peerId の再 join は WebSocket を last-writer-wins で置換する
	 * （再接続レース・板切り替えの両方をこれで吸収する）。
	 */
	join(peerId: string, boardId: string, ws: WebSocket): void {
		const prevBoard = this.peerBoard.get(peerId);
		if (prevBoard !== undefined && prevBoard !== boardId) {
			this.removeFromBoard(peerId, prevBoard);
		}
		this.peers.set(peerId, ws);
		this.peerBoard.set(peerId, boardId);
		let set = this.boardPeers.get(boardId);
		if (set === undefined) {
			set = new Set();
			this.boardPeers.set(boardId, set);
		}
		set.add(peerId);
	}

	/**
	 * close 時の削除。ws が現在の登録と一致するときだけ消す。
	 * re-home（別 ws での再 join）後に旧 ws が遅れて close しても、
	 * 新しい登録を巻き込まない。削除したら true。
	 */
	removeIfCurrent(peerId: string, ws: WebSocket): boolean {
		if (this.peers.get(peerId) !== ws) return false;
		this.remove(peerId);
		return true;
	}

	remove(peerId: string): void {
		const boardId = this.peerBoard.get(peerId);
		this.peers.delete(peerId);
		this.peerBoard.delete(peerId);
		if (boardId !== undefined) {
			this.removeFromBoard(peerId, boardId);
		}
	}

	get(peerId: string): WebSocket | undefined {
		return this.peers.get(peerId);
	}

	has(peerId: string): boolean {
		return this.peers.has(peerId);
	}

	boardOf(peerId: string): string | undefined {
		return this.peerBoard.get(peerId);
	}

	size(): number {
		return this.peers.size;
	}

	/** 同じ板の自分以外のピアをシャッフルして count 件返す。 */
	randomPeers(peerId: string, boardId: string, count: number): string[] {
		const all = [...(this.boardPeers.get(boardId) ?? [])].filter(
			(id) => id !== peerId,
		);
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

	private removeFromBoard(peerId: string, boardId: string): void {
		const set = this.boardPeers.get(boardId);
		if (set === undefined) return;
		set.delete(peerId);
		if (set.size === 0) this.boardPeers.delete(boardId);
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
 * 切断するのは容量超過のみ（重複 Peer ID は re-home で吸収するので切らない）。
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
		registry.join(msg.peerId, msg.boardId, ws);
		onJoin(msg.peerId);
		console.log(
			`[signaling] peer joined: ${msg.peerId} board=${msg.boardId} (total: ${registry.size()})`,
		);
		sendMessage(ws, {
			type: "peers",
			peers: registry.randomPeers(msg.peerId, msg.boardId, MAX_PEERS_RETURNED),
		});
	} else {
		forwardSignal(msg.envelope, registry);
	}
}

function forwardSignal(
	envelope: SignalingEnvelope,
	registry: PeerRegistry,
): void {
	// 板をまたぐ signal は drop する（各板の mesh を独立させる）。
	const fromBoard = registry.boardOf(envelope.from);
	const toBoard = registry.boardOf(envelope.to);
	if (toBoard === undefined || fromBoard !== toBoard) return;

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
				// re-home 後の旧 ws の close では消さない（removeIfCurrent がガード）
				if (registry.removeIfCurrent(peerId, ws)) {
					console.log(
						`[signaling] peer left: ${peerId} (total: ${registry.size()})`,
					);
				}
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
