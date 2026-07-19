import type { PeerId } from "../model/ids";

/**
 * シグナリング経由のピア発見。
 * 自分の Peer ID と所属板を提示して、同じ板の接続可能なピアの ID 一覧を得る。
 */
export interface IPeerDiscovery {
	discover(myPeerId: PeerId, boardId: string): Promise<PeerId[]>;
}
