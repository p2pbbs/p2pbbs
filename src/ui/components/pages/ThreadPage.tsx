import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { MAX_POSTS_PER_THREAD } from "@/core/config/constants";
import { NchError } from "@/core/domain/error/NchError";
import { PostMessageUseCase } from "@/core/usecase/PostMessageUseCase";
import { PostForm } from "@/ui/components/thread/PostForm";
import { ThreadView } from "@/ui/components/thread/ThreadView";
import { useCanPost } from "@/ui/hooks/useCanPost";
import { usePostList } from "@/ui/hooks/usePostList";
import { useBoardSession, useSession } from "@/ui/session";
import { NotFound } from "./NotFound";

export function ThreadPage() {
	const session = useSession();
	const board = useBoardSession();
	const { threadId = "" } = useParams();

	const { posts, refresh } = usePostList(
		session.postStore,
		threadId,
		session.publicKey,
		session.readHistory,
	);
	const canPost = useCanPost(board.exchangeDigestUseCase);

	// 初回 sync 完了（canPost: false→true）で 1 回だけ自動リロードする。
	// canPost は一方向遷移。ref で「初回の 1 回だけ」に限定し、スレ遷移で refresh の
	// 識別子が変わっても再発火させない（入場時の未読バッジを消さないため）。
	const syncedRef = useRef(false);
	useEffect(() => {
		if (canPost && !syncedRef.current) {
			syncedRef.current = true;
			refresh();
		}
	}, [canPost, refresh]);

	const usecase = useMemo(
		() =>
			new PostMessageUseCase(
				session.postStore,
				session.crypto,
				session.clockMap,
				{
					publicKey: session.publicKey,
					odId: session.odId,
					peerId: session.peerId,
					boardId: board.boardId,
				},
				board.gateway,
			),
		[session, board.boardId, board.gateway],
	);

	const handleSubmit = useCallback(
		(name: string, body: string) => {
			usecase
				.execute({ name, body, threadId })
				.then(() => refresh())
				.catch((err: unknown) => {
					if (err instanceof NchError) {
						session.logger.warn("thread_page.post_rejected", {
							code: err.code,
						});
					} else {
						session.logger.error("thread_page.post_error", { err });
					}
				});
		},
		[usecase, threadId, refresh, session.logger],
	);

	const thread = session.threadStore.get(threadId);

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
					onClick={refresh}
					className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
				>
					更新
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
