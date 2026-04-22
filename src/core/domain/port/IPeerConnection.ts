import type { IDataChannel } from "./IDataChannel";
import type { IDataChannelEvents } from "./IDataChannelEvents";

export interface IPeerConnection {
	createDataChannel(label: string): IDataChannel & IDataChannelEvents;
	createOffer(): Promise<RTCSessionDescriptionInit>;
	createAnswer(): Promise<RTCSessionDescriptionInit>;
	setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void>;
	setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void>;
	addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
	onIceCandidate(handler: (candidate: RTCIceCandidateInit) => void): () => void;
	onDataChannel(
		handler: (channel: IDataChannel & IDataChannelEvents) => void,
	): () => void;
	close(): void;
}
