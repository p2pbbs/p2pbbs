import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";
import type { ReceiveGossipUseCase } from "@/core/usecase/ReceiveGossipUseCase";

/**
 * GossipController: UseCase と Gateway の配線役。
 * App.tsx が start() / stop() を呼ぶ。
 * Gateway の onReceive を購読して ReceiveGossipUseCase.execute() を呼ぶ。
 * Adapter は UseCase を知らない。UseCase は Adapter の具象を知らない。
 */
export class GossipController {
	private unsubscribe: (() => void) | null = null;
	private readonly gateway: IGossipMessageGateway;
	private readonly receiveUseCase: ReceiveGossipUseCase;

	constructor(
		gateway: IGossipMessageGateway,
		receiveUseCase: ReceiveGossipUseCase,
	) {
		this.gateway = gateway;
		this.receiveUseCase = receiveUseCase;
	}

	start(): void {
		this.unsubscribe = this.gateway.onReceive((msg) => {
			void this.receiveUseCase.execute(msg);
		});
	}

	stop(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}
}
