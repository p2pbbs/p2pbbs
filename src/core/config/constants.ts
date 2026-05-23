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
	import.meta.env.VITE_SIGNALING_URL ?? "ws://[::1]:8080";

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
