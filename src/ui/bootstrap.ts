import { WebRTCGateway } from "@/core/adapter/gossip/WebRTCGateway";
import { DEFAULT_BOARD_ID, DEFAULT_THREAD_ID } from "@/core/config/constants";
import { GossipController } from "@/core/controller/GossipController";
import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPeerConnectionFactory } from "@/core/domain/port/IPeerConnectionFactory";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import type { ISignalingTransport } from "@/core/domain/port/ISignalingTransport";
import type { CryptoService } from "@/core/domain/service/CryptoService";
import type { LamportClock } from "@/core/domain/service/LamportClock";
import { ExchangeDigestUseCase } from "@/core/usecase/ExchangeDigestUseCase";
import { PeerManager } from "@/core/usecase/PeerManager";
import { ReceiveMessageUseCase } from "@/core/usecase/ReceiveMessageUseCase";

export type BootstrapResult = {
	peerManager: PeerManager;
	gateway: IGossipMessageGateway;
	exchangeDigestUseCase: ExchangeDigestUseCase;
	receiveUseCase: ReceiveMessageUseCase;
	controller: GossipController;
};

/**
 * P2P ネットワーク層の依存関係を組み立てて返す。
 * PeerManager ↔ WebRTCGateway ↔ ExchangeDigestUseCase の循環を let で閉じる。
 */
export function bootstrap(
	signalingTransport: ISignalingTransport,
	peerConnectionFactory: IPeerConnectionFactory,
	selfId: string,
	postStore: IPostStore,
	crypto: CryptoService,
	clock: LamportClock,
	logger: ILogger,
): BootstrapResult {
	let gateway: WebRTCGateway;
	let exchangeDigestUseCase: ExchangeDigestUseCase;

	const peerManager = new PeerManager(
		signalingTransport,
		peerConnectionFactory,
		selfId,
		(remotePeerId, dc) => {
			dc.onMessage((raw) => gateway.handleIncoming(remotePeerId, raw));
			exchangeDigestUseCase.onPeerConnected(remotePeerId);
			dc.onClose(() => exchangeDigestUseCase.onPeerDisconnected(remotePeerId));
		},
		logger,
	);

	gateway = new WebRTCGateway(peerManager.activeChannels);

	const receiveUseCase = new ReceiveMessageUseCase(
		postStore,
		crypto,
		clock,
		selfId,
		gateway,
		logger,
	);
	const controller = new GossipController(gateway, receiveUseCase);

	exchangeDigestUseCase = new ExchangeDigestUseCase(
		DEFAULT_BOARD_ID,
		DEFAULT_THREAD_ID,
		postStore,
		gateway,
		clock,
		logger,
	);

	return {
		peerManager,
		gateway,
		exchangeDigestUseCase,
		receiveUseCase,
		controller,
	};
}
