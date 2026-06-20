import { useEffect, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { WebCryptoSigner } from "@/core/adapter/crypto/WebCryptoSigner";
import { ConsoleLogger } from "@/core/adapter/logging/ConsoleLogger";
import { BrowserPeerConnectionFactory } from "@/core/adapter/peer/BrowserPeerConnectionFactory";
import { WebSocketSignalingTransport } from "@/core/adapter/signaling/WebSocketSignalingTransport";
import { IndexedDBPostStore } from "@/core/adapter/storage/IndexedDBPostStore";
import { IndexedDBReadHistoryStore } from "@/core/adapter/storage/IndexedDBReadHistoryStore";
import { IndexedDBThreadStore } from "@/core/adapter/storage/IndexedDBThreadStore";
import { SIGNALING_URL } from "@/core/config/constants";
import { CryptoService } from "@/core/domain/service/CryptoService";
import { LamportClockMap } from "@/core/domain/service/LamportClockMap";
import { BoardLayout } from "./components/pages/BoardLayout";
import { BoardListView } from "./components/pages/BoardListView";
import { NotFound } from "./components/pages/NotFound";
import { ThreadListView } from "./components/pages/ThreadListView";
import { ThreadPage } from "./components/pages/ThreadPage";
import type { Session } from "./session";
import { SessionProvider } from "./session";

// セッション中に1度だけ生成するシングルトン
const logger = new ConsoleLogger();
const signer = new WebCryptoSigner();
const cryptoService = new CryptoService(signer);
const clockMap = new LamportClockMap();
const postStore = new IndexedDBPostStore(logger);
const threadStore = new IndexedDBThreadStore(logger);
const readHistory = new IndexedDBReadHistoryStore(logger);
const signaling = new WebSocketSignalingTransport(SIGNALING_URL, logger);
const peerConnectionFactory = new BrowserPeerConnectionFactory();

// タブ起動ごとにランダム UUID を生成する。セッションをまたいで変わってよい
const peerId = crypto.randomUUID();

type InitError = { message: string; reloadable: boolean };

/**
 * IndexedDB からメモリに復元する。
 * LamportClock の初期化は板選択時（bootstrapBoard）に接続先板の分だけ行う。
 */
async function initStores(): Promise<void> {
	await Promise.all([postStore.load(), threadStore.load(), readHistory.load()]);
}

function App() {
	const [session, setSession] = useState<Session | null>(null);
	const [initError, setInitError] = useState<InitError | null>(null);

	useEffect(() => {
		let active = true;

		(async () => {
			try {
				await initStores();

				// Ed25519 非対応ブラウザはここで throw する（fatal）
				const { publicKey } = await signer.generateKeyPair();
				const odId = await cryptoService.deriveOdId(publicKey);
				if (!active) return;

				// signaling への join は板入場時に板ごとに行う（BoardLayout）。
				// WebSocket 接続自体は使い回す。
				setSession({
					postStore,
					threadStore,
					readHistory,
					crypto: cryptoService,
					clockMap,
					peerId,
					publicKey,
					odId,
					signaling,
					factory: peerConnectionFactory,
					discoverPeers: (boardId) => signaling.discover(peerId, boardId),
					logger,
				});
			} catch (err) {
				if (!active) return;
				logger.error("app.init_failed", { err });
				setInitError({
					message: "初期化に失敗しました（Web Crypto API 非対応の可能性）。",
					reloadable: false,
				});
			}
		})();

		return () => {
			active = false;
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

	if (!session) {
		return (
			<div className="flex items-center justify-center h-screen text-sm text-gray-500">
				初期化中...
			</div>
		);
	}

	return (
		<SessionProvider value={session}>
			<HashRouter>
				<Routes>
					<Route path="/" element={<BoardListView />} />
					<Route path="/board/:boardId" element={<BoardLayout />}>
						<Route index element={<ThreadListView />} />
						<Route path=":threadId" element={<ThreadPage />} />
					</Route>
					<Route
						path="*"
						element={<NotFound message="ページが見つかりません" />}
					/>
				</Routes>
			</HashRouter>
		</SessionProvider>
	);
}

export default App;
