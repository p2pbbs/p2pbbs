import {
	HEARTBEAT_INTERVAL_MS,
	HEARTBEAT_TIMEOUT_MS,
	MAX_ACTIVE_PEERS,
} from "@/core/config/constants";
import { DataChannelMessageSchema } from "@/core/domain/model/DataChannelMessage";
import type { SignalingEnvelope } from "@/core/domain/model/SignalingEnvelope";
import type { IDataChannel } from "@/core/domain/port/IDataChannel";
import type { IDataChannelEvents } from "@/core/domain/port/IDataChannelEvents";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPeerConnectionFactory } from "@/core/domain/port/IPeerConnectionFactory";
import type { ISignalingTransport } from "@/core/domain/port/ISignalingTransport";
import { HeartbeatTracker } from "@/core/domain/service/HeartbeatTracker";
import { PeerSession } from "./PeerSession";

/**
 * シグナリングメッセージを振り分け、PeerSession のライフサイクルを管理する Mediator。
 * ロジックは持たず PeerSession に委譲する。
 */
export class PeerManager {
	private readonly signaling: ISignalingTransport;
	private readonly factory: IPeerConnectionFactory;
	private readonly selfId: string;
	/** DataChannel open 時に呼ばれる外部コールバック（Story 8 で WebRTCGateway に渡す）。 */
	private readonly onChannel: (
		peerId: string,
		dc: IDataChannel & IDataChannelEvents,
	) => void;
	private readonly logger: ILogger;

	private readonly sessions = new Map<string, PeerSession>();
	/** heartbeat 送信用。send のみ必要なので IDataChannel で保持する。 */
	private readonly channels = new Map<string, IDataChannel>();
	/** onMessage / onClose の unsubscribe 関数。removeSession 時に呼ぶ。 */
	private readonly channelCleanups = new Map<string, () => void>();
	private readonly heartbeat: HeartbeatTracker;
	private readonly unsubSignaling: () => void;

	constructor(
		signaling: ISignalingTransport,
		factory: IPeerConnectionFactory,
		selfId: string,
		onChannel: (peerId: string, dc: IDataChannel & IDataChannelEvents) => void,
		logger: ILogger,
		intervalMs = HEARTBEAT_INTERVAL_MS,
		timeoutMs = HEARTBEAT_TIMEOUT_MS,
	) {
		this.signaling = signaling;
		this.factory = factory;
		this.selfId = selfId;
		this.onChannel = onChannel;
		this.logger = logger;

		this.heartbeat = new HeartbeatTracker(
			(peerId) => {
				const dc = this.channels.get(peerId);
				if (dc) dc.send(JSON.stringify({ type: "heartbeat" }));
			},
			(peerId) => {
				this.logger.warn("peer_manager.peer_dead", { peerId });
				this.removeSession(peerId);
			},
			intervalMs,
			timeoutMs,
		);
		this.heartbeat.start(() => [...this.channels.keys()]);
		this.unsubSignaling = signaling.onMessage((env) => this.route(env));
	}

	/** discover で得たピアへの接続を開始する。 */
	connectTo(targetId: string): void {
		if (this.sessions.size >= MAX_ACTIVE_PEERS) {
			this.logger.warn("peer_manager.max_peers_reached", { targetId });
			return;
		}
		if (this.sessions.has(targetId)) return;

		const session = this.createSession(targetId);
		session.initiateOffer().catch((err: unknown) => {
			this.logger.error("peer_manager.offer_failed", {
				targetId,
				error: String(err),
			});
			this.removeSession(targetId);
		});
	}

	/** セッションを除去してリソースを解放する。 */
	removeSession(peerId: string): void {
		const session = this.sessions.get(peerId);
		if (!session) return;
		session.close();
		this.sessions.delete(peerId);
		this.channels.delete(peerId);
		this.channelCleanups.get(peerId)?.();
		this.channelCleanups.delete(peerId);
		this.heartbeat.removePeer(peerId);
	}

	/** PeerManager が所有する channels Map への ReadonlyMap 参照。WebRTCGateway に渡す。 */
	get activeChannels(): ReadonlyMap<string, IDataChannel> {
		return this.channels;
	}

	/** HeartbeatTracker を停止し、シグナリング購読を解除する。 */
	dispose(): void {
		this.heartbeat.stop();
		this.unsubSignaling();
		for (const peerId of [...this.sessions.keys()]) {
			this.removeSession(peerId);
		}
	}

	private route(env: SignalingEnvelope): void {
		const { from, payload } = env;

		if (payload.type === "offer") {
			if (this.sessions.has(from)) {
				if (this.selfId < from) {
					// 自分の Peer ID が小さい → 自分の offer が勝つ。相手の offer を無視
					return;
				}
				// 相手の Peer ID が小さい → 既存 session を破棄して相手の offer を受け入れる
				this.removeSession(from);
			}
			if (this.sessions.size >= MAX_ACTIVE_PEERS) {
				this.logger.warn("peer_manager.max_peers_reached_offer", { from });
				return;
			}
			const session = this.createSession(from);
			session.handleOffer(payload.sdp).catch((err: unknown) => {
				this.logger.error("peer_manager.handle_offer_failed", {
					from,
					error: String(err),
				});
				this.removeSession(from);
			});
		} else if (payload.type === "answer") {
			this.sessions
				.get(from)
				?.handleAnswer(payload.sdp)
				.catch((err: unknown) => {
					this.logger.error("peer_manager.handle_answer_failed", {
						from,
						error: String(err),
					});
				});
		} else if (payload.type === "ice-candidate") {
			this.sessions
				.get(from)
				?.addIceCandidate(payload.candidate)
				.catch((err: unknown) => {
					this.logger.error("peer_manager.add_ice_candidate_failed", {
						from,
						error: String(err),
					});
				});
		}
	}

	private createSession(peerId: string): PeerSession {
		const pc = this.factory.create();
		const session = new PeerSession(
			this.selfId,
			peerId,
			pc,
			(env) => this.signaling.send(env),
			(dc) => this.onChannelReady(peerId, dc),
		);
		this.sessions.set(peerId, session);
		return session;
	}

	/**
	 * DataChannel が open になったときに呼ばれる。
	 * heartbeat のライフサイクル（trackPeer / removePeer）はピア管理の一部なのでここで処理する。
	 * gossip メッセージの内容には触らず、外部の onChannel コールバックに委譲する。
	 */
	private onChannelReady(
		peerId: string,
		dc: IDataChannel & IDataChannelEvents,
	): void {
		this.channels.set(peerId, dc);
		this.heartbeat.trackPeer(peerId);
		this.logger.info("peer_manager.channel_open", { peerId });

		const unsubMessage = dc.onMessage((raw) =>
			this.handleHeartbeat(peerId, raw),
		);
		const unsubClose = dc.onClose(() => this.removeSession(peerId));
		this.channelCleanups.set(peerId, () => {
			unsubMessage();
			unsubClose();
		});

		this.onChannel(peerId, dc);
	}

	private handleHeartbeat(peerId: string, raw: string): void {
		try {
			const result = DataChannelMessageSchema.safeParse(JSON.parse(raw));
			if (!result.success) return;
			if (result.data.type === "heartbeat") {
				this.heartbeat.receiveFrom(peerId);
				this.logger.info("peer_manager.heartbeat_received", { peerId });
			}
		} catch {
			// malformed JSON は無視
		}
	}
}
