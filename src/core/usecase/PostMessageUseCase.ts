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

export type PostMessageConfig = {
	publicKey: string;
	/** 投稿者の表示用 ID（公開鍵ハッシュ先頭8文字）。 */
	odId: string;
	/** ゴシップ path に使うタブごとのランダム UUID（Peer ID）。 */
	peerId: string;
	threadId: string;
	boardId: string;
};

/**
 * レスを投稿する UseCase。署名してローカルに保存し、ゴシップで伝播する。
 */
export class PostMessageUseCase {
	private readonly postStore: IPostStore;
	private readonly crypto: CryptoService;
	private readonly clock: LamportClock;
	private readonly config: PostMessageConfig;
	private readonly gateway: IGossipMessageGateway;

	constructor(
		postStore: IPostStore,
		crypto: CryptoService,
		clock: LamportClock,
		config: PostMessageConfig,
		gateway: IGossipMessageGateway,
	) {
		this.postStore = postStore;
		this.crypto = crypto;
		this.clock = clock;
		this.config = config;
		this.gateway = gateway;
	}

	async execute(input: PostInput): Promise<void> {
		const { publicKey, odId, peerId, threadId, boardId } = this.config;
		const lamport = this.clock.tick();
		const draft = {
			name: input.name.trim() || DEFAULT_NAME,
			body: input.body.trim(),
			odId,
			timestamp: Date.now(),
			lamport,
			publicKey,
			boardId,
			threadId,
		};
		const post = await this.crypto.sign(draft);
		await this.postStore.save(post);

		const msg: GossipMessage = {
			type: "post",
			post,
			ttl: TTL_INITIAL,
			path: [peerId],
		};
		this.gateway.send(msg);
	}
}
