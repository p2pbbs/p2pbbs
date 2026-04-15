import { DEFAULT_NAME } from "@/config/constants";
import type { IPostStore } from "@/domain/port/IPostStore";
import type { CryptoService } from "@/domain/service/CryptoService";
import type { LamportClock } from "@/domain/service/LamportClock";

type PostInput = {
	name: string;
	body: string;
};

/**
 * レスを投稿する UseCase。署名してローカルに保存する。
 * ネットワーク伝播は Story 3 で追加する。
 */
export class PostMessageUseCase {
	constructor(
		private readonly postStore: IPostStore,
		private readonly crypto: CryptoService,
		private readonly clock: LamportClock,
		private readonly publicKey: string,
		private readonly odId: string,
		private readonly threadId: string,
		private readonly boardId: string,
	) {}

	async execute(input: PostInput): Promise<void> {
		const lamport = this.clock.tick();
		const draft = {
			name: input.name.trim() || DEFAULT_NAME,
			body: input.body.trim(),
			odId: this.odId,
			timestamp: Date.now(),
			lamport,
			publicKey: this.publicKey,
			boardId: this.boardId,
			threadId: this.threadId,
		};
		const post = await this.crypto.sign(draft);
		await this.postStore.save(post);
	}
}
