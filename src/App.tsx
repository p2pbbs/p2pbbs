import { useEffect, useState } from "react";
import { WebCryptoSigner } from "@/adapter/crypto/WebCryptoSigner";
import { InMemoryPostStore } from "@/adapter/storage/InMemoryPostStore";
import { DEFAULT_BOARD_ID, DEFAULT_THREAD_ID } from "@/config/constants";
import type { Post } from "@/domain/model/Post";
import { CryptoService } from "@/domain/service/CryptoService";
import { LamportClock } from "@/domain/service/LamportClock";
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
const signer = new WebCryptoSigner();
const cryptoService = new CryptoService(signer);
const clock = new LamportClock();
const postStore = new InMemoryPostStore(
	new Map([[DEFAULT_THREAD_ID, [GENESIS_POST]]]),
);

type Identity = { publicKey: string; odId: string };

function App() {
	const [identity, setIdentity] = useState<Identity | null>(null);
	const [initError, setInitError] = useState(false);

	useEffect(() => {
		(async () => {
			try {
				const { publicKey } = await signer.generateKeyPair();
				const odId = await cryptoService.deriveOdId(publicKey);
				setIdentity({ publicKey, odId });
			} catch {
				setInitError(true);
			}
		})();
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
		/>
	);
}

export default App;
