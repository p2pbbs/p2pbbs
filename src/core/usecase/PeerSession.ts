import type { PeerId } from "@/core/domain/model/ids";
import type { SignalingEnvelope } from "@/core/domain/model/SignalingEnvelope";
import type { IDataChannel } from "@/core/domain/port/IDataChannel";
import type { IDataChannelEvents } from "@/core/domain/port/IDataChannelEvents";
import type { IPeerConnection } from "@/core/domain/port/IPeerConnection";

/**
 * 1ピアとの WebRTC 接続ライフサイクルを管理する。
 * offer/answer/ICE ハンドシェイク手順を閉じ込める。
 */
export class PeerSession {
	private readonly selfId: PeerId;
	private readonly peerId: PeerId;
	private readonly pc: IPeerConnection;
	private readonly sendSignal: (envelope: SignalingEnvelope) => void;
	private readonly onChannelReady: (
		dc: IDataChannel & IDataChannelEvents,
	) => void;
	private readonly cleanups: (() => void)[] = [];

	constructor(
		selfId: PeerId,
		peerId: PeerId,
		pc: IPeerConnection,
		sendSignal: (envelope: SignalingEnvelope) => void,
		onChannelReady: (dc: IDataChannel & IDataChannelEvents) => void,
	) {
		this.selfId = selfId;
		this.peerId = peerId;
		this.pc = pc;
		this.sendSignal = sendSignal;
		this.onChannelReady = onChannelReady;

		const unsub = pc.onIceCandidate((candidate) => {
			sendSignal({
				from: selfId,
				to: peerId,
				payload: { type: "ice-candidate", candidate },
			});
		});
		this.cleanups.push(unsub);
	}

	/** 自分が offer 側。DataChannel を作成し offer を送る。 */
	async initiateOffer(): Promise<void> {
		const dc = this.pc.createDataChannel("nch");
		const unsub = dc.onOpen(() => {
			this.onChannelReady(dc);
		});
		this.cleanups.push(unsub);
		const offer = await this.pc.createOffer();
		await this.pc.setLocalDescription(offer);
		this.sendSignal({
			from: this.selfId,
			to: this.peerId,
			payload: { type: "offer", sdp: offer },
		});
	}

	/** 相手の offer を受けて answer を返す。 */
	async handleOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
		const unsub = this.pc.onDataChannel((dc) => {
			dc.onOpen(() => {
				this.onChannelReady(dc);
			});
		});
		this.cleanups.push(unsub);
		await this.pc.setRemoteDescription(sdp);
		const answer = await this.pc.createAnswer();
		await this.pc.setLocalDescription(answer);
		this.sendSignal({
			from: this.selfId,
			to: this.peerId,
			payload: { type: "answer", sdp: answer },
		});
	}

	/** 相手の answer を受け取る。 */
	async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
		await this.pc.setRemoteDescription(sdp);
	}

	/** ICE candidate を受け取る。 */
	async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
		await this.pc.addIceCandidate(candidate);
	}

	close(): void {
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups.length = 0;
		this.pc.close();
	}
}
