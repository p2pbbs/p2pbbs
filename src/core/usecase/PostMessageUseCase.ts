import {
	DEFAULT_NAME,
	MAX_POSTS_PER_THREAD,
	TTL_INITIAL,
} from "@/core/config/constants";
import { NchError } from "@/core/domain/error/NchError";
import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import type { CryptoService } from "@/core/domain/service/CryptoService";
import type { LamportClockMap } from "@/core/domain/service/LamportClockMap";

type PostInput = {
	name: string;
	body: string;
	/** 投稿先スレ。スレ単位で Lamport clock と上限を判定する。 */
	threadId: string;
};

export type PostMessageConfig = {
	publicKey: string;
	/** 投稿者の表示用 ID（公開鍵ハッシュ先頭8文字）。 */
	odId: string;
	/** ゴシップ path に使うタブごとのランダム UUID（Peer ID）。 */
	peerId: string;
	boardId: string;
};

/**
 * レスを投稿する UseCase。署名してローカルに保存し、ゴシップで伝播する。
 * 投稿先スレは execute の引数で受け取る（複数スレ対応）。
 */
export class PostMessageUseCase {
	private readonly postStore: IPostStore;
	private readonly crypto: CryptoService;
	private readonly clockMap: LamportClockMap;
	private readonly config: PostMessageConfig;
	private readonly gateway: IGossipMessageGateway;

	constructor(
		postStore: IPostStore,
		crypto: CryptoService,
		clockMap: LamportClockMap,
		config: PostMessageConfig,
		gateway: IGossipMessageGateway,
	) {
		this.postStore = postStore;
		this.crypto = crypto;
		this.clockMap = clockMap;
		this.config = config;
		this.gateway = gateway;
	}

	async execute(input: PostInput): Promise<void> {
		const { publicKey, odId, peerId, boardId } = this.config;
		const { threadId } = input;

		// 1000 レス上限。UI 側でもフォームを無効化するが、ここでも安全弁として拒否する
		if (this.postStore.getSnapshot(threadId).length >= MAX_POSTS_PER_THREAD) {
			throw new NchError(
				"post.thread_full",
				"ignore",
				`このスレは ${MAX_POSTS_PER_THREAD} レスに達しました`,
			);
		}

		const lamport = this.clockMap.get(threadId).tick();
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
