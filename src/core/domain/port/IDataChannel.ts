export interface IDataChannel {
	send(data: string): void;
	close(): void;
}
