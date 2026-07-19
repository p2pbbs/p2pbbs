import { describe, expect, it, vi } from "vitest";
import { GossipController } from "@/core/controller/GossipController";
import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import type { ReceiveGossipUseCase } from "@/core/usecase/ReceiveGossipUseCase";
import { makeGossipMessage } from "../helpers/fixtures";

/**
 * GossipController の配線テスト。
 * GossipController はルーティングのみ担当するため、テストは「正しい相手に正しく繋ぐか」に絞る。
 * ReceiveGossipUseCase はモックで十分。実装詳細に依存しない。
 */
function makeController() {
	const unsubscribe = vi.fn();
	let capturedHandler: ((msg: GossipMessage) => void) | null = null;

	const gateway = {
		send: vi.fn(),
		onReceive: vi.fn((handler: (msg: GossipMessage) => void) => {
			capturedHandler = handler;
			return unsubscribe;
		}),
	};

	const executeSpy = vi.fn().mockResolvedValue(undefined);
	const receiveUseCase = {
		execute: executeSpy,
	} as unknown as ReceiveGossipUseCase;

	const controller = new GossipController(gateway, receiveUseCase);

	return {
		controller,
		gateway,
		executeSpy,
		unsubscribe,
		triggerReceive: (msg: GossipMessage) => capturedHandler?.(msg),
	};
}

describe("GossipController", () => {
	it("test_start_RegistersReceiveHandlerOnGateway", () => {
		const { controller, gateway } = makeController();
		controller.start();
		expect(gateway.onReceive).toHaveBeenCalledOnce();
	});

	it("test_start_ReceivedMessage_DelegatesTo_ReceiveUseCase", async () => {
		const { controller, executeSpy, triggerReceive } = makeController();
		controller.start();
		const msg = makeGossipMessage();
		triggerReceive(msg);
		await vi.waitFor(() => expect(executeSpy).toHaveBeenCalledWith(msg));
	});

	it("test_stop_CallsUnsubscribe", () => {
		const { controller, unsubscribe } = makeController();
		controller.start();
		controller.stop();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("test_stop_BeforeStart_DoesNotThrow", () => {
		const { controller } = makeController();
		expect(() => controller.stop()).not.toThrow();
	});

	it("test_stop_Twice_UnsubscribesOnlyOnce", () => {
		const { controller, unsubscribe } = makeController();
		controller.start();
		controller.stop();
		controller.stop();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
