import ReconnectingWebSocket from "reconnecting-websocket";
import { SIGNALING_DISCOVER_TIMEOUT_MS } from "@/core/config/constants";
import type { PeerId } from "@/core/domain/model/ids";
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
	private pendingPeersResolve: ((peers: PeerId[]) => void) | undefined;
	/** 再接続時に join を再送するために保持する Peer ID。 */
	private joinedPeerId: PeerId | undefined;
	/** 再接続時の join 再送に含める板 ID。板切り替えで上書きされる。 */
	private joinedBoardId: string | undefined;

	constructor(url: string, logger: ILogger) {
		this.logger = logger;
		this.ws = new ReconnectingWebSocket(url);
		this.ws.addEventListener("open", () => {
			if (this.joinedPeerId !== undefined && this.joinedBoardId !== undefined) {
				this.ws.send(
					JSON.stringify({
						type: "join",
						peerId: this.joinedPeerId,
						boardId: this.joinedBoardId,
					}),
				);
			}
		});
		this.ws.addEventListener("message", (event: MessageEvent<string>) => {
			this.handleMessage(event.data);
		});
	}

	/**
	 * 指定した板に join して、同じ板の既存ピア一覧を返す。
	 * WebSocket 接続は板に依存しない 1 本を使い回し、板切り替えは新しい boardId で
	 * join を再送するだけ（接続の切断・再接続はしない）。
	 * 再接続後も自動で join を再送するため Peer ID と板 ID を内部に保持する。
	 * SIGNALING_DISCOVER_TIMEOUT_MS 以内に応答がなければ SignalingTimeoutError を throw する。
	 */
	discover(myPeerId: PeerId, boardId: string): Promise<PeerId[]> {
		this.joinedPeerId = myPeerId;
		this.joinedBoardId = boardId;
		return new Promise((resolve, reject) => {
			// resolver 自身を識別子に使い、後続の discover に追い越された古い timer が
			// 新しい discover の resolver を消さないようガードする（板の連続切り替え対策）。
			const resolver = (peers: PeerId[]) => {
				clearTimeout(timer);
				if (this.pendingPeersResolve === resolver) {
					this.pendingPeersResolve = undefined;
				}
				resolve(peers);
			};
			const timer = setTimeout(() => {
				if (this.pendingPeersResolve === resolver) {
					this.pendingPeersResolve = undefined;
				}
				reject(new SignalingTimeoutError());
			}, SIGNALING_DISCOVER_TIMEOUT_MS);

			this.pendingPeersResolve = resolver;

			if (this.ws.readyState === WebSocket.OPEN) {
				this.ws.send(
					JSON.stringify({ type: "join", peerId: myPeerId, boardId }),
				);
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
			// TODO(rapid-board-switch): discover(mona)→discover(yaruo) を連続で呼ぶと、
			// 先に届く mona の peers が（既に yaruo に差し替わった）resolver を resolve し、
			// yaruo の Promise が mona のピアで解決されうる。signal relay の板検証で
			// 誤接続は drop され、10秒後の定期 digest で自然回復するため実害は軽微。
			// 恒久対応: peers レスポンスに boardId を含め、joinedBoardId 不一致なら無視する
			// （サーバー側の対応も必要）。
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
