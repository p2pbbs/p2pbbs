import ReconnectingWebSocket from "reconnecting-websocket";
import { SIGNALING_DISCOVER_TIMEOUT_MS } from "@/core/config/constants";
import type { SignalingEnvelope } from "@/core/domain/model/SignalingEnvelope";
import { ServerMessageSchema } from "@/core/domain/model/SignalingMessage";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPeerDiscovery } from "@/core/domain/port/IPeerDiscovery";
import type { ISignalingTransport } from "@/core/domain/port/ISignalingTransport";

/** シグナリングサーバーへの接続がタイムアウトしたときにスローされる。 */
export class SignalingTimeoutError extends Error {
	constructor() {
		super("シグナリングサーバーに接続できません");
		this.name = "SignalingTimeoutError";
	}
}

/**
 * WebSocket ベースのシグナリングトランスポート。
 * reconnecting-websocket による自動再接続つき。
 * ISignalingTransport（SDP/ICE の中継）と IPeerDiscovery（ピア発見）の両方を実装する。
 */
export class WebSocketSignalingTransport
	implements ISignalingTransport, IPeerDiscovery
{
	private readonly ws: ReconnectingWebSocket;
	private readonly handlers = new Set<(envelope: SignalingEnvelope) => void>();
	private readonly logger: ILogger;
	/** discover() で登録した一時ハンドラ。peers 受信後に解除する。 */
	private pendingPeersResolve: ((peers: string[]) => void) | undefined;
	/** 再接続時に join を再送するために保持する Peer ID。 */
	private joinedPeerId: string | undefined;

	constructor(url: string, logger: ILogger) {
		this.logger = logger;
		this.ws = new ReconnectingWebSocket(url);
		this.ws.addEventListener("open", () => {
			if (this.joinedPeerId) {
				this.ws.send(
					JSON.stringify({ type: "join", peerId: this.joinedPeerId }),
				);
			}
		});
		this.ws.addEventListener("message", (event: MessageEvent<string>) => {
			this.handleMessage(event.data);
		});
	}

	/**
	 * シグナリングサーバーに join して既存ピアの一覧を返す。
	 * 再接続後も自動で join を再送するため Peer ID を内部に保持する。
	 * SIGNALING_DISCOVER_TIMEOUT_MS 以内に応答がなければ SignalingTimeoutError を throw する。
	 */
	discover(myPeerId: string): Promise<string[]> {
		this.joinedPeerId = myPeerId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingPeersResolve = undefined;
				reject(new SignalingTimeoutError());
			}, SIGNALING_DISCOVER_TIMEOUT_MS);

			this.pendingPeersResolve = (peers) => {
				clearTimeout(timer);
				this.pendingPeersResolve = undefined;
				resolve(peers);
			};

			if (this.ws.readyState === WebSocket.OPEN) {
				this.ws.send(JSON.stringify({ type: "join", peerId: myPeerId }));
			}
		});
	}

	private handleMessage(data: string): void {
		let raw: unknown;
		try {
			raw = JSON.parse(data);
		} catch {
			this.logger.warn("signaling.invalid_json", {});
			return;
		}

		const result = ServerMessageSchema.safeParse(raw);
		if (!result.success) {
			this.logger.warn("signaling.invalid_message", {
				error: result.error.message,
			});
			return;
		}

		const msg = result.data;
		if (msg.type === "peers") {
			this.pendingPeersResolve?.(msg.peers);
		} else if (msg.type === "signal") {
			for (const handler of this.handlers) {
				handler(msg.envelope);
			}
		} else {
			this.logger.warn("signaling.server_error", {
				code: msg.code,
				message: msg.message,
			});
		}
	}

	send(envelope: SignalingEnvelope): void {
		this.ws.send(JSON.stringify({ type: "signal", envelope }));
	}

	onMessage(handler: (envelope: SignalingEnvelope) => void): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	disconnect(): void {
		this.ws.close();
	}
}
