import { useEffect, useState } from "react";
import { WebCryptoSigner } from "@/adapter/crypto/WebCryptoSigner";
import { BroadcastChannelGateway } from "@/adapter/gossip/BroadcastChannelGateway";
import { ConsoleLogger } from "@/adapter/logging/ConsoleLogger";
import { InMemoryPostStore } from "@/adapter/storage/InMemoryPostStore";
import { DEFAULT_BOARD_ID, DEFAULT_THREAD_ID } from "@/config/constants";
import { GossipController } from "@/controller/GossipController";
import type { Post } from "@/domain/model/Post";
import { CryptoService } from "@/domain/service/CryptoService";
import { LamportClock } from "@/domain/service/LamportClock";
import { ReceiveMessageUseCase } from "@/usecase/ReceiveMessageUseCase";
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
const postStore = new InMemoryPostStore(
	new Map([[DEFAULT_THREAD_ID, [GENESIS_POST]]]),
);
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
