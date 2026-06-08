import type { Thread } from "@/core/domain/model/Thread";
import { ThreadSchema } from "@/core/domain/model/Thread";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IThreadStore } from "@/core/domain/port/IThreadStore";
import { InMemoryThreadStore } from "./InMemoryThreadStore";

const DB_NAME = "nch-threads";
const DB_VERSION = 1;
const STORE_NAME = "threads";

/**
 * IndexedDB に永続化するハイブリッドスレストア。
 * getByBoard / has / subscribe は常にメモリから返す（同期）。
 * 起動時に load() を呼ぶことで IndexedDB の全スレをメモリに復元する。
 */
export class IndexedDBThreadStore implements IThreadStore {
	private db: IDBDatabase | null = null;
	private readonly memory = new InMemoryThreadStore();

	private readonly logger: ILogger;
	private readonly idb: IDBFactory;

	constructor(logger: ILogger, idb: IDBFactory = indexedDB) {
		this.logger = logger;
		this.idb = idb;
	}

	/**
	 * IndexedDB を開き、全スレをメモリに読み込む。起動時に 1 回だけ呼ぶこと。
	 */
	async load(): Promise<void> {
		this.db = await this.openDB();
		const raws = await this.getAllFromDB();
		for (const raw of raws) {
			const result = ThreadSchema.safeParse(raw);
			if (!result.success) {
				this.logger.warn("thread_store.load_corrupt", {
					error: result.error.message,
				});
				continue;
			}
			await this.memory.save(result.data);
		}
	}

	getByBoard(boardId: string): Thread[] {
		return this.memory.getByBoard(boardId);
	}

	get(threadId: string): Thread | undefined {
		return this.memory.get(threadId);
	}

	has(threadId: string): boolean {
		return this.memory.has(threadId);
	}

	async save(thread: Thread): Promise<void> {
		// 先着が勝ち。memory.has でチェックしてから書き込む（DB の put は上書きなので先にガード）
		if (this.memory.has(thread.threadId)) return;
		await this.memory.save(thread);
		await this.putToDB(thread);
	}

	async delete(threadId: string): Promise<void> {
		await this.memory.delete(threadId);
		await this.deleteFromDB(threadId);
	}

	subscribe(boardId: string, callback: () => void): () => void {
		return this.memory.subscribe(boardId, callback);
	}

	private openDB(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = this.idb.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				if (!req.result.objectStoreNames.contains(STORE_NAME)) {
					req.result.createObjectStore(STORE_NAME, { keyPath: "threadId" });
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

	private putToDB(thread: Thread): Promise<void> {
		const db = this.db;
		if (db === null) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const req = tx.objectStore(STORE_NAME).put(thread);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	}

	private deleteFromDB(threadId: string): Promise<void> {
		const db = this.db;
		if (db === null) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const req = tx.objectStore(STORE_NAME).delete(threadId);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	}
}
