import { useCallback, useEffect, useRef, useState } from "react";
import type { IPostStore } from "@/core/domain/port/IPostStore";

/**
 * 未反映（Undisplayed）= ストアには保存済みだが現在表示中のビューにまだ取り込まれて
 * いないレスを検知する hook。リスト本体は再描画せず、boolean 1 個（点灯有無）だけを返す。
 *
 * pull モデルでは「ストアには届いているのに UI で気づけない」弱点がある。これを補い、
 * 入場・更新時点の件数を baseline として固定し、ストアの現在件数が baseline を上回ったら
 * hasUndisplayed を true にする。store snapshot は dedup 済みのため、同一 post の再配信や
 * 低 lamport の中間挿入でも誤検知しにくい。
 *
 * baseline は usePostList の useAlreadyRead と同じ作法で threadId 単位に ref 固定し、
 * StrictMode の effect 二重実行・再レンダーで取り直されないようにする。スレ遷移
 * （threadId 変化）でのみ取り直し、必ず neutral へ戻る。
 *
 * clear() は更新（refresh）と同時に呼ぶ。baseline を現在件数へ更新し消灯する。
 */
export function useUndisplayed(
	store: IPostStore,
	threadId: string,
): { hasUndisplayed: boolean; clear: () => void } {
	const [hasUndisplayed, setHasUndisplayed] = useState(false);
	// baseline 件数を threadId 単位で固定する。スレ遷移でのみ取り直す。
	// ref に持つことで StrictMode の effect 二重実行・再レンダーで消えない。
	const baselineRef = useRef<{ threadId: string; count: number } | null>(null);
	if (
		baselineRef.current === null ||
		baselineRef.current.threadId !== threadId
	) {
		baselineRef.current = {
			threadId,
			count: store.getSnapshot(threadId).length,
		};
	}

	const clear = useCallback(() => {
		baselineRef.current = {
			threadId,
			count: store.getSnapshot(threadId).length,
		};
		setHasUndisplayed(false);
	}, [store, threadId]);

	useEffect(() => {
		// スレ遷移時は neutral へ戻す（baseline は上の描画で取り直し済み）。
		setHasUndisplayed(false);

		// ストアへの save を購読し、dedup 済み件数が baseline を上回ったら点灯する。
		// リスト本体は購読しない（pull モデル維持）。点灯させるのは boolean だけ。
		const check = () => {
			const baseline = baselineRef.current;
			if (baseline === null || baseline.threadId !== threadId) return;
			if (store.getSnapshot(threadId).length > baseline.count) {
				setHasUndisplayed(true);
			}
		};
		return store.subscribe(threadId, check);
	}, [store, threadId]);

	return { hasUndisplayed, clear };
}

/**
 * 板単位の未反映（Undisplayed）を検知する hook。useUndisplayed の board 版。
 * board 内のどのスレへの新規 save（新レス・新スレの >>1 を含む）でも点灯する。
 *
 * 件数比較の代わりに getBoardRevision を baseline に固定する。revision は save の
 * dedup early-return の後でのみ ++ されるため、再配信では点灯しない。
 * baseline は boardId 単位に ref 固定し、板遷移でのみ取り直して neutral へ戻る。
 */
export function useBoardUndisplayed(
	store: IPostStore,
	boardId: string,
): { hasUndisplayed: boolean; clear: () => void } {
	const [hasUndisplayed, setHasUndisplayed] = useState(false);
	// baseline revision を boardId 単位で固定する。板遷移でのみ取り直す。
	const baselineRef = useRef<{ boardId: string; revision: number } | null>(
		null,
	);
	if (baselineRef.current === null || baselineRef.current.boardId !== boardId) {
		baselineRef.current = {
			boardId,
			revision: store.getBoardRevision(boardId),
		};
	}

	const clear = useCallback(() => {
		baselineRef.current = {
			boardId,
			revision: store.getBoardRevision(boardId),
		};
		setHasUndisplayed(false);
	}, [store, boardId]);

	useEffect(() => {
		// 板遷移時は neutral へ戻す（baseline は上の描画で取り直し済み）。
		setHasUndisplayed(false);

		const check = () => {
			const baseline = baselineRef.current;
			if (baseline === null || baseline.boardId !== boardId) return;
			if (store.getBoardRevision(boardId) > baseline.revision) {
				setHasUndisplayed(true);
			}
		};
		return store.subscribeBoard(boardId, check);
	}, [store, boardId]);

	return { hasUndisplayed, clear };
}
