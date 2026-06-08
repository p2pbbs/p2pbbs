import type { Post } from "@/core/domain/model/Post";
import { PostSchema } from "@/core/domain/model/Post";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IPostStore } from "@/core/domain/port/IPostStore";
import { InMemoryPostStore } from "./InMemoryPostStore";

const DB_NAME = "nch";
const DB_VERSION = 1;
const STORE_NAME = "posts";

/**
 * IndexedDB に永続化するハイブリッドストア。
 * getSnapshot / subscribe は常にメモリから返す（同期、useSyncExternalStore 互換）。
 * 起動時に load() を呼ぶことで IndexedDB の全投稿をメモリに復元する。
 */
export class IndexedDBPostStore implements IPostStore {
	private db: IDBDatabase | null = null;
	private readonly memory = new InMemoryPostStore();

	/**
	 * @param logger  - ログ出力先
	 * @param idb     - IndexedDB ファクトリ。テスト時に fake-indexeddb を注入できる
	 */
	private readonly logger: ILogger;
	private readonly idb: IDBFactory;

	constructor(logger: ILogger, idb: IDBFactory = indexedDB) {
		this.logger = logger;
		this.idb = idb;
	}

	/**
	 * IndexedDB を開き、全投稿をメモリに読み込む。起動時に1回だけ呼ぶこと。
	 * lamport の復元はスレ単位で行うため、呼び出し側が getThreadIds / getSnapshot から
	 * 各スレの最大値を算出して LamportClockMap に merge する。
	 */
	async load(): Promise<void> {
		this.db = await this.openDB();
		const raws = await this.getAllFromDB();
		for (const raw of raws) {
			const result = PostSchema.safeParse(raw);
			if (!result.success) {
				this.logger.warn("storage.load_corrupt", {
					error: result.error.message,
				});
				continue;
			}
			const post: Post = result.data;
			await this.memory.save(post);
		}
	}

	getSnapshot(threadId: string): Post[] {
		return this.memory.getSnapshot(threadId);
	}

	getThreadIds(boardId: string): string[] {
		return this.memory.getThreadIds(boardId);
	}

	subscribe(threadId: string, callback: () => void): () => void {
		return this.memory.subscribe(threadId, callback);
	}

	async save(post: Post): Promise<void> {
		await this.memory.save(post);
		await this.putToDB(post);
	}

	private openDB(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = this.idb.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				if (!req.result.objectStoreNames.contains(STORE_NAME)) {
					req.result.createObjectStore(STORE_NAME, { keyPath: "id" });
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	private getAllFromDB(): Promise<unknown[]> {
		const db = this.db;
		if (db === null) return Promise.resolve([]);
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const req = tx.objectStore(STORE_NAME).getAll();
			req.onsuccess = () => resolve(req.result as unknown[]);
			req.onerror = () => reject(req.error);
		});
	}

	private putToDB(post: Post): Promise<void> {
		const db = this.db;
		if (db === null) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const req = tx.objectStore(STORE_NAME).put(post);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	}
}
