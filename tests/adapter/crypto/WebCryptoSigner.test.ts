import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { WebCryptoSigner } from "@/core/adapter/crypto/WebCryptoSigner";
import { makePost, makeThread } from "../../helpers/fixtures";

describe("WebCryptoSigner — 鍵生成と署名", () => {
	let signer: WebCryptoSigner;

	beforeEach(() => {
		signer = new WebCryptoSigner(new IDBFactory());
	});

	it("test_generateKeyPair_ReturnsBase64PublicKey", async () => {
		const { publicKey } = await signer.generateKeyPair();
		expect(publicKey).toBeTruthy();
		// base64 デコードして 32 バイト（Ed25519 公開鍵長）
		const raw = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
		expect(raw.byteLength).toBe(32);
	});

	it("test_sign_WithoutKeyPair_Throws", async () => {
		await expect(
			signer.sign(makePost({ id: "", signature: "" })),
		).rejects.toThrow();
	});

	it("test_sign_WithKeyPair_ReturnsPostWithIdAndSignature", async () => {
		const { publicKey } = await signer.generateKeyPair();
		const draft = makePost({ id: "", signature: "", publicKey });
		const post = await signer.sign(draft);
		expect(post.id).toMatch(/^[0-9a-f]{64}$/);
		expect(post.signature).toBeTruthy();
	});

	it("test_sign_SameDraft_ReturnsSameId", async () => {
		const { publicKey } = await signer.generateKeyPair();
		const draft = makePost({ id: "", signature: "", publicKey });
		const p1 = await signer.sign(draft);
		const p2 = await signer.sign(draft);
		expect(p1.id).toBe(p2.id);
	});
});

describe("WebCryptoSigner — IndexedDB 永続化", () => {
	it("test_generateKeyPair_NoExistingKey_PersistsKeyToIndexedDB", async () => {
		const idb = new IDBFactory();
		const signer1 = new WebCryptoSigner(idb);
		const { publicKey: first } = await signer1.generateKeyPair();

		// 同じ IDBFactory を使う別インスタンス → 保存済みの鍵を読み込む
		const signer2 = new WebCryptoSigner(idb);
		const { publicKey: second } = await signer2.generateKeyPair();

		expect(second).toBe(first);
	});

	it("test_generateKeyPair_ExistingKey_LoadsWithoutRegeneration", async () => {
		const idb = new IDBFactory();
		const signer1 = new WebCryptoSigner(idb);
		const { publicKey: first } = await signer1.generateKeyPair();

		// 3回目も同じ鍵
		const signer3 = new WebCryptoSigner(idb);
		const { publicKey: third } = await signer3.generateKeyPair();

		expect(third).toBe(first);
	});

	it("test_generateKeyPair_LoadedKey_CanStillSign", async () => {
		const idb = new IDBFactory();
		const signer1 = new WebCryptoSigner(idb);
		const { publicKey } = await signer1.generateKeyPair();

		// 同じ IDB から読み込んだ鍵で署名できること
		const signer2 = new WebCryptoSigner(idb);
		await signer2.generateKeyPair();
		const draft = makePost({ id: "", signature: "", publicKey });
		const post = await signer2.sign(draft);
		expect(post.id).toMatch(/^[0-9a-f]{64}$/);
		expect(post.signature).toBeTruthy();
	});

	it("test_generateKeyPair_ConcurrentTabs_BothGetSameKey", async () => {
		// 同じ IDBFactory（同一ブラウザを模擬）で2つのタブが同時起動
		const idb = new IDBFactory();
		const signer1 = new WebCryptoSigner(idb);
		const signer2 = new WebCryptoSigner(idb);

		const [{ publicKey: key1 }, { publicKey: key2 }] = await Promise.all([
			signer1.generateKeyPair(),
			signer2.generateKeyPair(),
		]);

		// レースコンディションに関わらず両タブで同じ OD ID になること
		expect(key1).toBe(key2);
	});

	it("test_signThread_WithoutKeyPair_Throws", async () => {
		const signer = new WebCryptoSigner(new IDBFactory());
		await expect(
			signer.signThread(makeThread({ signature: "" })),
		).rejects.toThrow();
	});

	it("test_signThread_WithKeyPair_ReturnsThreadWithSignature", async () => {
		const signer = new WebCryptoSigner(new IDBFactory());
		const { publicKey } = await signer.generateKeyPair();
		const draft = makeThread({ signature: "", publicKey });
		const thread = await signer.signThread(draft);
		expect(thread.signature).toBeTruthy();
		expect(thread.signature).not.toBe("");
	});

	it("test_signThread_SameDraft_ReturnsSameSignature", async () => {
		const signer = new WebCryptoSigner(new IDBFactory());
		const { publicKey } = await signer.generateKeyPair();
		const draft = makeThread({ signature: "", publicKey });
		const t1 = await signer.signThread(draft);
		const t2 = await signer.signThread(draft);
		expect(t1.signature).toBe(t2.signature);
	});

	it("test_signThread_DifferentTitles_ReturnDifferentSignatures", async () => {
		const signer = new WebCryptoSigner(new IDBFactory());
		const { publicKey } = await signer.generateKeyPair();
		const t1 = await signer.signThread(
			makeThread({ signature: "", publicKey, title: "スレA" }),
		);
		const t2 = await signer.signThread(
			makeThread({ signature: "", publicKey, title: "スレB" }),
		);
		expect(t1.signature).not.toBe(t2.signature);
	});

	it("test_generateKeyPair_IndexedDBUnavailable_FallsBackToEphemeralKey", async () => {
		// openDB が必ず reject するブロークン IDB
		const brokenIdb = {
			open: () => {
				const request = {
					onerror: null as null | ((e: Event) => void),
					onsuccess: null,
					onupgradeneeded: null,
					error: new DOMException("unavailable", "UnknownError"),
				};
				queueMicrotask(() => {
					request.onerror?.(new Event("error"));
				});
				return request as unknown as IDBOpenDBRequest;
			},
		} as unknown as IDBFactory;

		const signer = new WebCryptoSigner(brokenIdb);
		// IndexedDB が使えなくてもクラッシュせずエフェメラル鍵で動作すること
		const { publicKey } = await signer.generateKeyPair();
		expect(publicKey).toBeTruthy();
		const raw = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
		expect(raw.byteLength).toBe(32);
	});
});
