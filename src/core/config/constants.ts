/** ゴシップのファンアウト数（転送先ピア数の上限）。 */
export const FANOUT = 5;

/** 投稿者名のデフォルト値。 */
export const DEFAULT_NAME = "名無しさん";

/** 1投稿あたりの本文の最大バイト数（UTF-8）。 */
export const MAX_POST_BYTES = 4096;

/** ゴシップメッセージの初期 TTL（ホップ上限）。 */
export const TTL_INITIAL = 7;

/** MVP で使用する固定の板 ID。 */
export const DEFAULT_BOARD_ID = "board-1";

/** MVP で使用する固定のスレ ID。 */
export const DEFAULT_THREAD_ID = "thread-1";

/** MVP で使用する固定のスレタイトル。 */
export const DEFAULT_THREAD_TITLE = "nch 雑談スレ";

/** シグナリングサーバーのデフォルト WebSocket URL。 */
export const SIGNALING_URL =
	import.meta.env.VITE_SIGNALING_URL ?? "ws://[::1]:8765";

/** シグナリング discover() のタイムアウト（ミリ秒）。超過したら fatal エラー。 */
export const SIGNALING_DISCOVER_TIMEOUT_MS = 10_000;

/** DataChannel heartbeat の送信間隔（ミリ秒）。 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** DataChannel heartbeat のタイムアウト（ミリ秒）。この時間内に受信がなければ dead と判定。 */
export const HEARTBEAT_TIMEOUT_MS = 90_000;

/** Google 公開 STUN サーバー。TURN は使わない。 */
export const STUN_URL = "stun:stun.l.google.com:19302";

/** 同時に保持する active な WebRTC DataChannel 接続の上限。 */
export const MAX_ACTIVE_PEERS = 8;

/** 利用可能な板の一覧。 */
export const BOARDS = [
	{ boardId: "mona", name: "モナー" },
	{ boardId: "yaruo", name: "やる夫" },
] as const;

/** 1板あたりのスレ上限。超過時は最古スレを FIFO evict する。 */
export const MAX_THREADS_PER_BOARD = 100;

/** 1スレあたりのレス上限。超過時は投稿フォームを無効化する。 */
export const MAX_POSTS_PER_THREAD = 1000;

/** スレタイトルの最大バイト数（UTF-8）。Thread.ts の ThreadSchema でも参照する。 */
export const MAX_THREAD_TITLE_BYTES = 150;

/**
 * 各板のジェネシススレ。bootstrap 時に IThreadStore に初期ロードする。
 * signature / publicKey は "genesis" センチネル値。
 * 検証パイプライン（Story 15c）はジェネシス threadId をスキップして保存する。
 *
 * Thread 型は import せず構造的互換を保つ（Thread.ts → constants.ts の循環依存を防ぐ）。
 */
export const GENESIS_THREADS = {
	mona: {
		threadId: "1700000000000",
		boardId: "mona",
		title: "モナー雑談スレ",
		createdAt: 1700000000000,
		signature: "genesis" as string,
		publicKey: "genesis" as string,
	},
	yaruo: {
		threadId: "1700000000001",
		boardId: "yaruo",
		title: "やる夫雑談スレ",
		createdAt: 1700000000001,
		signature: "genesis" as string,
		publicKey: "genesis" as string,
	},
} as const;
