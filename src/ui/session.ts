import { createContext, useContext } from "react";
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
 * セッション全体で 1 度だけ生成する依存の束。
 * 板をまたいで共有される（ストア・鍵・シグナリング）。
 * 板単位の P2P レイヤは BoardSession 側が持つ。
 */
export type Session = {
	postStore: IPostStore;
	threadStore: IThreadStore;
	/** 既読履歴。スレ単位で表示済み post.id を保持し、未読判定に使う。 */
	readHistory: IReadHistoryStore;
	crypto: CryptoService;
	clockMap: LamportClockMap;
	/** タブごとのランダム UUID（Peer ID）。 */
	peerId: string;
	publicKey: string;
	/** 表示用 ID（公開鍵ハッシュ先頭8文字）。 */
	odId: string;
	signaling: ISignalingTransport;
	factory: IPeerConnectionFactory;
	/**
	 * 指定板に join して同じ板のピア一覧を得る。板入場のたびに呼ぶ。
	 * WebSocket 接続は使い回し、板切り替えは新 boardId で join を再送するだけ。
	 * サーバーは同一 peerId の再 join を re-home（板の付け替え）として扱う。
	 */
	discoverPeers: (boardId: string) => Promise<string[]>;
	logger: ILogger;
};

const SessionContext = createContext<Session | null>(null);
export const SessionProvider = SessionContext.Provider;

export function useSession(): Session {
	const session = useContext(SessionContext);
	if (!session) {
		throw new Error("useSession must be used within a SessionProvider");
	}
	return session;
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
