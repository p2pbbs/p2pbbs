import { useEffect, useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import { SignalingTimeoutError } from "@/core/adapter/signaling/WebSocketSignalingTransport";
import { BOARDS } from "@/core/config/constants";
import type { BoardSession } from "@/ui/bootstrap";
import { bootstrapBoard } from "@/ui/bootstrap";
import { BoardSessionProvider, useSession } from "@/ui/session";
import { NotFound } from "./NotFound";

type ConnectState =
	| { status: "connecting" }
	| { status: "ready"; session: BoardSession }
	| { status: "error" };

/**
 * 板ルートのレイアウト。板単位の P2P セッション（BoardSession）を所有する。
 *
 * boardId が変わるたびに前の BoardSession を dispose し、新しい板用に作り直す
 * （WebRTC 接続を再構築し、ExchangeDigestUseCase を板単位で再生成する）。
 * シグナリングへの join も板ごとに行い、同じ板のピアにだけ接続する。
 * WebSocket 接続自体は使い回す（board に依存しない）。
 */
export function BoardLayout() {
	const session = useSession();
	const { boardId } = useParams();
	const board = BOARDS.find((b) => b.boardId === boardId);
	const [state, setState] = useState<ConnectState>({ status: "connecting" });

	useEffect(() => {
		if (!board) return;

		let active = true;
		setState({ status: "connecting" });

		const bs = bootstrapBoard(board.boardId, session);
		bs.controller.start();

		session
			.discoverPeers(board.boardId)
			.then((peers) => {
				if (!active) return;
				for (const remotePeerId of peers) {
					bs.peerManager.connectTo(remotePeerId);
				}
				setState({ status: "ready", session: bs });
			})
			.catch((err: unknown) => {
				if (!active) return;
				if (err instanceof SignalingTimeoutError) {
					session.logger.warn("board_layout.discover_timeout", {
						boardId: board.boardId,
					});
				} else {
					session.logger.error("board_layout.discover_error", {
						boardId: board.boardId,
						err: String(err),
					});
				}
				setState({ status: "error" });
			});

		return () => {
			active = false;
			bs.dispose();
		};
	}, [board, session]);

	if (!board) {
		return <NotFound message="板が見つかりません" />;
	}

	if (state.status === "error") {
		return (
			<div className="flex flex-col items-center justify-center h-screen gap-3 text-sm text-red-600">
				<p>シグナリングサーバーに接続できません... orz</p>
				<div className="flex items-center gap-4">
					{/* まず板一覧へ戻って再試行（WebSocket・IndexedDB を保つ軽い導線） */}
					<Link
						to="/"
						className="text-blue-600 dark:text-blue-400 hover:underline"
					>
						板一覧へ戻る
					</Link>
					<button
						type="button"
						onClick={() => window.location.reload()}
						className="px-4 py-2 text-white bg-red-600 rounded hover:bg-red-700"
					>
						ページをリロード
					</button>
				</div>
			</div>
		);
	}

	if (state.status === "connecting") {
		return (
			<div className="flex items-center justify-center h-screen text-sm text-gray-500">
				板に接続中...
			</div>
		);
	}

	return (
		<BoardSessionProvider value={state.session}>
			<Outlet context={state.session} />
		</BoardSessionProvider>
	);
}
