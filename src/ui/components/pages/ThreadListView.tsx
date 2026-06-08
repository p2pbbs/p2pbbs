import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BOARDS, MAX_THREADS_PER_BOARD } from "@/core/config/constants";
import { NchError } from "@/core/domain/error/NchError";
import { CreateThreadForm } from "@/ui/components/thread/CreateThreadForm";
import { useCanPost } from "@/ui/hooks/useCanPost";
import { useThreadList } from "@/ui/hooks/useThreadList";
import { useBoardSession, useSession } from "@/ui/session";

export function ThreadListView() {
	const session = useSession();
	const board = useBoardSession();
	const boardName =
		BOARDS.find((b) => b.boardId === board.boardId)?.name ?? board.boardId;

	const { items, refresh } = useThreadList(
		session.threadStore,
		session.postStore,
		board.boardId,
	);
	const canPost = useCanPost(board.exchangeDigestUseCase);

	// 初回 sync 完了（canPost: false→true）で 1 回だけスレ一覧を自動リロードする。
	// 初回入場はページ遷移を経ないため、これが無いと手動更新まで一覧が空のまま。
	// canPost は一方向遷移なので ref で初回の 1 回だけに限定する。
	const syncedRef = useRef(false);
	useEffect(() => {
		if (canPost && !syncedRef.current) {
			syncedRef.current = true;
			refresh();
		}
	}, [canPost, refresh]);

	const [isCreateOpen, setCreateOpen] = useState(false);
	const isFull = items.length >= MAX_THREADS_PER_BOARD;

	const handleCreate = useCallback(
		(title: string, name: string, body: string) => {
			board.createThreadUseCase
				.execute({ title, name, body })
				.then(() => {
					refresh();
					setCreateOpen(false);
				})
				.catch((err: unknown) => {
					if (err instanceof NchError) {
						session.logger.warn("thread_list.create_rejected", {
							code: err.code,
						});
					} else {
						session.logger.error("thread_list.create_error", { err });
					}
				});
		},
		[board.createThreadUseCase, refresh, session.logger],
	);

	return (
		<main className="px-4 sm:px-6 lg:px-8 py-6 w-full max-w-3xl mx-auto">
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-2xl font-medium">
					<Link to="/" className="text-gray-400 hover:underline">
						板一覧
					</Link>
					<span className="mx-2 text-gray-300">/</span>
					{boardName}
				</h1>
				<button
					type="button"
					onClick={refresh}
					className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
				>
					更新
				</button>
			</div>

			{items.length === 0 ? (
				<p className="text-sm text-gray-400 dark:text-gray-500">
					まだスレがありません。右下のボタンから最初のスレを立ててみましょう。
				</p>
			) : (
				<ol className="flex flex-col gap-1">
					{items.map((item, i) => (
						<li key={item.thread.threadId}>
							<Link
								to={`/board/${board.boardId}/${item.thread.threadId}`}
								className="flex items-baseline gap-2 rounded px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
							>
								<span className="font-mono text-sm text-gray-400 w-6 text-right">
									{i + 1}
								</span>
								<span className="flex-1 font-medium">{item.thread.title}</span>
								<span className="text-sm text-gray-400">
									{item.postCount}レス
								</span>
								<span className="text-xs text-gray-300 dark:text-gray-600">
									勢い {item.momentum.toFixed(1)}
								</span>
							</Link>
						</li>
					))}
				</ol>
			)}

			{/* スレ作成 FAB（右下） */}
			<button
				type="button"
				onClick={() => setCreateOpen(true)}
				aria-label="スレ作成"
				className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gray-800 text-white shadow-lg hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white transition-colors"
			>
				<span className="text-3xl leading-none">＋</span>
			</button>

			{isCreateOpen && (
				<div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-4">
					{/* 背景。クリック/Enter/Space で閉じる（interactive な button にして a11y を満たす） */}
					<button
						type="button"
						aria-label="閉じる"
						onClick={() => setCreateOpen(false)}
						className="absolute inset-0 cursor-default bg-black/40"
					/>
					<div
						role="dialog"
						aria-modal="true"
						aria-label="スレ作成"
						className="relative z-10 w-full max-w-lg rounded-lg bg-white dark:bg-gray-900 shadow-xl"
					>
						<button
							type="button"
							onClick={() => setCreateOpen(false)}
							aria-label="閉じる"
							className="absolute right-3 top-3 text-xl leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
						>
							×
						</button>
						<CreateThreadForm
							onSubmit={handleCreate}
							disabled={!canPost}
							notice={
								isFull
									? `この板はスレ上限（${MAX_THREADS_PER_BOARD}）に達しています`
									: undefined
							}
						/>
					</div>
				</div>
			)}
		</main>
	);
}
