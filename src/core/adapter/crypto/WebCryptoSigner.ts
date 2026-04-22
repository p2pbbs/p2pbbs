import type { Post } from "@/core/domain/model/Post";
import type { ISigner } from "@/core/domain/port/ISigner";

const CRYPTO_DB_NAME = "nch-crypto";
const CRYPTO_DB_VERSION = 1;
const KEY_STORE_NAME = "keyPair";
const SESSION_KEY_ID = "session";

interface StoredKeyRecord {
	id: string;
	privateKey: CryptoKey;
	publicKey: CryptoKey;
}

function bytesToBase64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

/**
 * Ed25519 鍵ペアを保持するアダプタ。
 * generateKeyPair() は IndexedDB から鍵を読み込み、存在しない場合のみ新規生成して保存する。
 * 秘密鍵は extractable: false のまま structured clone で IndexedDB に保存するため、
 * 同じブラウザの複数タブで同一の OD ID が共有される。
 *
 * @param idb - IndexedDB ファクトリ。テスト時に fake-indexeddb を注入できる
 */
export class WebCryptoSigner implements ISigner {
	private keyPair: CryptoKeyPair | null = null;
	private readonly idb: IDBFactory;

	constructor(idb: IDBFactory = indexedDB) {
		this.idb = idb;
	}

	async generateKeyPair(): Promise<{ publicKey: string }> {
		this.keyPair = await this.loadOrCreateKeyPair();
		const raw = await crypto.subtle.exportKey("raw", this.keyPair.publicKey);
		return { publicKey: bytesToBase64(new Uint8Array(raw)) };
	}

	async sign(draft: Omit<Post, "id" | "signature">): Promise<Post> {
		if (!this.keyPair) {
			throw new Error("generateKeyPair() を先に呼んでください");
		}

		// 署名ペイロード: CryptoService.verifySignature と一致させること
		const payload = new TextEncoder().encode(
			[
				draft.name,
				draft.body,
				draft.timestamp,
				draft.boardId,
				draft.threadId,
				draft.lamport,
			].join("|"),
		);
		const sigBuf = await crypto.subtle.sign(
			"Ed25519",
			this.keyPair.privateKey,
			payload,
		);
		const signature = bytesToBase64(new Uint8Array(sigBuf));

		// コンテンツハッシュ: CryptoService.computePostHash と一致させること
		const content = [
			draft.name,
			draft.body,
			draft.timestamp,
			draft.publicKey,
			draft.boardId,
			draft.threadId,
			draft.lamport,
		].join("|");
		const hashBuf = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(content),
		);
		const id = Array.from(new Uint8Array(hashBuf))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

		return { ...draft, id, signature };
	}

	/**
	 * IndexedDB から鍵を読み込む、または新規生成して保存する。
	 * DB 接続を1回だけ開き、read → add → read（レースコンディション時のみ）を同一接続で行う。
	 * 並行起動（2タブが同時に「鍵なし」と判定）した場合:
	 * - add() は keyPath 重複時に ConstraintError で失敗する
	 * - 負けたタブは add() の失敗を検知し、勝ったタブの鍵を読み込む
	 * IndexedDB が利用できない場合はセッション内のみ有効なエフェメラル鍵にフォールバックする。
	 */
	private async loadOrCreateKeyPair(): Promise<CryptoKeyPair> {
		let db: IDBDatabase | null = null;
		try {
			db = await this.openDB();

			const existing = await this.readFromDB(db);
			if (existing) return existing;

			// 鍵なし: 新規生成して add（既存があれば ConstraintError で失敗する）
			const fresh = await crypto.subtle.generateKey("Ed25519", false, [
				"sign",
				"verify",
			]);
			const added = await this.addToDB(db, fresh);
			if (added) return fresh;

			// add 失敗 = 別タブが先に書き込んだ（レースコンディション）→ その鍵を使う
			const winner = await this.readFromDB(db);
			return winner ?? fresh;
		} catch {
			// IndexedDB 利用不可 or 破損 → エフェメラル鍵にフォールバック
			return crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
		} finally {
			db?.close();
		}
	}

	private openDB(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = this.idb.open(CRYPTO_DB_NAME, CRYPTO_DB_VERSION);
			req.onupgradeneeded = () => {
				if (!req.result.objectStoreNames.contains(KEY_STORE_NAME)) {
					req.result.createObjectStore(KEY_STORE_NAME, { keyPath: "id" });
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	private readFromDB(db: IDBDatabase): Promise<CryptoKeyPair | null> {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(KEY_STORE_NAME, "readonly");
			const req = tx.objectStore(KEY_STORE_NAME).get(SESSION_KEY_ID);
			req.onsuccess = () => {
				const record = req.result as StoredKeyRecord | undefined;
				// CryptoKey は opaque オブジェクトなので zod 検証不可。instanceof で最低限ガード
				if (
					record &&
					record.privateKey instanceof CryptoKey &&
					record.publicKey instanceof CryptoKey
				) {
					resolve({
						privateKey: record.privateKey,
						publicKey: record.publicKey,
					});
				} else {
					resolve(null);
				}
			};
			req.onerror = () => reject(req.error);
		});
	}

	/**
	 * 鍵ペアを IndexedDB に add する。
	 * add は keyPath が重複すると ConstraintError を投げるため、
	 * 並行起動時に1タブだけが書き込みに成功することが保証される。
	 * @returns 書き込み成功なら true、重複エラー（別タブが先行）なら false
	 */
	private addToDB(db: IDBDatabase, keyPair: CryptoKeyPair): Promise<boolean> {
		return new Promise((resolve) => {
			const tx = db.transaction(KEY_STORE_NAME, "readwrite");
			const record: StoredKeyRecord = {
				id: SESSION_KEY_ID,
				privateKey: keyPair.privateKey,
				publicKey: keyPair.publicKey,
			};
			const req = tx.objectStore(KEY_STORE_NAME).add(record);
			req.onsuccess = () => resolve(true);
			req.onerror = () => resolve(false); // ConstraintError: 別タブが先行
		});
	}
}
