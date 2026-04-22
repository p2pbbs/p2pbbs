import { STUN_URL } from "@/core/config/constants";
import type { IPeerConnection } from "@/core/domain/port/IPeerConnection";
import type { IPeerConnectionFactory } from "@/core/domain/port/IPeerConnectionFactory";
import { BrowserPeerConnection } from "./BrowserPeerConnection";

/** RTCPeerConnection を生成するブラウザ実装。STUN のみ使用し TURN は使わない。 */
export class BrowserPeerConnectionFactory implements IPeerConnectionFactory {
	create(): IPeerConnection {
		const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URL }] });
		return new BrowserPeerConnection(pc);
	}
}
