/** ピア: 接続中の他ノード。通信手段は Adapter が内部管理する。 */
export type Peer = {
	readonly id: string;
	readonly connectedAt: number;
};
