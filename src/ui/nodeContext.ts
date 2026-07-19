import { createContext, useContext } from "react";
import type { OdId, PeerId } from "@/core/domain/model/ids";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPeerConnectionFactory } from "@/core/domain/port/IPeerConnectionFactory";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import type { IReadHistoryStore } from "@/core/domain/port/IReadHistoryStore";
import type { ISignalingTransport } from "@/core/domain/port/ISignalingTransport";
import type { IThreadStore } from "@/core/domain/port/IThreadStore";
import type { CryptoService } from "@/core/domain/service/CryptoService";
import type { LamportClockMap } from "@/core/domain/service/LamportClockMap";
import type { BoardSession } from "./bootstrap";

/**
 * このタブ = 1 つの P2P ノードの文脈。タブ起動時に一度だけ生成する資源の束
 * （鍵・peerId・ストア・シグナリング）。板をまたいで共有される。
 * 板単位の P2P レイヤは BoardSession 側が持つ。
 */
export type NodeContext = {
	postStore: IPostStore;
	threadStore: IThreadStore;
	/** 既読履歴。スレ単位で表示済み post.id を保持し、未読判定に使う。 */
	readHistory: IReadHistoryStore;
	crypto: CryptoService;
	clockMap: LamportClockMap;
	peerId: PeerId;
	publicKey: string;
	odId: OdId;
	signaling: ISignalingTransport;
	factory: IPeerConnectionFactory;
	/**
	 * 指定板に join して同じ板のピア一覧を得る。板入場のたびに呼ぶ。
	 * WebSocket 接続は使い回し、板切り替えは新 boardId で join を再送するだけ。
	 * サーバーは同一 peerId の再 join を re-home（板の付け替え）として扱う。
	 */
	discoverPeers: (boardId: string) => Promise<PeerId[]>;
	logger: ILogger;
};

const NodeContextContext = createContext<NodeContext | null>(null);
export const NodeContextProvider = NodeContextContext.Provider;

export function useNodeContext(): NodeContext {
	const nodeCtx = useContext(NodeContextContext);
	if (!nodeCtx) {
		throw new Error("useNodeContext must be used within a NodeContextProvider");
	}
	return nodeCtx;
}

/**
 * 板単位の P2P セッションを子ルートへ渡す Context。
 * BoardLayout が <Outlet> 経由で供給するが、明示的な Context も用意して
 * Smart Component から型安全に参照できるようにする。
 */
const BoardSessionContext = createContext<BoardSession | null>(null);
export const BoardSessionProvider = BoardSessionContext.Provider;

export function useBoardSession(): BoardSession {
	const board = useContext(BoardSessionContext);
	if (!board) {
		throw new Error("useBoardSession must be used within a BoardLayout");
	}
	return board;
}
