export interface IDataChannelEvents {
	onMessage(handler: (data: string) => void): () => void;
	onOpen(handler: () => void): () => void;
	onClose(handler: () => void): () => void;
}
