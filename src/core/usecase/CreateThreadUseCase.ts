import {
	DEFAULT_NAME,
	MAX_THREAD_TITLE_BYTES,
	TTL_INITIAL,
} from "@/core/config/constants";
import { NchError } from "@/core/domain/error/NchError";
import type { GossipMessage } from "@/core/domain/model/GossipMessage";
import type { OdId, PeerId } from "@/core/domain/model/ids";
import type { IGossipMessageGateway } from "@/core/domain/port/IGossipMessageGateway";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import type { CryptoService } from "@/core/domain/service/CryptoService";
import type { LamportClockMap } from "@/core/domain/service/LamportClockMap";
import type { ThreadIngester } from "@/core/domain/service/ThreadIngester";

type CreateThreadInput = {
	title: string;
	name: string;
	body: string;
};

export type CreateThreadConfig = {
	publicKey: string;
	odId: OdId;
	peerId: PeerId;
	boardId: string;
};

/**
 * 新規スレを作成する UseCase。
 * Thread エンティティ（署名付き）と >>1 Post（署名付き）を生成し、
 * ローカルに保存したうえで thread_created エンベロープでアトミックに伝播する。
 *
 * 板のスレ数が上限のときは ThreadIngester が最古スレを FIFO evict する。
 */
export class CreateThreadUseCase {
	private readonly postStore: IPostStore;
	private readonly crypto: CryptoService;
	private readonly clockMap: LamportClockMap;
	private readonly threadIngester: ThreadIngester;
	private readonly config: CreateThreadConfig;
	private readonly gateway: IGossipMessageGateway;

	constructor(
		postStore: IPostStore,
		crypto: CryptoService,
		clockMap: LamportClockMap,
		threadIngester: ThreadIngester,
		config: CreateThreadConfig,
		gateway: IGossipMessageGateway,
	) {
		this.postStore = postStore;
		this.crypto = crypto;
		this.clockMap = clockMap;
		this.threadIngester = threadIngester;
		this.config = config;
		this.gateway = gateway;
	}

	async execute(input: CreateThreadInput): Promise<void> {
		const { publicKey, odId, peerId, boardId } = this.config;
		const title = input.title.trim();
		this.validateTitle(title);

		const createdAt = Date.now();
		const threadId = String(createdAt);

		const thread = await this.crypto.signThread({
			threadId,
			boardId,
			title,
			createdAt,
			publicKey,
		});

		// >>1 Post。新規スレなので clock は 0 始まり → lamport=1
		const lamport = this.clockMap.get(threadId).tick();
		const post = await this.crypto.sign({
			name: input.name.trim() || DEFAULT_NAME,
			body: input.body.trim(),
			odId,
			timestamp: Date.now(),
			lamport,
			publicKey,
			boardId,
			threadId,
		});

		// ThreadIngester 経由で検証・FIFO evict・保存を行う（gossip 受信と同一経路）
		await this.threadIngester.ingest(thread);
		await this.postStore.save(post);

		const msg: GossipMessage = {
			type: "thread_created",
			thread,
			post,
			ttl: TTL_INITIAL,
			path: [peerId],
		};
		this.gateway.send(msg);
	}

	private validateTitle(title: string): void {
		if (title.length === 0) {
			throw new NchError(
				"thread.empty_title",
				"ignore",
				"スレタイトルを入力してください",
			);
		}
		const bytes = new TextEncoder().encode(title).byteLength;
		if (bytes > MAX_THREAD_TITLE_BYTES) {
			throw new NchError(
				"thread.title_too_long",
				"ignore",
				`スレタイトルは ${MAX_THREAD_TITLE_BYTES} バイト以内にしてください`,
			);
		}
	}
}
