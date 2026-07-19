import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { MAX_POSTS_PER_THREAD } from "@/core/config/constants";
import { NchError } from "@/core/domain/error/NchError";
import { SubmitPostUseCase } from "@/core/usecase/SubmitPostUseCase";
import { PostForm } from "@/ui/components/thread/PostForm";
import { ThreadView } from "@/ui/components/thread/ThreadView";
import { useCanPost } from "@/ui/hooks/useCanPost";
import { usePostList } from "@/ui/hooks/usePostList";
import { useUndisplayed } from "@/ui/hooks/useUndisplayed";
import { useBoardSession, useNodeContext } from "@/ui/nodeContext";
import { NotFound } from "./NotFound";

export function ThreadPage() {
	const nodeCtx = useNodeContext();
	const board = useBoardSession();
	const { threadId = "" } = useParams();

	const { posts, refresh } = usePostList(
		nodeCtx.postStore,
		threadId,
		nodeCtx.publicKey,
		nodeCtx.readHistory,
	);
	const canPost = useCanPost(board.exchangeDigestUseCase);
	const { hasUndisplayed, clear } = useUndisplayed(nodeCtx.postStore, threadId);

	// 更新は表示の取り込み（refresh）と未反映バッジの消灯（clear）を同時に行う。
	// clear は baseline を更新後の件数へ貼り直すだけで、以降に届いた分は意図通り点灯する。
	const refreshAndClear = useCallback(() => {
		refresh();
		clear();
	}, [refresh, clear]);

	// 初回 sync 完了（canPost: false→true）で 1 回だけ自動リロードする。
	// canPost は一方向遷移。ref で「初回の 1 回だけ」に限定し、スレ遷移で refresh の
	// 識別子が変わっても再発火させない（入場時の未読バッジを消さないため）。
	//
	// ここで clear を併発するのは点灯抑制のためではない。canPost flip 時点で baseline を
	// 貼り直すだけで、その後の到着（継続 backfill 含む）は意図通り点灯する。clear が要るのは、
	// sync がこのワンショットより先に着く「速い順」のとき、すでに表示へ取り込めるのにボタンが
	// 点灯したまま残るのを防ぐため（refresh だけでは baseline が古いままで消灯しない）。
	const syncedRef = useRef(false);
	useEffect(() => {
		if (canPost && !syncedRef.current) {
			syncedRef.current = true;
			refreshAndClear();
		}
	}, [canPost, refreshAndClear]);

	const usecase = useMemo(
		() =>
			new SubmitPostUseCase(
				nodeCtx.postStore,
				nodeCtx.crypto,
				nodeCtx.clockMap,
				{
					publicKey: nodeCtx.publicKey,
					odId: nodeCtx.odId,
					peerId: nodeCtx.peerId,
					boardId: board.boardId,
				},
				board.gateway,
			),
		[nodeCtx, board.boardId, board.gateway],
	);

	const handleSubmit = useCallback(
		(name: string, body: string) => {
			usecase
				.execute({ name, body, threadId })
				.then(() => refreshAndClear())
				.catch((err: unknown) => {
					if (err instanceof NchError) {
						nodeCtx.logger.warn("thread_page.post_rejected", {
							code: err.code,
						});
					} else {
						nodeCtx.logger.error("thread_page.post_error", { err });
					}
				});
		},
		[usecase, threadId, refreshAndClear, nodeCtx.logger],
	);

	const thread = nodeCtx.threadStore.get(threadId);

	// Thread エンティティも投稿も無いスレは「見つからない」として扱う。
	// （Post だけ先着して Thread 未着のケースは投稿が表示されるので除外）
	if (!thread && posts.length === 0) {
		return <NotFound message="スレが見つかりません" />;
	}

	const title = thread?.title ?? "（タイトル未取得のスレ）";
	const isFull = posts.length >= MAX_POSTS_PER_THREAD;

	return (
		<>
			<div className="px-4 sm:px-6 lg:px-8 pt-4 w-full max-w-3xl mx-auto flex items-center justify-between">
				<Link
					to={`/board/${board.boardId}`}
					className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
				>
					← スレ一覧
				</Link>
				<button
					type="button"
					onClick={refreshAndClear}
					aria-label={hasUndisplayed ? "未反映のレスがあります。更新" : "更新"}
					className={
						hasUndisplayed
							? "text-sm text-amber-600 dark:text-amber-400 hover:underline"
							: "text-sm text-blue-600 dark:text-blue-400 hover:underline"
					}
				>
					更新
					{hasUndisplayed && (
						// 数字なしのドットバッジ。色のみに依存しないよう、ドットの有無を
						// 非色の手がかりとして兼ねる。読み上げは button の aria-label が担う。
						<span
							aria-hidden="true"
							className="ml-1 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle"
						/>
					)}
				</button>
			</div>
			<ThreadView title={title} posts={posts} />
			<PostForm
				onSubmit={handleSubmit}
				disabled={!canPost}
				notice={
					isFull
						? `このスレはレス上限（${MAX_POSTS_PER_THREAD}）に達しました`
						: undefined
				}
			/>
		</>
	);
}
