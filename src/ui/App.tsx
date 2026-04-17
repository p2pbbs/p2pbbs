import { useEffect, useState } from "react";
import { WebCryptoSigner } from "@/core/adapter/crypto/WebCryptoSigner";
import { BroadcastChannelGateway } from "@/core/adapter/gossip/BroadcastChannelGateway";
import { ConsoleLogger } from "@/core/adapter/logging/ConsoleLogger";
import { IndexedDBPostStore } from "@/core/adapter/storage/IndexedDBPostStore";
import { DEFAULT_BOARD_ID, DEFAULT_THREAD_ID } from "@/core/config/constants";
import { GossipController } from "@/core/controller/GossipController";
import type { Post } from "@/core/domain/model/Post";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { LamportClock } from "@/core/domain/service/LamportClock";
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

type Identity = { publicKey: string; odId: string };

function App() {
	const [identity, setIdentity] = useState<Identity | null>(null);
	const [initError, setInitError] = useState(false);

	useEffect(() => {
		let active = true;
		let controller: GossipController | null = null;

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
					odId,
					gateway,
					logger,
				);
				controller = new GossipController(gateway, receiveUseCase);
				controller.start();
			} catch {
				if (active) setInitError(true);
			}
		})();

		return () => {
			active = false;
			controller?.stop();
		};
	}, []);

	if (initError) {
		return (
			<div className="flex items-center justify-center h-screen text-red-600 text-sm">
				Web Crypto API に対応していないブラウザです。
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
			gateway={gateway}
		/>
	);
}

export default App;
