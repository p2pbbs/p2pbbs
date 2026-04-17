import { DEFAULT_NAME, TTL_INITIAL } from "@/core/config/constants";
import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import type { CryptoService } from "@/core/domain/service/CryptoService";
import type { LamportClock } from "@/core/domain/service/LamportClock";

type PostInput = {
	name: string;
	body: string;
};

/**
 * レスを投稿する UseCase。署名してローカルに保存し、ゴシップで伝播する。
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
		private readonly gateway: IGossipMessageGateway,
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

		const msg: GossipMessage = {
			type: "post",
			post,
			ttl: TTL_INITIAL,
			path: [this.odId],
		};
		this.gateway.send(msg);
	}
}
