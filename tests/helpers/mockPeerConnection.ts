import { vi } from "vitest";
import type { IDataChannel } from "../../src/core/domain/port/IDataChannel";
import type { IDataChannelEvents } from "../../src/core/domain/port/IDataChannelEvents";
import type { IPeerConnection } from "../../src/core/domain/port/IPeerConnection";
import type { IPeerConnectionFactory } from "../../src/core/domain/port/IPeerConnectionFactory";

export type MockIDataChannel = IDataChannel &
	IDataChannelEvents & {
		send: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
		_triggerOpen(): void;
		_triggerClose(): void;
		_triggerMessage(data: string): void;
	};

export type MockIPeerConnection = IPeerConnection & {
	createDataChannel: ReturnType<typeof vi.fn>;
	createOffer: ReturnType<typeof vi.fn>;
	createAnswer: ReturnType<typeof vi.fn>;
	setLocalDescription: ReturnType<typeof vi.fn>;
	setRemoteDescription: ReturnType<typeof vi.fn>;
	addIceCandidate: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	_dc: MockIDataChannel;
	_triggerIceCandidate(candidate: RTCIceCandidateInit): void;
	_triggerDataChannel(dc: IDataChannel & IDataChannelEvents): void;
};

export function createMockIDataChannel(): MockIDataChannel {
	const openHandlers: (() => void)[] = [];
	const closeHandlers: (() => void)[] = [];
	const messageHandlers: ((data: string) => void)[] = [];

	return {
		send: vi.fn<(data: string) => void>(),
		close: vi.fn<() => void>(),
		onMessage(handler) {
			messageHandlers.push(handler);
			return () => {
				const idx = messageHandlers.indexOf(handler);
				if (idx !== -1) messageHandlers.splice(idx, 1);
			};
		},
		onOpen(handler) {
			openHandlers.push(handler);
			return () => {
				const idx = openHandlers.indexOf(handler);
				if (idx !== -1) openHandlers.splice(idx, 1);
			};
		},
		onClose(handler) {
			closeHandlers.push(handler);
			return () => {
				const idx = closeHandlers.indexOf(handler);
				if (idx !== -1) closeHandlers.splice(idx, 1);
			};
		},
		_triggerOpen() {
			for (const h of [...openHandlers]) h();
		},
		_triggerClose() {
			for (const h of [...closeHandlers]) h();
		},
		_triggerMessage(data) {
			for (const h of [...messageHandlers]) h(data);
		},
	};
}

export function createMockIPeerConnection(): MockIPeerConnection {
	let iceCandidateHandlers: ((candidate: RTCIceCandidateInit) => void)[] = [];
	let dataChannelHandlers: ((
		channel: IDataChannel & IDataChannelEvents,
	) => void)[] = [];
	const dc = createMockIDataChannel();

	return {
		createDataChannel: vi.fn().mockReturnValue(dc),
		createOffer: vi
			.fn()
			.mockResolvedValue({ type: "offer", sdp: "dummy-offer-sdp" }),
		createAnswer: vi
			.fn()
			.mockResolvedValue({ type: "answer", sdp: "dummy-answer-sdp" }),
		setLocalDescription: vi.fn().mockResolvedValue(undefined),
		setRemoteDescription: vi.fn().mockResolvedValue(undefined),
		addIceCandidate: vi.fn().mockResolvedValue(undefined),
		onIceCandidate(handler) {
			iceCandidateHandlers.push(handler);
			return () => {
				iceCandidateHandlers = iceCandidateHandlers.filter(
					(h) => h !== handler,
				);
			};
		},
		onDataChannel(handler) {
			dataChannelHandlers.push(handler);
			return () => {
				dataChannelHandlers = dataChannelHandlers.filter((h) => h !== handler);
			};
		},
		close: vi.fn<() => void>(),
		_dc: dc,
		_triggerIceCandidate(candidate) {
			for (const h of iceCandidateHandlers) h(candidate);
		},
		_triggerDataChannel(channel) {
			for (const h of dataChannelHandlers) h(channel);
		},
	};
}

export type MockIPeerConnectionFactory = IPeerConnectionFactory & {
	create: ReturnType<typeof vi.fn>;
};

export function createMockFactory(
	pc: MockIPeerConnection,
): MockIPeerConnectionFactory {
	return { create: vi.fn().mockReturnValue(pc) };
}
