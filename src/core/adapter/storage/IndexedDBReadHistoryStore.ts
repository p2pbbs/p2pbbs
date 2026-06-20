import { z } from "zod";
import type { ILogger } from "@/core/domain/port/ILogger";
import type { IReadHistoryStore } from "@/core/domain/port/IReadHistoryStore";
import { InMemoryReadHistoryStore } from "./InMemoryReadHistoryStore";

const DB_NAME = "nch-read-history";
const DB_VERSION = 1;
const STORE_NAME = "readHistory";

/** IndexedDB に保存する 1 スレ分の既読レコード。 */
const ReadHistoryRecordSchema = z.object({
	threadId: z.string(),
	postIds: z.array(z.string()),
});

/**
 * 既読履歴を IndexedDB に永続化するハイブリッドストア。
 * getSnapshot は常にメモリから返す（同期）。markRead はメモリ更新後に永続化する。
 * 起動時に load() を呼ぶことで全スレの既読集合をメモリに復元する。
 *
 * load() 前（db=null）は getSnapshot/markRead がメモリのみで動作する。ただし
 * load() 自体は openDB の失敗を呼び出し側へ伝播する（IndexedDBPostStore /
 * IndexedDBThreadStore と同挙動）。IDB が一切開けない環境への耐性はこの 3 ストア
 * 横断で別途扱う。
 */
export class IndexedDBReadHistoryStore implements IReadHistoryStore {
	private db: IDBDatabase | null = null;
	private readonly memory = new InMemoryReadHistoryStore();

	private readonly logger: ILogger;
	private readonly idb: IDBFactory;

	/**
	 * @param logger - ログ出力先
	 * @param idb    - IndexedDB ファクトリ。テスト時に fake-indexeddb を注入できる
	 */
	constructor(logger: ILogger, idb: IDBFactory = indexedDB) {
		this.logger = logger;
		this.idb = idb;
	}

	/**
	 * IndexedDB を開き、全スレの既読集合をメモリに読み込む。起動時に 1 回だけ呼ぶこと。
	 * 破損レコードは warn ログを残してスキップする。
	 */
	async load(): Promise<void> {
		this.db = await this.openDB();
		const raws = await this.getAllFromDB();
		for (const raw of raws) {
			const result = ReadHistoryRecordSchema.safeParse(raw);
			if (!result.success) {
				this.logger.warn("read_history.load_corrupt", {
					error: result.error.message,
				});
				continue;
			}
			await this.memory.markRead(result.data.threadId, result.data.postIds);
		}
	}

	getSnapshot(threadId: string): ReadonlySet<string> {
		return this.memory.getSnapshot(threadId);
	}

	async markRead(threadId: string, postIds: Iterable<string>): Promise<void> {
		await this.memory.markRead(threadId, postIds);
		await this.putToDB(threadId);
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

	/** スレの既読集合をまるごと 1 レコードとして書き出す（メモリが正）。 */
	private putToDB(threadId: string): Promise<void> {
		const db = this.db;
		if (db === null) return Promise.resolve();
		const postIds = [...this.memory.getSnapshot(threadId)];
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const req = tx.objectStore(STORE_NAME).put({ threadId, postIds });
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	}
}
