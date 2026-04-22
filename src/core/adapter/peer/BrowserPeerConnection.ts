import type { IDataChannel } from "@/core/domain/port/IDataChannel";
import type { IDataChannelEvents } from "@/core/domain/port/IDataChannelEvents";
import type { IPeerConnection } from "@/core/domain/port/IPeerConnection";
import { BrowserDataChannel } from "./BrowserDataChannel";

/** RTCPeerConnection を IPeerConnection にラップするブラウザ実装。 */
export class BrowserPeerConnection implements IPeerConnection {
	private readonly pc: RTCPeerConnection;

	constructor(pc: RTCPeerConnection) {
		this.pc = pc;
	}

	createDataChannel(label: string): IDataChannel & IDataChannelEvents {
		return new BrowserDataChannel(this.pc.createDataChannel(label));
	}

	createOffer(): Promise<RTCSessionDescriptionInit> {
		return this.pc.createOffer();
	}

	createAnswer(): Promise<RTCSessionDescriptionInit> {
		return this.pc.createAnswer();
	}

	async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
		await this.pc.setLocalDescription(desc);
	}

	async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
		await this.pc.setRemoteDescription(desc);
	}

	async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
		await this.pc.addIceCandidate(candidate);
	}

	onIceCandidate(
		handler: (candidate: RTCIceCandidateInit) => void,
	): () => void {
		const listener = (e: RTCPeerConnectionIceEvent) => {
			if (e.candidate) handler(e.candidate.toJSON());
		};
		this.pc.addEventListener("icecandidate", listener);
		return () => this.pc.removeEventListener("icecandidate", listener);
	}

	onDataChannel(
		handler: (channel: IDataChannel & IDataChannelEvents) => void,
	): () => void {
		const listener = (e: RTCDataChannelEvent) => {
			handler(new BrowserDataChannel(e.channel));
		};
		this.pc.addEventListener("datachannel", listener);
		return () => this.pc.removeEventListener("datachannel", listener);
	}

	close(): void {
		this.pc.close();
	}
}
