import type { SignalingEnvelope } from "../../src/core/domain/model/SignalingEnvelope";

/** SDP offer のダミーデータ */
export const dummySdp: RTCSessionDescriptionInit = {
	type: "offer",
	sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n",
};

/** ICE candidate のダミーデータ */
export const dummyIceCandidate: RTCIceCandidateInit = {
	candidate: "candidate:1 1 udp 2122260223 192.168.0.1 54321 typ host",
	sdpMid: "0",
	sdpMLineIndex: 0,
};

/** テスト用の有効な SignalingEnvelope */
export function makeEnvelope(
	overrides: Partial<SignalingEnvelope> = {},
): SignalingEnvelope {
	return {
		from: "peer-a",
		to: "peer-b",
		payload: { type: "offer", sdp: dummySdp },
		...overrides,
	};
}
