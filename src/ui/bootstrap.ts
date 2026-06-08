import { WebRTCGateway } from "@/core/adapter/gossip/WebRTCGateway";
import { GossipController } from "@/core/controller/GossipController";
import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";
import { PostIngester } from "@/core/domain/service/PostIngester";
import { ThreadIngester } from "@/core/domain/service/ThreadIngester";
import { CreateThreadUseCase } from "@/core/usecase/CreateThreadUseCase";
import { ExchangeDigestUseCase } from "@/core/usecase/ExchangeDigestUseCase";
import { PeerManager } from "@/core/usecase/PeerManager";
import { ReceiveMessageUseCase } from "@/core/usecase/ReceiveMessageUseCase";
import type { Session } from "./session";

/**
 * 板単位の P2P セッション。1 板 = 1 ゴシップスワームとして扱い、
 * 板切り替え時に dispose() で破棄して別の板用に作り直す。
 */
export type BoardSession = {
	boardId: string;
	gateway: IGossipMessageGateway;
	exchangeDigestUseCase: ExchangeDigestUseCase;
	createThreadUseCase: CreateThreadUseCase;
	peerManager: PeerManager;
	controller: GossipController;
	/** WebRTC 接続・購読・タイマーをすべて解放する。 */
	dispose: () => void;
};

/**
 * 指定した板の P2P レイヤを組み立てる。
 * PeerManager ↔ WebRTCGateway ↔ ExchangeDigestUseCase の循環を let で閉じる。
 *
 * 板切り替え時はこの関数で作った BoardSession を dispose して作り直す
 * （WebRTC 接続を再構築し、ExchangeDigestUseCase を板単位で再生成する）。
 */
export function bootstrapBoard(
	boardId: string,
	session: Session,
): BoardSession {
	const { postStore, threadStore, crypto, clockMap, peerId, logger } = session;

	// 接続先板の各スレの LamportClock を保存済み投稿の最大値で初期化する。
	// lamport はスレ単位で独立するため、スレごとに最大値で merge する。
	for (const threadId of postStore.getThreadIds(boardId)) {
		const max = postStore
			.getSnapshot(threadId)
			.reduce((m, p) => Math.max(m, p.lamport), 0);
		clockMap.get(threadId).merge(max);
	}

	let gateway: WebRTCGateway;
	let exchangeDigestUseCase: ExchangeDigestUseCase;

	const peerManager = new PeerManager(
		session.signaling,
		session.factory,
		peerId,
		(remotePeerId, dc) => {
			dc.onMessage((raw) => gateway.handleIncoming(remotePeerId, raw));
			exchangeDigestUseCase.onPeerConnected(remotePeerId);
			dc.onClose(() => exchangeDigestUseCase.onPeerDisconnected(remotePeerId));
		},
		logger,
	);

	gateway = new WebRTCGateway(peerManager.activeChannels);

	// Ingester は gossip 受信と sync 受信の両方で共有する（seen Set を共有して重複排除）
	const postIngester = new PostIngester(postStore, crypto, clockMap, logger);
	const threadIngester = new ThreadIngester(threadStore, crypto, logger);

	const receiveUseCase = new ReceiveMessageUseCase(
		postIngester,
		threadIngester,
		peerId,
		gateway,
		logger,
	);
	const controller = new GossipController(gateway, receiveUseCase);

	const createThreadUseCase = new CreateThreadUseCase(
		postStore,
		crypto,
		clockMap,
		threadIngester,
		{
			publicKey: session.publicKey,
			odId: session.odId,
			peerId,
			boardId,
		},
		gateway,
	);

	exchangeDigestUseCase = new ExchangeDigestUseCase(
		boardId,
		postStore,
		threadStore,
		postIngester,
		threadIngester,
		gateway,
		clockMap,
		logger,
	);

	return {
		boardId,
		gateway,
		exchangeDigestUseCase,
		createThreadUseCase,
		peerManager,
		controller,
		dispose: () => {
			controller.stop();
			peerManager.dispose();
			exchangeDigestUseCase.dispose();
		},
	};
}
