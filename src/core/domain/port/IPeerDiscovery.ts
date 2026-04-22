/**
 * シグナリング経由のピア発見。
 * 自分の Peer ID を提示して、接続可能なピアの ID 一覧を得る。
 */
export interface IPeerDiscovery {
	discover(myPeerId: string): Promise<string[]>;
}
