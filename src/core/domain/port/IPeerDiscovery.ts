/**
 * シグナリング経由のピア発見。
 * 自分の Peer ID と所属板を提示して、同じ板の接続可能なピアの ID 一覧を得る。
 */
export interface IPeerDiscovery {
	discover(myPeerId: string, boardId: string): Promise<string[]>;
}
