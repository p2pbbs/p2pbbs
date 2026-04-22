import type { IPeerConnection } from "./IPeerConnection";

export interface IPeerConnectionFactory {
	create(): IPeerConnection;
}
