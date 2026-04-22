import { useEffect, useState } from "react";
import { WebCryptoSigner } from "@/core/adapter/crypto/WebCryptoSigner";
import { BroadcastChannelGateway } from "@/core/adapter/gossip/BroadcastChannelGateway";
import { ConsoleLogger } from "@/core/adapter/logging/ConsoleLogger";
import { BrowserPeerConnectionFactory } from "@/core/adapter/peer/BrowserPeerConnectionFactory";
import {
	SignalingTimeoutError,
	WebSocketSignalingTransport,
} from "@/core/adapter/signaling/WebSocketSignalingTransport";
import { IndexedDBPostStore } from "@/core/adapter/storage/IndexedDBPostStore";
import {
	DEFAULT_BOARD_ID,
	DEFAULT_THREAD_ID,
	SIGNALING_URL,
} from "@/core/config/constants";
import { GossipController } from "@/core/controller/GossipController";
import type { Post } from "@/core/domain/model/Post";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { LamportClock } from "@/core/domain/service/LamportClock";
import { PeerManager } from "@/core/usecase/PeerManager";
import { ReceiveMessageUseCase } from "@/core/usecase/ReceiveMessageUseCase";
import { BoardPage } from "./components/pages/BoardPage";

const GENESIS_POST: Post = {
	id: "genesis",
	name: "名無しさん",
	body: "このスレを立てました。",
	odId: "00000000",
	timestamp: 0,
	lamport: 0,
	signature: "",
	publicKey: "",
	boardId: DEFAULT_BOARD_ID,
	threadId: DEFAULT_THREAD_ID,
};

// セッション中に1度だけ生成するシングルトン
const logger = new ConsoleLogger();
const signer = new WebCryptoSigner();
const cryptoService = new CryptoService(signer);
const clock = new LamportClock();
const postStore = new IndexedDBPostStore(logger);
const gateway = new BroadcastChannelGateway("nch", logger);
const signaling = new WebSocketSignalingTransport(SIGNALING_URL, logger);
const peerConnectionFactory = new BrowserPeerConnectionFactory();

// タブ起動ごとにランダム UUID を生成する。セッションをまたいで変わってよい
const peerId = crypto.randomUUID();

type InitError = { message: string; reloadable: boolean };

function App() {
	const [identity, setIdentity] = useState<{
		publicKey: string;
		odId: string;
	} | null>(null);
	const [initError, setInitError] = useState<InitError | null>(null);

	useEffect(() => {
		let active = true;
		let controller: GossipController | null = null;
		let peerManager: PeerManager | null = null;

		(async () => {
			try {
				// IndexedDB からメモリに復元し、LamportClock を最大 lamport 値で初期化する
				const { maxLamport } = await postStore.load();
				clock.merge(maxLamport);

				// 初回起動時のみジェネシス投稿を保存する
				if (postStore.getSnapshot(DEFAULT_THREAD_ID).length === 0) {
					await postStore.save(GENESIS_POST);
				}

				const { publicKey } = await signer.generateKeyPair();
				const odId = await cryptoService.deriveOdId(publicKey);
				if (!active) return;

				setIdentity({ publicKey, odId });

				const receiveUseCase = new ReceiveMessageUseCase(
					postStore,
					cryptoService,
					clock,
					peerId,
					gateway,
					logger,
				);
				controller = new GossipController(gateway, receiveUseCase);
				controller.start();

				// シグナリングでピアを発見し WebRTC 接続を確立する
				peerManager = new PeerManager(
					signaling,
					peerConnectionFactory,
					peerId,
					(_remotePeerId, _dc) => {
						// Story 8 で WebRTCGateway に登録する
					},
					logger,
				);

				const peers = await signaling.discover(peerId);
				if (!active) return;

				for (const remotePeerId of peers) {
					peerManager.connectTo(remotePeerId);
				}
			} catch (err) {
				if (!active) return;
				if (err instanceof SignalingTimeoutError) {
					setInitError({
						message: "シグナリングサーバーに接続できません... orz",
						reloadable: true,
					});
				} else {
					setInitError({
						message: "Web Crypto API に対応していないブラウザです。",
						reloadable: false,
					});
				}
			}
		})();

		return () => {
			active = false;
			controller?.stop();
			peerManager?.dispose();
		};
	}, []);

	if (initError) {
		return (
			<div className="flex flex-col items-center justify-center h-screen gap-3 text-sm text-red-600">
				<p>{initError.message}</p>
				{initError.reloadable && (
					<button
						type="button"
						onClick={() => window.location.reload()}
						className="px-4 py-2 text-white bg-red-600 rounded hover:bg-red-700"
					>
						ページをリロード
					</button>
				)}
			</div>
		);
	}

	if (!identity) {
		return null;
	}

	return (
		<BoardPage
			store={postStore}
			cryptoService={cryptoService}
			clock={clock}
			publicKey={identity.publicKey}
			odId={identity.odId}
			peerId={peerId}
			gateway={gateway}
		/>
	);
}

export default App;
