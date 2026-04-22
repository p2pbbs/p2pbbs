import type { IDataChannel } from "@/core/domain/port/IDataChannel";
import type { IDataChannelEvents } from "@/core/domain/port/IDataChannelEvents";

/** RTCDataChannel を IDataChannel / IDataChannelEvents にラップするブラウザ実装。 */
export class BrowserDataChannel implements IDataChannel, IDataChannelEvents {
	private readonly dc: RTCDataChannel;

	constructor(dc: RTCDataChannel) {
		this.dc = dc;
	}

	send(data: string): void {
		this.dc.send(data);
	}

	close(): void {
		this.dc.close();
	}

	onMessage(handler: (data: string) => void): () => void {
		const listener = (e: MessageEvent<string>) => handler(e.data);
		this.dc.addEventListener("message", listener);
		return () => this.dc.removeEventListener("message", listener);
	}

	onOpen(handler: () => void): () => void {
		if (this.dc.readyState === "open") {
			handler();
			return () => {};
		}
		this.dc.addEventListener("open", handler);
		return () => this.dc.removeEventListener("open", handler);
	}

	onClose(handler: () => void): () => void {
		this.dc.addEventListener("close", handler);
		return () => this.dc.removeEventListener("close", handler);
	}
}
